import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { assertDeliveryFundingPolicyPin } from './deliveryFundingPolicy';
import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';
// Reuse existing authority implementations, not a second role/manager catalog.
const {allowed} = require('../../staff-service/catalog');
const {resolve: resolveParty} = require('../../staff-service/commercial-party');
type Row = Record<string, any>;
const P = 'staging-MerchantPlatform', S = 'staging-PlatformStaff', B = 'WhizzMerchants_Businesses', L = 'staging-AccountDeletion';
export class DeliveryFundingReaderError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'DeliveryFundingReaderError'; }
}
const fail = (code = 'DELIVERY_POLICY_UNAVAILABLE'): never => { throw new DeliveryFundingReaderError(code); };
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function pin(table: string, key: Row, value: Row) {
  const names: Row = {}, values: Row = {}, clauses: string[] = [];
  Object.keys(value).sort().forEach((k, i) => {names['#f'+i] = k; values[':f'+i] = copy(value[k]); clauses.push('#f'+i+'=:f'+i);});
  const condition = clauses.join(' AND ');
  if (!clauses.length || Buffer.byteLength(condition) > 3900 || Buffer.byteLength(JSON.stringify(value)) > 100000) return fail();
  return {ConditionCheck: {TableName: table, Key: key, ConditionExpression: condition, ExpressionAttributeNames: names, ExpressionAttributeValues: values}};
}
function instant(v: unknown): number {
  if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) return fail(); return Date.parse(v);
}
/** Internal staging reader for a server-selected exact policy pin. This is NOT
 * discovery, an HTTP route, quote consumption or permission to spend. Returned
 * fences MUST join the order transaction alongside usage/budget reservations.
 * No client-supplied policy selection or copied eligibility facts are trusted.
 */
export function createStagingDeliveryFundingReader(options: {db: Pick<DynamoDBDocumentClient, 'send'>; now?: () => number; lifecycleReadMode?: 'GET' | 'CONDITION_CHECK'}) {
  const {db} = options, now = options.now ?? Date.now;
  if(options.lifecycleReadMode!==undefined&&!['GET','CONDITION_CHECK'].includes(options.lifecycleReadMode))return fail();
  async function get(table: string, key: Row): Promise<Row> {
    try { const item = (await db.send(new GetCommand({TableName: table, Key: key, ConsistentRead: true}))).Item;
      if (!item) return fail(); return copy(item);
    } catch (e) { if (e instanceof DeliveryFundingReaderError) throw e; return fail(); }
  }
  return Object.freeze({async prepare(input: unknown) {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
      const r = input as Row;
      if (Object.keys(r).sort().join(',') !== 'branchId,policyPin' || !quoteEntityIdValid(r.branchId) ||
          !r.policyPin || !quoteEntityIdValid(r.policyPin.policyId) || !Number.isSafeInteger(r.policyPin.version) || r.policyPin.version < 1) return fail();
      const branchKey = {businessId: r.branchId}, branch = await get(B, branchKey);
      if (branch.businessId !== r.branchId || !quoteEntityIdValid(branch.ownerId) || branch.cognitoUserId !== branch.ownerId ||
          !quoteEntityIdValid(branch.organizationId) || branch.isActive !== true || branch.status !== 'approved' ||
          branch.deletionRequestId != null || branch.deletedAt != null || branch.isDeleted === true || branch.platformSuspended === true || branch.ordersBlocked === true ||
          (branch.onboardingSchemaVersion !== undefined && (branch.onboardingComplete !== true || branch.acceptingOrders !== true))) return fail();
      const orgKey = {pk:'PERSON#'+branch.ownerId, sk:'ORGANIZATION#'+branch.organizationId};
      const key = {pk:'DELIVERY_FUNDING#'+r.policyPin.policyId, sk:'CURRENT'};
      const [org,current] = await Promise.all([get(P,orgKey),get(S,key)]);
      if (org.subjectId !== branch.ownerId || org.organizationId !== branch.organizationId || org.deletionRequestId != null || org.deletedAt != null || org.isDeleted === true) return fail();
      if (current.pk !== key.pk || current.sk !== key.sk || current.schemaVersion !== 1 || current.status !== 'ACTIVE' ||
          current.id !== r.policyPin.policyId || current.version !== r.policyPin.version || current.termsHash !== r.policyPin.termsHash ||
          current.activationMode !== 'STAFF_SEND_MERCHANT_ACCEPT') return fail();
      const resolved = assertDeliveryFundingPolicyPin(current.policy, r.policyPin), policy = resolved.policy, clock = now();
      if (!Number.isSafeInteger(clock) || policy.branchId !== branch.businessId || policy.merchantId !== branch.organizationId ||
          clock < instant(policy.effectiveFrom) || clock >= instant(policy.effectiveTo) ||
          instant(current.approvedAt) > instant(current.acceptedAt) || instant(current.acceptedAt) !== instant(current.activatedAt) || instant(current.activatedAt) > clock) return fail();
      const versionKey = {pk:key.pk, sk:'VERSION#'+current.version}, version = await get(S, versionKey);
      if (quoteHash({...version, sk:'CURRENT'}) !== quoteHash(current)) return fail('DELIVERY_POLICY_HISTORY_MISMATCH');
      if (!quoteEntityIdValid(current.approvedBy) || !quoteEntityIdValid(current.acceptedBy)) return fail();
      const authorKey = {pk:'EMPLOYEE#'+current.approvedBy, sk:'PROFILE'}, author = await get(S, authorKey);
      if (author.employeeId !== current.approvedBy || author.status !== 'ACTIVE' || !allowed(author, 'commercial.funding.request') || author.scope?.allRegions !== true) return fail('DELIVERY_POLICY_AUTHORITY_REVOKED');
      const party = await resolveParty(db, branch, current.acceptedBy);
      const fences: any[] = [pin(B,branchKey,branch), pin(P,orgKey,org), pin(S,key,current), pin(S,versionKey,version), pin(S,authorKey,author), ...party.guards];
      const lifecycleChecks=['ACCOUNT_LIFECYCLE#MERCHANT#'+branch.ownerId,'BUSINESS_LIFECYCLE#MERCHANT#'+branch.businessId].map(pk=>({ConditionCheck:{TableName:L,Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}}));
      if(options.lifecycleReadMode==='CONDITION_CHECK'){
        // The Creator already has ConditionCheckItem, not GetItem, on these guards.
        // This transaction has no mutations. Keep the same guards in the eventual order transaction.
        try{await db.send(new TransactWriteCommand({TransactItems:lifecycleChecks}));}
        catch(e){if((e as any)?.name==='TransactionCanceledException'&&(e as any)?.CancellationReasons?.some((r:Row)=>r.Code==='ConditionalCheckFailed'))return fail('DELIVERY_POLICY_AUTHORITY_REVOKED');return fail();}
      }else{
        for(const check of lifecycleChecks){const state=await db.send(new GetCommand({TableName:L,Key:check.ConditionCheck.Key,ConsistentRead:true}));if(state.Item)return fail('DELIVERY_POLICY_AUTHORITY_REVOKED');}
      }
      fences.push(...lifecycleChecks);
      return {policy: resolved.policy, policyPin: copy(r.policyPin), validUntil: policy.effectiveTo, referenceDigest: quoteHash({branch,org,current,author,party: {role:party.role,subjectId:party.subjectId},fences}), operations:fences};
    } catch (e) { if (e instanceof DeliveryFundingReaderError) throw e; return fail(); }
  }});
}
