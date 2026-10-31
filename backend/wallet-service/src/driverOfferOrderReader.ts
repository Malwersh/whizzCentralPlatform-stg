import {prepareFullCashOrderSnapshot} from './fullCashOffer';
import { prepareDeliveryFundedFinancialSnapshot } from './deliveryFundedOffer';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { exactCheck } from './driverFinancialTransaction';
import { validateDriverOfferOrderSnapshot } from './driverOffer';
import { quoteCanonical, quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';

type Row = Record<string, any>;
const TABLE = 'WizzOrders';
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const fields = ['PK', 'SK', 'orderId', 'storeId', 'businessId', 'merchantId', 'status', 'orderStatus', 'driverId', 'assignedDriverId',
  'deletionRequestId', 'deletionStatus', 'isDeleted', 'deletedAt', 'financialSnapshot', 'holdId', 'holdStatus', 'holdAmount',
  'walletPendingHoldId', 'financialAcceptance', 'assignmentAttemptCounter', 'financialRelease', 'financialOutcome', 'returnStatus', 'returnCaseId', 'cancellationStatus', 'cancellationRequestId', 'items', 'storeName', 'storeImage', 'storeAddress', 'estimatedReadyAt','commercialPricing','customerName','deliveryAddress'];
export class DriverOfferOrderReadError extends Error {
  constructor(public readonly code: 'INVALID_DRIVER_OFFER_ORDER_READ' | 'DRIVER_OFFER_ORDER_UNAVAILABLE' |
    'DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED' | 'DRIVER_OFFER_PAYMENT_READER_REQUIRED') {
    super(code); this.name = 'DriverOfferOrderReadError';
  }
}
function fail(code: DriverOfferOrderReadError['code']): never { throw new DriverOfferOrderReadError(code); }
function exact(v: unknown, keys: string[]): Row {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join(',') !== keys.sort().join(',')) return fail('DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED');
  return v as Row;
}
/** Display-only order data. Canonical item unitPrice is IQD minor units (scale 1000).
 * Target-driver display includes recipient name/address only; never phone, or compensation inputs. */
export function driverOfferDisplay(saved: Row) {
  if(saved.items===undefined)return null; // Older envelopes remain readable without invented items.
  const text=(v:any,max:number)=>typeof v==='string'?v.slice(0,max):'';
  const image=(v:any)=>typeof v==='string'&&v.length<=2048&&/^https:\/\//.test(v)?v:null;
  if(!Array.isArray(saved.items)||!saved.items.length||saved.items.length>100)throw Error('DRIVER_OFFER_DISPLAY_INVALID');
  const items=saved.items.map((item:Row)=>{
    if(!item||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>1000||
      !Number.isSafeInteger(item.unitPrice)||item.unitPrice<0||!Number.isSafeInteger(item.unitPrice*item.quantity)||
      typeof item.name!=='string'||!item.name.trim())throw Error('DRIVER_OFFER_DISPLAY_INVALID');
    return {itemId:text(item.itemId,150),name:text(item.name,300),quantity:item.quantity,
      unitPrice:{moneySchemaVersion:1,currency:'IQD',scale:1000,minorAmount:item.unitPrice},
      imageUrl:image(item.imageUrl),notes:text(item.notes,1000),
      modifiers:Array.isArray(item.modifiers)?item.modifiers.map((v:Row)=>text(v?.name,200)).filter(Boolean).slice(0,30):[]};
  });
  const address=saved.deliveryAddress;
  const recipientAddress=typeof address==='string'?address:address?.fullAddress||address?.detailedAddress||address?.addressLine1;
  return {schemaVersion:1,customer:{name:text(saved.customerName,300),address:text(recipientAddress,1000)},restaurant:{name:text(saved.storeName,300),imageUrl:image(saved.storeImage),
    address:text(typeof saved.storeAddress==='string'?saved.storeAddress:saved.storeAddress?.fullAddress,1000)},
    items,lineCount:items.length,totalQuantity:items.reduce((n:number,i:Row)=>n+i.quantity,0)};
}

/** Internal envelope for a future trusted order pricing writer. This does NOT establish the origin of
 * the amounts or persist them. No legacy/Quote-only migration and no inferred zero charges. */
