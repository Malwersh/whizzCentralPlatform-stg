#!/usr/bin/env node

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  BatchWriteCommand,
} = require('@aws-sdk/lib-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';

const SOURCE_TABLE =
  process.env.SOURCE_TABLE || 'WizzCentral_RegionsDerived_dev';
const TARGET_TABLE =
  process.env.TARGET_TABLE || 'WizzCentral_RegionsDerived_staging';

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_REGION_ID = (() => {
  const arg = process.argv.find((a) => a.startsWith('--regionId='));
  return arg ? arg.split('=')[1] : null;
})();

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function batchWriteAll(ddbDoc, requestItems) {
  let unprocessed = requestItems;
  let attempt = 0;

  while (Object.keys(unprocessed).length > 0) {
    attempt += 1;

    if (DRY_RUN) {
      console.log(`[DRY RUN] Would batchWrite ${unprocessed[TARGET_TABLE].length} items to ${TARGET_TABLE}`);
      return;
    }

    const resp = await ddbDoc.send(
      new BatchWriteCommand({
        RequestItems: unprocessed,
      })
    );

    const next = resp.UnprocessedItems || {};
    const remaining = next[TARGET_TABLE]?.length || 0;

    if (remaining === 0) return;

    unprocessed = next;

    const backoffMs = Math.min(2000 * attempt, 10000);
    console.warn(
      `⚠️ Unprocessed items: ${remaining}. Retrying in ${backoffMs}ms (attempt ${attempt})...`
    );
    await sleep(backoffMs);
  }
}

async function main() {
  console.log('📦 Copy RegionsDerived dev -> staging');
  console.log(`- Region: ${REGION}`);
  console.log(`- Source: ${SOURCE_TABLE}`);
  console.log(`- Target: ${TARGET_TABLE}`);
  if (ONLY_REGION_ID) console.log(`- Filter: regionId=${ONLY_REGION_ID}`);
  if (DRY_RUN) console.log('- Mode: DRY RUN');

  const ddb = new DynamoDBClient({ region: REGION });
  const ddbDoc = DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true },
  });

  let startKey = undefined;
  let totalRead = 0;
  let totalWritten = 0;

  do {
    const scanParams = {
      TableName: SOURCE_TABLE,
      ExclusiveStartKey: startKey,
    };

    // Use Scan + filter in memory; table is expected to be small (regions only)
    const page = await ddbDoc.send(new ScanCommand(scanParams));

    const items = page.Items || [];
    totalRead += items.length;

    const filtered = ONLY_REGION_ID
      ? items.filter((it) => it.regionId === ONLY_REGION_ID)
      : items;

    if (filtered.length > 0) {
      for (const group of chunk(filtered, 25)) {
        const putRequests = group.map((item) => ({
          PutRequest: { Item: item },
        }));

        await batchWriteAll(ddbDoc, {
          [TARGET_TABLE]: putRequests,
        });

        totalWritten += group.length;
        console.log(`✅ Wrote ${totalWritten} items so far...`);
      }
    }

    startKey = page.LastEvaluatedKey;
  } while (startKey);

  console.log('✅ Done.');
  console.log(`- Read:    ${totalRead}`);
  console.log(`- Written: ${totalWritten}`);

  if (totalWritten === 0) {
    console.warn('⚠️ No items written. If source is empty, populate dev table first.');
  }
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exitCode = 1;
});
