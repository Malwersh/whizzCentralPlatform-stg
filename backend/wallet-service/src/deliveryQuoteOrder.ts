import {verifyGoodsPromotionExposure} from './goodsPromotionExposure';
import {prepareFullCashOrderSnapshot} from './fullCashOffer';
import {hasStoreAgreementOrderEvidence} from './storeDeliveryAgreement';
import { GetCommand, TransactWriteCommand, DynamoDBDocumentClient, TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { prepareDeliveryFundedFinancialSnapshot } from './deliveryFundedOffer';
import { readMoney } from './money';
import { QUOTE_TABLE, CUSTOMER_PROFILE_TABLE, quoteCanonical, quoteHash, quoteIdValid,
  quoteEntityIdValid, validDeliveryQuoteRecord } from './deliveryQuoteRecord';

type Row = Record<string, any>;
type DB = Pick<DynamoDBDocumentClient, 'send'>;
type Check = NonNullable<NonNullable<TransactWriteCommandInput['TransactItems']>[number]['ConditionCheck']>;
type Customer = { userId: string; subjectId: string; condition: { ConditionCheck: Check } };
export class QuoteOrderError extends Error {
  readonly statusCode: number;
  constructor(public readonly code: 'INVALID_QUOTE_ORDER' | 'QUOTE_UNAVAILABLE' | 'QUOTE_EXPIRED' | 'QUOTE_CONSUMED' |
    'QUOTE_INVALIDATED' | 'QUOTE_REQUEST_CONFLICT' | 'CUSTOMER_UNAVAILABLE' | 'QUOTE_ORDER_UNAVAILABLE') {
    super(code); this.name = 'QuoteOrderError';
    this.statusCode = code === 'INVALID_QUOTE_ORDER' ? 400 : code === 'CUSTOMER_UNAVAILABLE' ? 401 : code === 'QUOTE_ORDER_UNAVAILABLE' ? 503 : 409;
  }
}
const fail = (code: QuoteOrderError['code']): never => { throw new QuoteOrderError(code); };
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
export function orderIdFor(userId: string, requestId: string): string {
  const h = quoteHash(['DELIVERY_QUOTE_ORDER_V1', userId, requestId]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
// Coalesce additional checks for a reference already fenced by the delivery quote.
// DynamoDB forbids two operations on one item, even two ConditionChecks.
function normalizedCheckTerms(check:any):Set<string>|null {
  try {
    const split=(value:string):string[]=>{
      let text=value.trim();
      while(text.startsWith('(')&&text.endsWith(')')){
        let depth=0,outer=true;for(let i=0;i<text.length-1;i++){if(text[i]==='(')depth++;if(text[i]===')')depth--;if(depth===0){outer=false;break;}}
        if(!outer)break;text=text.slice(1,-1).trim();
      }
      let depth=0,start=0;const parts:string[]=[];
      for(let i=0;i<text.length;i++){if(text[i]==='(')depth++;else if(text[i]===')')depth--;else if(depth===0&&text.slice(i,i+5)===' AND '){parts.push(...split(text.slice(start,i)));start=i+5;i+=4;}}
      if(parts.length){parts.push(...split(text.slice(start)));return parts;}return [text];
    };
    return new Set(split(check.ConditionExpression).map(term=>term.replace(/\s+/g,'').replace(/#[A-Za-z0-9_]+|:[A-Za-z0-9_]+/g,token=>quoteCanonical(token[0]==='#'?['ATTRIBUTE',check.ExpressionAttributeNames[token]]:['VALUE',check.ExpressionAttributeValues[token]]))));
  }catch{return null;}
}
export function composeQuoteOrderOperations(items: NonNullable<TransactWriteCommandInput['TransactItems']>) {
  const result: typeof items = [], seen = new Map<string, number>();
  for (const [index, item] of items.entries()) {
    const op: any = item.ConditionCheck ?? item.Update ?? item.Put ?? item.Delete;
    const key = op.Key ?? (op.TableName === 'WizzOrders' ? {PK: op.Item.PK, SK: op.Item.SK} :
      op.TableName === 'staging-WalletLifecycle' ? {operationId: op.Item.operationId} :
      op.TableName === 'staging-Holds' ? {orderId: op.Item.orderId, sk: op.Item.sk} :
      op.TableName === 'staging-LedgerEntries' ? {walletId: op.Item.walletId, sk: op.Item.sk} :
      op.TableName === 'staging-AuditLog' ? {datePartition: op.Item.datePartition, sk: op.Item.sk} :
      ['staging-PlatformStaff','staging-MerchantPlatform'].includes(op.TableName) ? {pk:op.Item.pk,sk:op.Item.sk} :
      op.TableName === 'staging-WizzOfferJourney' ? {pk: op.Item.pk, sk: op.Item.sk} : null);
    if (!key) return fail('INVALID_QUOTE_ORDER');
    const identity = quoteCanonical([op.TableName, key]), previous = seen.get(identity);
    if (previous === undefined) { seen.set(identity, result.length); result.push(copy(item)); continue; }
    const prior = result[previous].ConditionCheck, check = item.ConditionCheck;
    if (!prior || !check) return fail('INVALID_QUOTE_ORDER');
    if (quoteCanonical(prior) === quoteCanonical(check)) continue;
    // Different aliases must not duplicate the same live branch/policy predicates.
    // Only top-level AND clauses are flattened; an OR remains one intact predicate.
    const existing=normalizedCheckTerms(prior),incoming=normalizedCheckTerms(check);
    if(existing&&incoming){
      if([...incoming].every(term=>existing.has(term)))continue;
      if([...existing].every(term=>incoming.has(term))){result[previous]=copy(item);continue;}
    }

    const names: Row = {}, values: Row = {}, aliases: Row = {};
    for (const [n, v] of Object.entries(check.ExpressionAttributeNames ?? {})) { const next = '#merge' + index + n.slice(1); aliases[n] = next; names[next] = v; }
    for (const [n, v] of Object.entries(check.ExpressionAttributeValues ?? {})) { const next = ':merge' + index + n.slice(1); aliases[n] = next; values[next] = v; }
    const expression = check.ConditionExpression!.replace(/#[A-Za-z0-9_]+|:[A-Za-z0-9_]+/g, token => aliases[token] ?? token);
    prior.ConditionExpression = '(' + prior.ConditionExpression + ') AND (' + expression + ')';
    const mergedNames = {...prior.ExpressionAttributeNames, ...names};
    const mergedValues = {...prior.ExpressionAttributeValues, ...values};
    if (Object.keys(mergedNames).length) prior.ExpressionAttributeNames = mergedNames;
    else delete prior.ExpressionAttributeNames;
    if (Object.keys(mergedValues).length) prior.ExpressionAttributeValues = mergedValues;
    else delete prior.ExpressionAttributeValues;
    if (Buffer.byteLength(prior.ConditionExpression) > 3900) return fail('INVALID_QUOTE_ORDER');
  }
  if (result.length > 100) return fail('INVALID_QUOTE_ORDER');
  return result;
}
/** Internal create-order adapter, deployed only with its own live account guard and quoted checkout contract.
 * It writes the existing WizzOrders item and consumes the quote in ONE transaction. No ledger or notifications.
 */
export function createStagingQuoteOrder(options: { db: DB; authenticateCustomer: () => Promise<Customer>; now?: () => number;enableDeliveryFunding?:boolean;enableFullCash?:boolean }) {
  const { db } = options, now = options.now ?? Date.now;
  async function customer(): Promise<Customer> {
    try {
      const c = await options.authenticateCustomer(), f = c?.condition?.ConditionCheck;
      if (!c || !quoteEntityIdValid(c.userId) || c.userId === 'guest' || !quoteEntityIdValid(c.subjectId) ||
          f?.TableName !== CUSTOMER_PROFILE_TABLE || quoteCanonical(f.Key) !== quoteCanonical({ userId: c.userId }) || !f.ConditionExpression) return fail('CUSTOMER_UNAVAILABLE');
      return copy(c);
    } catch { return fail('CUSTOMER_UNAVAILABLE'); }
  }
  async function get(table: string, key: Row) {
    try { return (await db.send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }))).Item; }
    catch { return fail('QUOTE_ORDER_UNAVAILABLE'); }
  }
  return Object.freeze({ async prepare(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_QUOTE_ORDER');
    const r = copy(input) as Row;
    if (Object.keys(r).sort().join(',') !== 'addressId,branchId,quoteId,requestContent,requestId' || !quoteIdValid(r.quoteId) ||
        !quoteIdValid(r.requestId) || !quoteEntityIdValid(r.branchId) || !quoteEntityIdValid(r.addressId) ||
        !r.requestContent || typeof r.requestContent !== 'object' || Array.isArray(r.requestContent) ||
        Buffer.byteLength(JSON.stringify(r.requestContent)) > 200000) return fail('INVALID_QUOTE_ORDER');
    const requestId = r.requestId.toLowerCase(), quoteId = r.quoteId.toLowerCase();
    const c = await customer(), quoteKey = { pk: 'CUSTOMER#' + c.userId, sk: 'QUOTE#' + quoteId };
    const row = await get(QUOTE_TABLE, quoteKey);
    if (!row || row.pk !== quoteKey.pk || row.sk !== quoteKey.sk || row.subjectId !== c.subjectId ||
        !validDeliveryQuoteRecord(row)) return fail('QUOTE_UNAVAILABLE');
    if (row.branchId !== r.branchId || row.addressId !== r.addressId) return fail('QUOTE_REQUEST_CONFLICT');
    const requestHash = quoteHash({ quoteId, branchId: r.branchId, addressId: r.addressId, content: r.requestContent });
    const orderId = orderIdFor(c.userId, requestId), orderKey = { PK: 'ORDER#' + orderId, SK: 'META' };
    const fee = readMoney(row.calculation.customerDeliveryFee);
    const address = r.requestContent.deliveryAddress;
    // Both alias forms, when present, must identify the saved destination. No silent precedence/fallback.
    if (r.requestContent.userId !== c.userId || r.requestContent.storeId !== row.branchId ||
        (r.requestContent.deliveryType !== undefined && r.requestContent.deliveryType !== 'delivery') ||
        (r.requestContent.deliveryProvider !== undefined && r.requestContent.deliveryProvider !== 'platform') ||
        !address || address.id !== row.addressId || !row.binding?.origin || !row.binding?.destination) return fail('INVALID_QUOTE_ORDER');
    for (const [aliases, expected] of [[['latitude', 'lat'], row.binding.destination.latitude], [['longitude', 'lng'], row.binding.destination.longitude]] as [string[], number][]) {
      if (typeof expected !== 'number' || !Number.isFinite(expected) || !aliases.some(a => address[a] !== undefined) ||
          aliases.some(a => address[a] !== undefined && address[a] !== expected)) return fail('INVALID_QUOTE_ORDER');
    }
    async function freshCustomer() {
      const fresh = await customer();
      if (fresh.userId !== c.userId || fresh.subjectId !== c.subjectId) return fail('CUSTOMER_UNAVAILABLE');
      return fresh;
    }
    function assertOpen() {
      const time = now();
      if (!Number.isFinite(time) || time < Date.parse(row!.createdAt) || time >= Date.parse(row!.expiresAt)) return fail('QUOTE_EXPIRED');
      return new Date(time).toISOString();
    }
    async function replay(current: Row): Promise<Row | null> {
      if (current.consumption === undefined) return null;
      const used = current.consumption;
      if (used.requestId !== requestId || used.orderId !== orderId) return fail('QUOTE_CONSUMED');
      if (used.requestHash !== requestHash) return fail('QUOTE_REQUEST_CONFLICT');
      const saved = await get('WizzOrders', orderKey);
      if (!saved || saved.orderId !== orderId || saved.userId !== c.userId || saved.userSub !== c.subjectId ||
          saved.deliveryQuote?.quoteId !== quoteId || saved.deliveryQuote?.requestHash !== requestHash) return fail('QUOTE_ORDER_UNAVAILABLE');
      const fresh = await freshCustomer();
      try {
        await db.send(new TransactWriteCommand({ TransactItems: [fresh.condition,
          { ConditionCheck: { TableName: QUOTE_TABLE, Key: quoteKey, ConditionExpression: '#digest=:digest AND consumption=:used',
            ExpressionAttributeNames: { '#digest': 'digest' }, ExpressionAttributeValues: { ':digest': row!.digest, ':used': used } } },
          { ConditionCheck: { TableName: 'WizzOrders', Key: orderKey,
            ConditionExpression: 'userId=:user AND userSub=:sub AND deliveryQuote=:quote',
            ExpressionAttributeValues: { ':user': c.userId, ':sub': c.subjectId, ':quote': saved.deliveryQuote } } }
        ] }));
      } catch { return fail('QUOTE_ORDER_UNAVAILABLE'); }
      // Return the persisted order, even after quote expiry or branch/policy changes; never run its side effects again.
      return copy(saved);
    }
    const replayedOrder = await replay(row);
    if (!replayedOrder) {
      if (await get('WizzOrders', orderKey)) return fail('QUOTE_REQUEST_CONFLICT');
      assertOpen();
    }
    return Object.freeze({ orderId, deliveryFeeMinor: fee.minorAmount, replayedOrder,
      origin: copy(row.binding.origin), destination: copy(row.binding.destination),
      distanceMeters: row.calculation.deliveryRoute.distanceMeters,
      createdAt: row.createdAt, expiresAt: row.expiresAt,
      destinationRegionId: row.binding.destinationCoverage.regionId,
      deliveryPromotionPricingRequest() {
        if(options.enableDeliveryFunding!==true||!row!.pricingContext||!row!.pricingAt)return fail('QUOTE_INVALIDATED');
        const policyFence=row!.fences.find((f:Row)=>f.TableName==='staging-PlatformStaff'&&f.Key?.pk==='OPERATIONAL_SETTINGS#DELIVERY_PRICING');
        const bundle=Object.values(policyFence?.ExpressionAttributeValues??{}).find((v:any)=>v?.deliveryRules) as Row|undefined;
        if(!bundle)return fail('QUOTE_INVALIDATED');
        return copy({schemaVersion:1,at:row!.pricingAt,context:row!.pricingContext,rules:bundle.deliveryRules,deliveryRoute:row!.calculation.deliveryRoute,discount:null});
      },
      async commit(inputOrder: Row, financialOperations: NonNullable<TransactWriteCommandInput['TransactItems']> = [], deliveryFunding?:Row): Promise<{ order: Row; replayed: boolean }> {
        if (replayedOrder) return { order: copy(replayedOrder), replayed: true };
        const order = copy(inputOrder), operations = copy(financialOperations);
        let finalFee=fee;
        if(deliveryFunding){
          if(options.enableDeliveryFunding!==true||![2,...(options.enableFullCash?[3]:[])].includes(order.financialSnapshot?.schemaVersion))return fail('INVALID_QUOTE_ORDER');
          const rebuilt=order.financialSnapshot.schemaVersion===3?prepareFullCashOrderSnapshot({order:order.financialSnapshot.order,deliveryFunding}):prepareDeliveryFundedFinancialSnapshot({order:order.financialSnapshot.order,deliveryFunding});
          if(quoteCanonical(rebuilt)!==quoteCanonical(order.financialSnapshot)||rebuilt.order.orderId!==orderId||rebuilt.order.branchId!==row!.branchId||rebuilt.order.merchantId!==order.merchantId||rebuilt.order.confirmedCustomerTotal.minorAmount!==order.pricing?.total||readMoney(deliveryFunding.allocation.referenceFee).minorAmount!==fee.minorAmount)return fail('INVALID_QUOTE_ORDER');
          const a=rebuilt.order.allocation;
          if(quoteCanonical(rebuilt.order.branchPoint)!==quoteCanonical(row!.binding.origin)||quoteCanonical(rebuilt.order.customerPoint)!==quoteCanonical(row!.binding.destination)||
             order.pricing.goodsSubtotal!==a.goodsGross.minorAmount||order.pricing.serviceFee!==a.serviceFee.minorAmount||order.pricing.tip!==a.driverTip.minorAmount||
             order.pricing.discount!==a.merchantGoodsDiscount.minorAmount+a.platformGoodsDiscount.minorAmount||order.pricing.packagingFee!==0||order.pricing.tax!==0||order.pricing.rounding!==0)return fail('INVALID_QUOTE_ORDER');
          finalFee=readMoney(deliveryFunding.allocation.customerFee);
          const writes=operations.filter(o=>o.Put).map(o=>o.Put!);
          const reservation=writes.find(o=>o.TableName==='staging-PlatformStaff'&&o.Item?.pk==='DELIVERY_RESERVATION#'+orderId&&o.Item?.sk==='META')?.Item;
          const policyPin=deliveryFunding.policyPin;
          if(deliveryFunding.allocation.schemaVersion===2?!hasStoreAgreementOrderEvidence(operations,deliveryFunding,orderId,c.userId):(!reservation||reservation.status!=='RESERVED'||reservation.customerId!==c.userId||quoteCanonical({policyPin:reservation.policyPin,allocation:reservation.allocation})!==quoteCanonical(deliveryFunding)||
            !writes.some(o=>o.TableName==='staging-PlatformStaff'&&o.Item?.pk==='DELIVERY_BUDGET#'+policyPin.policyId&&o.Item?.sk==='VERSION#'+policyPin.version)||
            !writes.some(o=>o.TableName==='staging-PlatformStaff'&&o.Item?.pk==='DELIVERY_USAGE#'+policyPin.policyId&&o.Item?.sk==='CUSTOMER#'+c.userId)))return fail('INVALID_QUOTE_ORDER');
          const platformMinor=readMoney(deliveryFunding.allocation.platformShare).minorAmount;
          if(order.financialSnapshot.schemaVersion!==3&&platformMinor&&(!writes.some(o=>o.TableName==='staging-Holds'&&o.Item?.orderId===orderId&&o.Item?.sk==='DELIVERY_PROMOTION_FUNDING'&&o.Item?.amount===platformMinor/1000&&quoteCanonical(o.Item?.metadata?.policyPin)===quoteCanonical(policyPin))||!operations.some(o=>o.Update?.TableName==='staging-Wallets'&&o.Update.Key?.walletId==='WALLET#PLATFORM')))return fail('INVALID_QUOTE_ORDER');
        }else if(order.financialSnapshot?.schemaVersion===2)return fail('INVALID_QUOTE_ORDER');
        if(order.financialSnapshot?.schemaVersion===3){
          if(options.enableFullCash!==true)return fail('INVALID_QUOTE_ORDER');
          const snapshot=prepareFullCashOrderSnapshot({order:order.financialSnapshot.order,deliveryFunding:deliveryFunding??null});
          const commitment=operations.find(x=>x.Put?.TableName==='staging-Holds'&&x.Put.Item?.orderId===orderId&&x.Put.Item?.sk==='FULL_CASH_FUNDING_COMMITMENT')?.Put?.Item;
          if(snapshot.order.orderId!==orderId||snapshot.order.branchId!==row!.branchId||snapshot.order.merchantId!==order.merchantId||snapshot.order.confirmedCustomerTotal.minorAmount!==order.pricing?.total||snapshot.order.allocation.paymentMethod!=='COD'||quoteCanonical(snapshot)!==quoteCanonical(order.financialSnapshot)||!commitment||commitment.kind!=='FULL_CASH_FUNDING_COMMITMENT'||commitment.settlementModel!=='FULL_CASH_AT_DELIVERY_V1'||commitment.branchId!==row!.branchId||commitment.merchantId!==order.merchantId||commitment.status!=='COMMITTED'||commitment.snapshotDigest!==snapshot.digest||quoteCanonical(commitment.deliveryFunding)!==quoteCanonical(deliveryFunding??null)||quoteCanonical(commitment.platformGoodsFunding)!==quoteCanonical(snapshot.order.allocation.platformGoodsDiscount)||operations.some(x=>x.Update?.TableName==='staging-Wallets'||x.Put?.TableName==='staging-Holds'&&['PROMOTION_FUNDING','DELIVERY_PROMOTION_FUNDING'].includes(x.Put.Item?.sk)))return fail('INVALID_QUOTE_ORDER');
          if(snapshot.order.allocation.platformGoodsDiscount.minorAmount>0){verifyGoodsPromotionExposure(commitment.goodsExposure,snapshot.order.allocation.platformGoodsDiscount);if(quoteCanonical(commitment.goodsExposure)!==quoteCanonical(order.commercialPricing?.funding?.exposure))return fail('INVALID_QUOTE_ORDER');}
        }
        if (order.PK !== orderKey.PK || order.SK !== 'META' || order.orderId !== orderId || order.userId !== c.userId ||
            order.userSub !== c.subjectId || order.storeId !== row!.branchId || order.isGuestOrder !== false ||
            order.deliveryType !== 'delivery' || order.currency !== 'IQD' || order.pricing?.deliveryFee !== finalFee.minorAmount ||
            !Object.values(order.pricing).every(v => typeof v === 'number' && Number.isSafeInteger(v)) ||
            order.deliveryAddress?.lat !== row!.binding.destination.latitude || order.deliveryAddress?.lng !== row!.binding.destination.longitude ||
            order.restaurantLat !== row!.binding.origin.latitude || order.restaurantLng !== row!.binding.origin.longitude) return fail('INVALID_QUOTE_ORDER');
        order.deliveryQuote = { schemaVersion: deliveryFunding?2:1, kind: deliveryFunding?'DELIVERY_PROMOTION_BOUND':'DELIVERY_FEE_ONLY',...(deliveryFunding?{referenceDeliveryFee:fee,deliveryFundingPin:deliveryFunding.policyPin}:{}), quoteId, requestId, requestHash,
          policyVersion: row!.policyVersion, rule: row!.calculation.rule, deliveryFee: finalFee, route: row!.calculation.deliveryRoute };
        const fresh = await freshCustomer(), at = assertOpen();
        const consumption = { orderId, requestId, requestHash, consumedAt: at };
        const items = composeQuoteOrderOperations([fresh.condition,
          ...row!.fences.map((ConditionCheck: Check) => ({ ConditionCheck })),
          { Update: { TableName: QUOTE_TABLE, Key: quoteKey, UpdateExpression: 'SET consumption=:used',
            ConditionExpression: '#digest=:digest AND attribute_not_exists(consumption) AND expiresAt>:now AND createdAt<=:now',
            ExpressionAttributeNames: { '#digest': 'digest' }, ExpressionAttributeValues: { ':digest': row!.digest, ':used': consumption, ':now': at } } },
          { Put: { TableName: 'WizzOrders', Item: order, ConditionExpression: 'attribute_not_exists(PK)' } },
          ...operations
        ]);
        // No duplicate-item checks: branch eligibility/deletion checks are already in the quote reference fences.
        if (items.length > 100 || Buffer.byteLength(JSON.stringify(items)) > 3500000 || Buffer.byteLength(JSON.stringify(order)) > 300000) return fail('INVALID_QUOTE_ORDER');
        try { await db.send(new TransactWriteCommand({ TransactItems: items })); }
        catch (e: any) {
          console.error('QUOTE_ORDER_COMMIT_REJECTED', {name:e?.name, code:e?.code, validation:e?.name==='ValidationException'?e.message:undefined, reasons:e?.CancellationReasons?.map((r:any)=>r.Code)});
          // A cohort refusal happens before the guarded client sends a write.
          // Preserve the actionable closed-scope result instead of reporting
          // storage failure or attempting a legacy creation path.
          if (['FINANCE_ROLLOUT_OUT_OF_SCOPE', 'FINANCE_ROLLOUT_ADMISSION_CLOSED',
              'FINANCE_ROLLOUT_NOT_CONFIGURED'].includes(e?.code)) throw e;
          const latest = await get(QUOTE_TABLE, quoteKey);
          if (latest && validDeliveryQuoteRecord(latest) && latest.digest === row!.digest) {
            const recovered = await replay(latest);
            if (recovered) return { order: recovered, replayed: true };
          }
          if (e.name === 'TransactionCanceledException' || e.name === 'ConditionalCheckFailedException') return fail('QUOTE_INVALIDATED');
          return fail('QUOTE_ORDER_UNAVAILABLE');
        }
        return { order, replayed: false };
      }
    });
  } });
}
