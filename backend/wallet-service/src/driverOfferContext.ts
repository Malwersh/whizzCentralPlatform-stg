import {buildFullCashOffer} from './fullCashOffer';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { createStagingDriverOfferOrderReader } from './driverOfferOrderReader';
import { buildDeliveryFundedOffer } from './deliveryFundedOffer';
import { buildDriverOffer } from './driverOffer';
import { validatePricingRules } from './deliveryPricing';
import { BoundRoadRoute } from './roadRouting';
import { quoteEntityIdValid } from './deliveryQuoteRecord';

type Row = Record<string, any>;
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const tables = { assignment: 'WizzDispatchJobs_staging', driver: 'WhizzDrivers_staging',
  position: 'WizzDriverLiveState_staging', policy: 'staging-PlatformStaff', branch: 'WhizzMerchants_Businesses', deletion: 'staging-AccountDeletion' };
const fields = {
  assignment: ['orderId','SK','dispatchJobId','restaurantId','status','currentWaveNumber','expiresAt','assignedDriverId','driverId','deletionRequestId','financialExcludedDriverIds','financialRedispatch','dispatchCycle','dispatchTransition'],
  driver: ['isActive','driverId','cognitoSub','status','registrationStatus','vehicleType','deletionRequestId','deletedAt','isDeleted','isSuspended','isBanned'],
  position: ['driverId','status','isActive','isSearching','lat','lng','locationUpdatedAt','currentOrderId','activeOrdersCount'],
  policy: ['pk','sk','version','values'],
  branch: ['businessId','ownerId','cognitoUserId','organizationId','status','deletionRequestId','deletedAt','isDeleted']
};
export class DriverOfferContextError extends Error {
  constructor(public readonly code: 'INVALID_DRIVER_OFFER_CONTEXT' | 'DRIVER_OFFER_REFERENCE_UNAVAILABLE' |
    'DRIVER_OFFER_ASSIGNMENT_UNAVAILABLE' | 'DRIVER_OFFER_DRIVER_UNAVAILABLE' | 'DRIVER_OFFER_POSITION_UNAVAILABLE' |
    'DRIVER_OFFER_BRANCH_UNAVAILABLE' | 'DRIVER_OFFER_POLICY_UNAVAILABLE') {
    super(code); this.name = 'DriverOfferContextError';
  }
}
const fail = (code: DriverOfferContextError['code']): never => { throw new DriverOfferContextError(code); };
function date(v: unknown): number {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)) return NaN;
  const ms = Date.parse(v); return Number.isFinite(ms) && new Date(ms).toISOString() === v ? ms : NaN;
}
function fence(table: string, key: Row, row: Row, selected: string[]) {
  const names: Row = {}, values: Row = {}, conditions: string[] = [];
  selected.forEach((field, i) => {
    names['#f'+i] = field;
    if (row[field] === undefined) conditions.push(`attribute_not_exists(#f${i})`);
    else { conditions.push(`#f${i}=:v${i}`); values[':v'+i] = copy(row[field]); }
  });
  return { ConditionCheck: { TableName: table, Key: key, ConditionExpression: conditions.join(' AND '),
    ExpressionAttributeNames: names, ExpressionAttributeValues: values } };
}
/** Trusted server preparation from fixed Staging sources, never from client prices/routes/guards.
 * No writes, selection of a winner, notification or wallet operation. Caller must save returned input
 * through driverOfferStore, retaining that exact proposal for retry. Router must be server-owned.
 */
