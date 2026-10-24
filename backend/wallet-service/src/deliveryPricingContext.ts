import { GetCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createHash } from 'node:crypto';
import { calculateDeliveryFee, validatePricingRules } from './deliveryPricing';
import { createCoveredDeliveryRouter, Point, RoutingError } from './roadRouting';
import { createDynamoRegionCoverage } from './regionCoverage';

type Row = Record<string, any>;
export class PricingContextError extends Error {
  constructor(public readonly code: 'INVALID_PRICING_REQUEST' | 'CUSTOMER_UNAVAILABLE' | 'ADDRESS_UNAVAILABLE' |
    'BRANCH_UNAVAILABLE' | 'PRICING_UNAVAILABLE' | 'PRICING_CONTEXT_CHANGED' | 'PRICING_REFERENCE_UNAVAILABLE') {
    super(code); this.name = 'PricingContextError';
  }
}
const has = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const fail = (code: PricingContextError['code']): never => { throw new PricingContextError(code); };
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 150 && !/[^A-Za-z0-9_.:-]/.test(v);
function fingerprint(value: unknown): string {
  function stable(v: any): any {
    return Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ?
      Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
  }
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
function location(value: Row): Point {
  const p = { latitude: value.latitude, longitude: value.longitude };
  if (typeof p.latitude !== 'number' || !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 ||
      typeof p.longitude !== 'number' || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) return fail('PRICING_REFERENCE_UNAVAILABLE');
  return Object.freeze(p);
}
const tables = { branches: 'WhizzMerchants_Businesses', addresses: 'WizzUser_addresses_staging',
  policy: 'staging-PlatformStaff', platform: 'staging-MerchantPlatform', deletion: 'staging-AccountDeletion' };

/** Internal composition, not an HTTP handler. authenticateCustomer must run the live customer account guard.
 * Its returned userId is the verified profile key, not a userId supplied in a request body.
 * This bridge supports saved addresses; guests and arbitrary submitted coordinates are not authorized here.
 */
export function createStagingDeliveryPricingContext(options: {
  db: Pick<DynamoDBDocumentClient, 'send'>;
  authenticateCustomer: () => Promise<{ userId: string; subjectId: string }>;
  router: ReturnType<typeof createCoveredDeliveryRouter>;
  now?: () => number;
}) {
  const { db, authenticateCustomer, router } = options;
  const now = options.now ?? Date.now;
  const resolveCoverage = createDynamoRegionCoverage({ db, tables: { regions: 'WizzCentral_Regions',
    derived: 'WizzCentral_RegionsDerived_staging', index: 'WizzCentral_RegionIndex_staging' } });
  async function get(table: string, key: Row, fields: string[]): Promise<Row | undefined> {
    const names: Record<string, string> = {};
    const projection = fields.map((field, i) => field.split('.').map((part, j) => {
      const alias = `#f${i}_${j}`; names[alias] = part; return alias;
    }).join('.')).join(', ');
    try {
      return (await db.send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true,
        ProjectionExpression: projection, ExpressionAttributeNames: names }))).Item;
    } catch { return fail('PRICING_REFERENCE_UNAVAILABLE'); }
  }
  async function customer() {
    try {
      const c = await authenticateCustomer();
      if (!c || !id(c.userId) || !id(c.subjectId) || c.userId === 'guest') return fail('CUSTOMER_UNAVAILABLE');
      return { userId: c.userId, subjectId: c.subjectId };
    } catch { return fail('CUSTOMER_UNAVAILABLE'); }
  }
  async function read(userId: string, branchId: string, addressId: string, needPricing: boolean) {
    const [branch, address, policy] = await Promise.all([
      get(tables.branches, { businessId: branchId }, ['businessId', 'branchId', 'ownerId', 'cognitoUserId', 'organizationId',
        'latitude', 'longitude', 'address.latitude', 'address.longitude', 'regionId', 'regionPath', 'status', 'isActive',
        'onboardingSchemaVersion', 'onboardingComplete', 'acceptingOrders', 'platformSuspended', 'ordersBlocked',
        'deletionRequestId', 'version', 'updatedAt', 'orderReceptionSettings', 'minimum_order']),
      get(tables.addresses, { addressId }, ['addressId', 'userId', 'latitude', 'longitude', 'deletionRequestId', 'updatedAt', 'version']),
      needPricing ? get(tables.policy, { pk: 'OPERATIONAL_SETTINGS#DELIVERY_PRICING', sk: 'CURRENT' }, ['pk', 'sk', 'version', 'values']) : undefined
    ]);
    if (!branch || branch.businessId !== branchId || (branch.branchId !== undefined && branch.branchId !== branchId) ||
        !id(branch.ownerId) || branch.cognitoUserId !== branch.ownerId || has(branch, 'deletionRequestId') ||
        !['approved', 'active'].includes(branch.status) || branch.isActive !== true ||
        (has(branch, 'onboardingSchemaVersion') && (branch.onboardingComplete !== true || branch.acceptingOrders !== true)) ||
        (has(branch, 'platformSuspended') && branch.platformSuspended !== false) ||
        (has(branch, 'ordersBlocked') && branch.ordersBlocked !== false)) return fail('BRANCH_UNAVAILABLE');
    if (!address || address.addressId !== addressId || address.userId !== userId || has(address, 'deletionRequestId')) return fail('ADDRESS_UNAVAILABLE');
    let bundle: ReturnType<typeof validatePricingRules> = { deliveryRules: [], driverRules: [] };
    if (needPricing) {
    if (!policy || policy.pk !== 'OPERATIONAL_SETTINGS#DELIVERY_PRICING' || policy.sk !== 'CURRENT' ||
        !Number.isSafeInteger(policy.version) || policy.version < 1 ||
        Buffer.byteLength(JSON.stringify(policy.values) ?? '', 'utf8') > 160000) return fail('PRICING_UNAVAILABLE');
    try {
      bundle = validatePricingRules(policy.values);
      if (!bundle.deliveryRules.length) return fail('PRICING_UNAVAILABLE');
      if ([...bundle.deliveryRules, ...bundle.driverRules].some(r => !['PUBLISHED', 'ARCHIVED'].includes(r.status as string))) return fail('PRICING_UNAVAILABLE');
    } catch { return fail('PRICING_UNAVAILABLE'); }
    }
    // The current create-order writer consumes top-level coordinates. Do not silently choose a conflicting address copy.
    const origin = location(branch), destination = location(address);
    if (branch.address && (branch.address.latitude !== undefined || branch.address.longitude !== undefined)) {
      const copy = location(branch.address);
      if (copy.latitude !== origin.latitude || copy.longitude !== origin.longitude) return fail('BRANCH_UNAVAILABLE');
    }
    const [branchDeletion, ownerDeletion, organization] = await Promise.all([
      get(tables.deletion, { pk: 'BUSINESS_LIFECYCLE#MERCHANT#' + branchId, sk: 'META' }, ['pk']),
      get(tables.deletion, { pk: 'ACCOUNT_LIFECYCLE#MERCHANT#' + branch.ownerId, sk: 'META' }, ['pk']),
      branch.organizationId !== undefined ? (id(branch.organizationId) ?
        get(tables.platform, { pk: 'PERSON#' + branch.ownerId, sk: 'ORGANIZATION#' + branch.organizationId },
          ['pk', 'sk', 'organizationId', 'subjectId', 'version', 'deletionRequestId']) : fail('BRANCH_UNAVAILABLE')) : undefined
    ]);
    if (branchDeletion || ownerDeletion) return fail('BRANCH_UNAVAILABLE');
    if (branch.organizationId !== undefined && (!organization || organization.organizationId !== branch.organizationId ||
        organization.subjectId !== branch.ownerId || has(organization, 'deletionRequestId'))) return fail('BRANCH_UNAVAILABLE');
    // Missing organization on legacy branches never matches a MERCHANT rule by guessing from owner/phone/name.
    // Level 2 in the current reference is a district, not a proven CITY entity. Do not guess a city binding.
    const rules = bundle.deliveryRules.filter(r => (r.scope as Row).type !== 'CITY' &&
      (organization || (r.scope as Row).type !== 'MERCHANT'));
    return { branch, address, policy, organization: organization ?? null, origin, destination, rules,
      referenceVersion: fingerprint({ branch, address, policy, organization: organization ?? null }) };
  }
  async function resolve(input: unknown, needPricing: boolean) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_PRICING_REQUEST');
      const request = input as Row;
      if (Object.keys(request).length !== 2 || !id(request.branchId) || !id(request.addressId)) return fail('INVALID_PRICING_REQUEST');
      const { branchId, addressId } = request;
      const identity = await customer();
      const first = await read(identity.userId, branchId, addressId, needPricing);
      const binding = await router.getDeliveryRoute(first.origin, first.destination);
      const [currentIdentity, latest, originCoverage, coverage] = await Promise.all([
        customer(), read(identity.userId, branchId, addressId, needPricing), resolveCoverage(first.origin), resolveCoverage(first.destination)
      ]);
      if (fingerprint(identity) !== fingerprint(currentIdentity) || first.referenceVersion !== latest.referenceVersion) return fail('PRICING_CONTEXT_CHANGED');
      if (!originCoverage || originCoverage.regionId !== binding.originCoverage.regionId ||
          originCoverage.referenceVersion !== binding.originCoverage.referenceVersion ||
          !coverage || coverage.regionId !== binding.destinationCoverage.regionId ||
          coverage.referenceVersion !== binding.destinationCoverage.referenceVersion) throw new RoutingError('OUTSIDE_COVERAGE');
      if ((first.branch.regionId !== undefined && first.branch.regionId !== originCoverage.regionId) ||
          (first.branch.regionPath !== undefined && fingerprint(first.branch.regionPath) !== fingerprint(originCoverage.regionPath))) return fail('BRANCH_UNAVAILABLE');
      const context = Object.freeze({ branchId, merchantId: first.organization?.organizationId ?? 'UNBOUND_MERCHANT',
        zoneId: coverage.regionId, cityId: 'UNBOUND_CITY', governorateId: coverage.governorateId, vehicleType: 'UNASSIGNED' });
      const at = new Date(now()).toISOString();
      return { first, binding, context, at, branchId, addressId };
  }
  return Object.freeze({
    async routeInformation(input: unknown) {
      const {first,binding,at,branchId,addressId}=await resolve(input,false);
      return Object.freeze({schemaVersion:1,kind:'STOREFRONT_ROUTE',branchId,addressId,createdAt:at,
        expiresAt:binding.route.expiresAt,roadDistanceMeters:binding.route.distanceMeters,
        deliveryDurationSeconds:binding.route.durationSeconds,
        preparationMinutes:first.branch.orderReceptionSettings?.defaultPreparationMinutes??null,
        minimumOrderAmountIqd:first.branch.minimum_order??null});
    },
    async calculate(input: unknown) {
      const {first,binding,context,at,branchId,addressId}=await resolve(input,true);
      const calculation = calculateDeliveryFee({ schemaVersion: 1, at, context, rules: first.rules,
        deliveryRoute: binding.route, discount: null });
      return Object.freeze({ schemaVersion: 1, at, branchId, addressId, policyVersion: first.policy!.version,
        context, binding, calculation, minimumOrderAmountIqd:first.branch.minimum_order??null, preparationMinutes: first.branch.orderReceptionSettings?.defaultPreparationMinutes ?? null, pricingRequest:{schemaVersion:1,at,context,rules:first.rules,deliveryRoute:binding.route,discount:null}, referenceVersion: first.referenceVersion });
    }
  });
}
