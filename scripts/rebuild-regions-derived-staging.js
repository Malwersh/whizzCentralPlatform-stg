#!/usr/bin/env node

/*
Rebuild RegionsDerived from the base Regions table.

Why:
- Staging `WizzCentral_RegionsDerived_staging` is empty, causing serviceability checks to fail.
- Copying from dev is blocked when dev is a different AWS account/profile.

Usage examples:
- Dry run (prints stats, no writes):
  AWS_PROFILE=Wizz_stg_UserApp AWS_REGION=us-east-1 node scripts/rebuild-regions-derived-staging.js --dry-run

- Real run:
  AWS_PROFILE=Wizz_stg_UserApp AWS_REGION=us-east-1 node scripts/rebuild-regions-derived-staging.js

Optional flags:
  --regionsTable=WizzCentral_Regions
  --derivedTable=WizzCentral_RegionsDerived_staging
  --onlyRegionId=manathirah_center
  --limit=100
*/

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  BatchWriteCommand,
} = require('@aws-sdk/lib-dynamodb');

function parseArgs(argv) {
  const args = {
    dryRun: false,
    regionsTable: process.env.REGIONS_TABLE || 'WizzCentral_Regions',
    derivedTable: process.env.DERIVED_TABLE || 'WizzCentral_RegionsDerived_staging',
    onlyRegionId: null,
    limit: null,
  };

  for (const raw of argv.slice(2)) {
    if (raw === '--dry-run') {
      args.dryRun = true;
      continue;
    }

    const [key, value] = raw.split('=');
    if (!value) continue;

    if (key === '--regionsTable') args.regionsTable = value;
    if (key === '--derivedTable') args.derivedTable = value;
    if (key === '--onlyRegionId') args.onlyRegionId = value;
    if (key === '--limit') args.limit = Number(value);
  }

  return args;
}

function toBool(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'active'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'inactive'].includes(normalized)) return false;
  }
  return Boolean(value);
}

function getParentId(region) {
  return (
    region.parent_id ??
    region.parentId ??
    region.parentRegionId ??
    region.parent ??
    null
  );
}

function computeEffectiveActive(region, chain) {
  // 1) explicit override
  if (region.override_parent_active !== undefined) {
    return toBool(region.override_parent_active) ?? true;
  }

  // 2) region self value
  if (region.is_active !== undefined) {
    return toBool(region.is_active) ?? true;
  }

  // 3) inherit from ancestors
  for (const ancestor of chain.slice(1)) {
    if (ancestor.is_active !== undefined) {
      return toBool(ancestor.is_active) ?? true;
    }
  }

  // 4) default
  return true;
}

function computeEffectivePricing(region, chain) {
  if (region.self_pricing && Object.keys(region.self_pricing).length > 0) {
    return region.self_pricing;
  }
  for (const ancestor of chain.slice(1)) {
    if (ancestor.self_pricing && Object.keys(ancestor.self_pricing).length > 0) {
      return ancestor.self_pricing;
    }
  }
  return {
    base_fee: 2.0,
    per_km: 0.5,
    minimum_order: 5.0,
    service_fee_percent: 10,
  };
}

function computeEffectiveLimits(region, chain) {
  if (region.self_limits && Object.keys(region.self_limits).length > 0) {
    return region.self_limits;
  }
  for (const ancestor of chain.slice(1)) {
    if (ancestor.self_limits && Object.keys(ancestor.self_limits).length > 0) {
      return ancestor.self_limits;
    }
  }
  return {
    max_delivery_distance_km: 10,
    max_active_orders_per_driver: 3,
    min_driver_rating: 4.0,
  };
}

function computeEffectiveConfig(region, chain) {
  let config = {};

  // Apply from root -> leaf (reverse chain) so child overrides win
  for (let i = chain.length - 1; i >= 0; i--) {
    const r = chain[i];

    if (r.service_config) {
      for (const key of Object.keys(r.service_config)) {
        const value = r.service_config[key];

        if (value === false) {
          config[key] = false;
        } else if (value === true) {
          config[key] = true;
        } else if (typeof value === 'object' && value !== null) {
          if (!config[key] || typeof config[key] !== 'object') {
            config[key] = {};
          }
          Object.assign(config[key], value);
        }
      }
    }

    if (r.delivery_config && config.delivery === true) {
      config.delivery = { ...r.delivery_config };
    }
  }

  return config;
}