export function createStagingDriverOfferContext(options: {
  db: Pick<DynamoDBDocumentClient, 'send'>;
  cognito: Pick<CognitoIdentityProviderClient, 'send'>;
  router: { getRoute(origin: unknown, destination: unknown): Promise<BoundRoadRoute> };
  positionMaxAgeSeconds: number;
  offerTtlSeconds: number;
  offerDeadline?: string;
  enableDeliveryFunding?: boolean;
  enableFullCash?: boolean;
  now?: () => number;
}) {
  const { db, cognito, router, positionMaxAgeSeconds, offerTtlSeconds } = options, now = options.now ?? Date.now;
  if (![positionMaxAgeSeconds, offerTtlSeconds].every(n => Number.isSafeInteger(n) && n >= 1 && n <= 900)) return fail('INVALID_DRIVER_OFFER_CONTEXT');
  if(options.offerDeadline!==undefined&&!Number.isFinite(date(options.offerDeadline)))return fail('INVALID_DRIVER_OFFER_CONTEXT');
  const orderReader = createStagingDriverOfferOrderReader({ db,enableDeliveryFunding:options.enableDeliveryFunding,enableFullCash:options.enableFullCash });
  async function get(table: string, key: Row, selected: string[]): Promise<Row> {
    const names = Object.fromEntries(selected.map((f,i) => ['#f'+i,f]));
    try { return copy((await db.send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true,
      ProjectionExpression: Object.keys(names).join(','), ExpressionAttributeNames: names }))).Item ?? {}); }
    catch { return fail('DRIVER_OFFER_REFERENCE_UNAVAILABLE'); }
  }
  async function identity(subjectId: string) {
    try {
      const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: 'us-east-1_RGTqUXF5C', Username: subjectId }));
      const attrs = user.UserAttributes ?? [];
      if (user.Enabled !== true || user.Username !== subjectId || attrs.filter(v => v.Name === 'sub').length !== 1 ||
          attrs.find(v => v.Name === 'sub')?.Value !== subjectId || user.UserStatus !== 'CONFIRMED') return fail('DRIVER_OFFER_DRIVER_UNAVAILABLE');
    } catch { return fail('DRIVER_OFFER_DRIVER_UNAVAILABLE'); }
  }
  async function references(value: unknown, accepting = false) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'branchId,driverId,offerId,orderId,waveNumber') return fail('INVALID_DRIVER_OFFER_CONTEXT');
    const request = copy(value as Row), { orderId, branchId, driverId, waveNumber, offerId } = request;
    if (![orderId,branchId,driverId,offerId].every(quoteEntityIdValid) || !Number.isSafeInteger(waveNumber) || waveNumber < 1 || waveNumber > 1000) return fail('INVALID_DRIVER_OFFER_CONTEXT');
    const aKey = {orderId,SK:'METADATA'}, dKey = {driverId}, pKey = {pk:'OPERATIONAL_SETTINGS#DELIVERY_PRICING',sk:'CURRENT'}, bKey = {businessId:branchId};
    const [order,assignment,driver,position,policy,branch] = await Promise.all([
      orderReader.read({orderId,branchId}), get(tables.assignment,aKey,fields.assignment), get(tables.driver,dKey,fields.driver),
      get(tables.position,dKey,fields.position), get(tables.policy,pKey,fields.policy), get(tables.branch,bKey,fields.branch)
    ]);
    const time = now();
    if (!Number.isSafeInteger(time)) return fail('DRIVER_OFFER_REFERENCE_UNAVAILABLE');
    if (assignment.orderId !== orderId || assignment.SK !== 'METADATA' || !quoteEntityIdValid(assignment.dispatchJobId) ||
        assignment.restaurantId !== branchId || assignment.status !== 'searching' || assignment.currentWaveNumber !== waveNumber-(accepting ? 0 : 1) ||
        !Number.isFinite(date(assignment.expiresAt)) || date(assignment.expiresAt) <= time ||
        assignment.assignedDriverId != null || assignment.driverId != null || assignment.deletionRequestId != null) return fail('DRIVER_OFFER_ASSIGNMENT_UNAVAILABLE');
    if(assignment.financialExcludedDriverIds!==undefined&&(!Array.isArray(assignment.financialExcludedDriverIds)||assignment.financialExcludedDriverIds.includes(driverId)))return fail('DRIVER_OFFER_DRIVER_UNAVAILABLE');
    const blocked = ['BANNED','SUSPENDED','REJECTED','PENDING_REVIEW','PENDING_PROFILE','PENDING_DOCS'];
    const statuses = [driver.status,driver.registrationStatus].filter(v => v !== undefined).map(v => String(v).toUpperCase());
    const subjectId = driver.cognitoSub ?? driverId;
    if ((driver.isActive !== undefined && driver.isActive !== true) || driver.driverId !== driverId || !quoteEntityIdValid(subjectId) || !quoteEntityIdValid(driver.vehicleType) ||
        !statuses.some(v => ['APPROVED','VERIFIED'].includes(v)) || statuses.some(v => blocked.includes(v)) ||
        driver.deletionRequestId != null || driver.deletedAt != null || (driver.isDeleted !== undefined && driver.isDeleted !== false) ||
        (driver.isSuspended !== undefined && driver.isSuspended !== false) || (driver.isBanned !== undefined && driver.isBanned !== false)) return fail('DRIVER_OFFER_DRIVER_UNAVAILABLE');
    const observed = date(position.locationUpdatedAt);
    if (position.driverId !== driverId || position.status !== 'available' || position.isActive !== true || position.isSearching !== true ||
        position.currentOrderId != null || (position.activeOrdersCount !== undefined && position.activeOrdersCount !== 0) ||
        !Number.isFinite(observed) || observed <= 0 || observed > time || observed + positionMaxAgeSeconds*1000 <= time ||
        typeof position.lat !== 'number' || !Number.isFinite(position.lat) || Math.abs(position.lat)>90 ||
        typeof position.lng !== 'number' || !Number.isFinite(position.lng) || Math.abs(position.lng)>180) return fail('DRIVER_OFFER_POSITION_UNAVAILABLE');
    if (branch.businessId !== branchId || !quoteEntityIdValid(branch.ownerId) || branch.ownerId !== branch.cognitoUserId ||
        branch.organizationId !== order.snapshot.merchantId || branch.status !== 'approved' ||
        branch.deletionRequestId != null || branch.deletedAt != null || (branch.isDeleted !== undefined && branch.isDeleted !== false)) return fail('DRIVER_OFFER_BRANCH_UNAVAILABLE');
    let bundle: ReturnType<typeof validatePricingRules>;
    try {
      if (policy.pk !== pKey.pk || policy.sk !== pKey.sk || !Number.isSafeInteger(policy.version) || policy.version < 1 ||
          Buffer.byteLength(JSON.stringify(policy.values) ?? '') > 160000) return fail('DRIVER_OFFER_POLICY_UNAVAILABLE');
      bundle = validatePricingRules(policy.values);
      if (!bundle.driverRules.length || [...bundle.deliveryRules,...bundle.driverRules].some(r => !['PUBLISHED','ARCHIVED'].includes(String(r.status)))) return fail('DRIVER_OFFER_POLICY_UNAVAILABLE');
    } catch { return fail('DRIVER_OFFER_POLICY_UNAVAILABLE'); }
    const locks = [...new Set(['ACCOUNT_LIFECYCLE#DRIVER#'+subjectId,'ACCOUNT_LIFECYCLE#DRIVER#'+driverId,
      'BUSINESS_LIFECYCLE#MERCHANT#'+branchId,'ACCOUNT_LIFECYCLE#MERCHANT#'+branch.ownerId])];
    const deleted = await Promise.all(locks.map(pk => get(tables.deletion,{pk,sk:'META'},['pk','sk'])));
    if (deleted.some(v => Object.keys(v).length)) return fail('DRIVER_OFFER_REFERENCE_UNAVAILABLE');
    await identity(subjectId);
    return copy({request,order,assignment,driver,position,policy,bundle,subjectId,observed,guards:{assignment:fence(tables.assignment,aKey,assignment,fields.assignment),
      driver:fence(tables.driver,dKey,driver,fields.driver),position:fence(tables.position,dKey,position,fields.position),
      policy:fence(tables.policy,pKey,policy,fields.policy),branch:fence(tables.branch,bKey,branch,fields.branch),
      deletions:locks.map(pk => ({ConditionCheck:{TableName:tables.deletion,Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}}))}});
  }
  return Object.freeze({
    checkAcceptance: (value: unknown) => references(value, true),
    async prepare(value: unknown) {
      const r = await references(value);
      const {request,order,assignment,driver,position,policy,bundle,subjectId,observed} = r;
      const point = {latitude:position.lat,longitude:position.lng};
      const [pickupRoute,deliveryRoute] = await Promise.all([
        router.getRoute(point,order.snapshot.branchPoint),router.getRoute(order.snapshot.branchPoint,order.snapshot.customerPoint)
      ]);
      await identity(subjectId);
      const offer = buildDriverOffer({schemaVersion:1,offerId:request.offerId,
        assignment:{id:assignment.dispatchJobId,version:request.waveNumber,expiresAt:new Date(Math.min(date(assignment.expiresAt),date(options.offerDeadline??assignment.expiresAt))).toISOString()},
        driver:{id:request.driverId,subjectId,vehicleType:driver.vehicleType,positionVersion:observed,point,
          observedAt:position.locationUpdatedAt,expiresAt:new Date(observed+positionMaxAgeSeconds*1000).toISOString()},
        order:order.snapshot,policy:{version:policy.version,rules:bundle.driverRules},pickupRoute,deliveryRoute,
        at:new Date(now()).toISOString(),ttlSeconds:offerTtlSeconds});
      return copy({offer:order.settlementModel==='FULL_CASH_AT_DELIVERY_V1'?buildFullCashOffer({schemaVersion:3,base:offer.source,deliveryFunding:order.deliveryFunding??null}):order.deliveryFunding?buildDeliveryFundedOffer({schemaVersion:2,base:offer.source,deliveryFunding:order.deliveryFunding}):offer,waveNumber:request.waveNumber,guards:r.guards});
    }
  });
}