export function prepareDriverOfferFinancialSnapshot(value: unknown) {
  try {
    const snapshot = copy(validateDriverOfferOrderSnapshot(value));
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 100000) return fail('DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED');
    const content = { schemaVersion: 1, kind: 'ORDER_FINANCIAL_SNAPSHOT', snapshot };
    return { ...content, digest: quoteHash(content) };
  } catch { return fail('DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED'); }
}
/** Server-only strongly consistent COD source adapter. Not an HTTP endpoint or driver authorization.
 * IAM must restrict who can write financialSnapshot: its hash is integrity checking, NOT a signature.
 * The returned ConditionCheck must be composed into issuance/acceptance's atomic transaction. A
 * read alone does not fence changes, select a winner, check deletion locks, reserve funding or hold money.
 */
export function createStagingDriverOfferOrderReader(options: { db: Pick<DynamoDBDocumentClient, 'send'>;enableDeliveryFunding?:boolean;enableFullCash?:boolean }) {
  return Object.freeze({ async read(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'branchId,orderId' ||
        !quoteEntityIdValid((value as Row).orderId) || !quoteEntityIdValid((value as Row).branchId)) return fail('INVALID_DRIVER_OFFER_ORDER_READ');
    const { orderId, branchId } = copy(value as Row), key = { PK: 'ORDER#' + orderId, SK: 'META' };
    const names = Object.fromEntries(fields.map((f, i) => ['#f' + i, f]));
    let saved: Row | undefined;
    try {
      saved = (await options.db.send(new GetCommand({ TableName: TABLE, Key: key, ConsistentRead: true,
        ProjectionExpression: Object.keys(names).join(', '), ExpressionAttributeNames: names }))).Item;
    } catch { return fail('DRIVER_OFFER_ORDER_UNAVAILABLE'); }
    if (!saved || saved.PK !== key.PK || saved.SK !== key.SK || saved.orderId !== orderId ||
        ![saved.status, saved.orderStatus].some(v => v === 'ready_for_pickup') ||
        [saved.status, saved.orderStatus].some(v => v !== undefined && v !== 'ready_for_pickup') || saved.driverId != null || saved.assignedDriverId != null ||
        saved.holdId != null || saved.walletPendingHoldId != null || saved.financialAcceptance != null ||
        saved.financialOutcome != null || saved.returnStatus != null || saved.returnCaseId != null || saved.cancellationStatus != null || saved.cancellationRequestId != null || saved.deletionRequestId != null || saved.deletionStatus != null || saved.deletedAt != null || (saved.isDeleted !== undefined && saved.isDeleted !== false)) return fail('DRIVER_OFFER_ORDER_UNAVAILABLE');
    const previousAttempt=saved.assignmentAttemptCounter??0;
    let priorRelease:Row|null=null,releaseCondition:Row|null=null;
    if(!Number.isSafeInteger(previousAttempt)||previousAttempt<0||previousAttempt>=1000)return fail('DRIVER_OFFER_ORDER_UNAVAILABLE');
    if(previousAttempt){
      const release=saved.financialRelease,releaseKey={orderId,sk:'ASSIGNMENT_RELEASE#'+previousAttempt};
      priorRelease=(await options.db.send(new GetCommand({TableName:'staging-Holds',Key:releaseKey,ConsistentRead:true}))).Item??null;
      if(!priorRelease||priorRelease.kind!=='COD_ASSIGNMENT_RELEASE'||priorRelease.outcome!=='UNASSIGNED'||priorRelease.orderId!==orderId||priorRelease.attempt!==previousAttempt||priorRelease.branchId!==branchId||priorRelease.snapshotDigest!==quoteHash(saved.financialSnapshot)||release?.attempt!==previousAttempt||release.offerId!==priorRelease.offerId||release.operationId!==priorRelease.operationId||saved.holdAmount!==0||saved.holdStatus!=='NONE')return fail('DRIVER_OFFER_ORDER_UNAVAILABLE');
      releaseCondition=exactCheck('staging-Holds',releaseKey,priorRelease);
    }else if(saved.financialRelease!=null)return fail('DRIVER_OFFER_ORDER_UNAVAILABLE');
    // All present operational branch aliases must agree. merchantId is a separate ownership scope.
    if (![saved.storeId, saved.businessId].some(v => v === branchId) ||
        [saved.storeId, saved.businessId].some(v => v !== undefined && v !== branchId)) return fail('DRIVER_OFFER_ORDER_UNAVAILABLE');
    let envelope: Row;
    try {
      if(saved.financialSnapshot?.schemaVersion===3){
       if(options.enableFullCash!==true)return fail('DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED');
       envelope=exact(saved.financialSnapshot,['schemaVersion','kind','settlementModel','order','deliveryFunding','digest']);
       if(quoteCanonical(envelope)!==quoteCanonical(prepareFullCashOrderSnapshot({order:envelope.order,deliveryFunding:envelope.deliveryFunding})))return fail('DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED');
      }else if(saved.financialSnapshot?.schemaVersion===2){
       if(options.enableDeliveryFunding!==true)return fail('DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED');
       envelope=exact(saved.financialSnapshot,['schemaVersion','kind','order','deliveryFunding','digest']);
       if(quoteCanonical(envelope)!==quoteCanonical(prepareDeliveryFundedFinancialSnapshot({order:envelope.order,deliveryFunding:envelope.deliveryFunding})))return fail('DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED');
      }else{
       envelope = exact(saved.financialSnapshot, ['schemaVersion', 'kind', 'snapshot', 'digest']);
       if (envelope.schemaVersion !== 1 || envelope.kind !== 'ORDER_FINANCIAL_SNAPSHOT' || quoteCanonical(envelope) !== quoteCanonical(prepareDriverOfferFinancialSnapshot(envelope.snapshot))) return fail('DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED');
      }
    } catch { return fail('DRIVER_OFFER_FINANCIAL_SNAPSHOT_REQUIRED'); }
    const snapshot = envelope.schemaVersion>=2?envelope.order:envelope.snapshot;
    if (snapshot.orderId !== orderId || snapshot.branchId !== branchId || saved.merchantId !== snapshot.merchantId) return fail('DRIVER_OFFER_ORDER_UNAVAILABLE');
    // A syntactically correct reference is insufficient proof of captured and allocated payment funds.
    if (snapshot.allocation.paymentMethod !== 'COD') return fail('DRIVER_OFFER_PAYMENT_READER_REQUIRED');
    const values: Row = {}, conditions: string[] = [];
    for (const [i, field] of fields.entries()) {
      if (saved[field] === undefined) conditions.push(`attribute_not_exists(#f${i})`);
      else { conditions.push(`#f${i} = :v${i}`); values[':v' + i] = copy(saved[field]); }
    }
    return copy({commercialPricing:saved.commercialPricing??null, estimatedReadyAt:saved.estimatedReadyAt ?? null, display:driverOfferDisplay(saved), priorRelease, releaseCondition, nextAssignmentAttempt:previousAttempt+1, snapshot, snapshotHash: envelope.schemaVersion>=2?envelope.digest:quoteHash(snapshot), ...(envelope.schemaVersion>=2?{deliveryFunding:envelope.deliveryFunding}:{}),...(envelope.schemaVersion===3?{settlementModel:envelope.settlementModel}:{}), condition: { ConditionCheck: {
      TableName: TABLE, Key: key, ConditionExpression: conditions.join(' AND '),
      ExpressionAttributeNames: names, ExpressionAttributeValues: values
    } }, requiresAtomicComposition: true, requiresLiveDriverAndDeletionGuards: true, performsWrites: false });
  } });
}

/** Reconstruct the exact versioned envelope from an already verified reader result.
 * Never reprice or erase the delivery funding pin when binding a dispatch cycle.
 */
export function financialSnapshotFromOrderRead(read:Row) {
 if(read.settlementModel==='FULL_CASH_AT_DELIVERY_V1')return prepareFullCashOrderSnapshot({order:read.snapshot,deliveryFunding:read.deliveryFunding??null});
 return read.deliveryFunding?prepareDeliveryFundedFinancialSnapshot({order:read.snapshot,deliveryFunding:read.deliveryFunding}):prepareDriverOfferFinancialSnapshot(read.snapshot);
}