function findInheritanceSource(region, chain, fieldName) {
  if (region[fieldName] !== undefined) return region.regionId;
  for (const ancestor of chain.slice(1)) {
    if (ancestor[fieldName] !== undefined) return ancestor.regionId;
  }
  return 'default';
}

function computeEffectiveState(region, regionById) {
  const chain = [region];
  let current = region;

  while (true) {
    const parentId = getParentId(current);
    if (!parentId || parentId === 'ROOT' || parentId === 'root') break;

    const parent = regionById.get(parentId);
    if (!parent) break;

    chain.push(parent);
    current = parent;

    if (chain.length > 20) break;
  }

  const effectiveIsActiveBool = computeEffectiveActive(region, chain);

  return {
    regionId: region.regionId,
    parent_id: getParentId(region) || 'ROOT',
    level: region.level || 0,

    name: region.name || null,
    name_ar: region.name_ar || null,

    // stored as number (1/0) to match existing consumers
    effective_is_active: effectiveIsActiveBool ? 1 : 0,

    effective_pricing: computeEffectivePricing(region, chain),
    effective_limits: computeEffectiveLimits(region, chain),
    effective_config: computeEffectiveConfig(region, chain),

    inheritance_chain: chain.map((r) => r.regionId),
    inheritance_source: {
      is_active: findInheritanceSource(region, chain, 'is_active'),
      pricing: findInheritanceSource(region, chain, 'self_pricing'),
      limits: findInheritanceSource(region, chain, 'self_limits'),
    },

    computed_at: new Date().toISOString(),
    version: region.version || 1,
  };
}

async function scanAll(docClient, tableName, { onlyRegionId, limit }) {
  const items = [];
  let lastEvaluatedKey = undefined;

  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    const batch = res.Items || [];
    for (const item of batch) {
      if (onlyRegionId && item.regionId !== onlyRegionId) continue;
      items.push(item);
      if (limit && items.length >= limit) return items;
    }

    lastEvaluatedKey = res.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

async function batchWriteAll(docClient, tableName, items) {
  const batches = [];
  for (let i = 0; i < items.length; i += 25) {
    batches.push(items.slice(i, i + 25));
  }

  for (const batch of batches) {
    let requestItems = {
      [tableName]: batch.map((item) => ({ PutRequest: { Item: item } })),
    };

    // retry unprocessed
    for (let attempt = 1; attempt <= 10; attempt++) {
      const res = await docClient.send(
        new BatchWriteCommand({
          RequestItems: requestItems,
        })
      );

      const unprocessed = res.UnprocessedItems && res.UnprocessedItems[tableName];
      if (!unprocessed || unprocessed.length === 0) break;

      requestItems = { [tableName]: unprocessed };
      await new Promise((r) => setTimeout(r, 200 * attempt));

      if (attempt === 10) {
        throw new Error(`Too many unprocessed items; remaining: ${unprocessed.length}`);
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const awsRegion = process.env.AWS_REGION || 'us-east-1';

  console.log('Rebuild RegionsDerived');
  console.log(`- AWS_REGION: ${awsRegion}`);
  console.log(`- Regions table: ${args.regionsTable}`);
  console.log(`- Derived table: ${args.derivedTable}`);
  console.log(`- Dry run: ${args.dryRun}`);
  if (args.onlyRegionId) console.log(`- Only regionId: ${args.onlyRegionId}`);
  if (args.limit) console.log(`- Limit: ${args.limit}`);

  const client = new DynamoDBClient({ region: awsRegion });
  const docClient = DynamoDBDocumentClient.from(client);

  console.log('Scanning base regions...');
  const regions = await scanAll(docClient, args.regionsTable, {
    onlyRegionId: args.onlyRegionId,
    limit: args.limit,
  });
  console.log(`Found ${regions.length} region(s).`);

  const regionById = new Map();
  for (const r of regions) {
    if (r && r.regionId) regionById.set(r.regionId, r);
  }

  const derivedItems = [];
  for (const region of regions) {
    if (!region || !region.regionId) continue;
    derivedItems.push(computeEffectiveState(region, regionById));
  }

  console.log(`Computed ${derivedItems.length} derived item(s).`);

  if (args.dryRun) {
    const activeCount = derivedItems.filter((d) => d.effective_is_active === 1).length;
    console.log(`Dry-run summary: active=${activeCount} inactive=${derivedItems.length - activeCount}`);
    return;
  }

  console.log('Writing to derived table (batch write)...');
  await batchWriteAll(docClient, args.derivedTable, derivedItems);
  console.log('Done.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
