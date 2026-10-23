import {settlePlatformBenefit} from './platformBenefits';
import {cashReportsDigest,cashAdjudicationAdjustment} from './cashAdjudication';
import {prepareMerchantAccrualIndex} from './merchantAccrualIndex';
import {verifyGoodsPromotionExposure} from './goodsPromotionExposure';
import {codIntegrationEvent} from './codIntegrationEvent';
import {createStagingDeliveryCampaignBudget} from './deliveryCampaignBudget';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { codCollectedPaymentFields } from './codCompletion';
import { verifyFullCashAssignment } from './fullCashOffer';
import { prepareFullCashJournal, FULL_CASH_SETTLEMENT_MODEL } from './fullCashSettlement';
import { detach, equal, exactCheck, strongGet, updateChecked } from './driverFinancialTransaction';
import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';
import { toWholeIqdExact } from './money';

type Row = Record<string, any>;
const T = { orders: 'WizzOrders', offers: 'WaveOffers_staging', holds: 'staging-Holds', wallets: 'staging-Wallets',
  ledger: 'staging-LedgerEntries', audit: 'staging-AuditLog', journal: 'staging-MerchantPlatform',
  driver: 'WhizzDrivers_staging', branch: 'WhizzMerchants_Businesses', jobs: 'WizzDispatchJobs_staging',
  live: 'WizzDriverLiveState_staging', deletion: 'staging-AccountDeletion' };
const fail = (code = 'FULL_CASH_COMPLETION_CONFLICT'): never => { throw Object.assign(Error(code), { code }); };
function safe(n: number) { if (!Number.isSafeInteger(n)) return fail('FULL_CASH_PRECISION_UNSUPPORTED'); return n; }
function set(table: string, key: Row, row: Row, fields: Row, absent: string[] = []) {
  const names: Row = {}, values: Row = {};
  const assignments = Object.entries(fields).map(([field, value], i) => {
    names['#u' + i] = field; values[':u' + i] = value; return '#u' + i + '=:u' + i;
  });
  return updateChecked(exactCheck(table, key, row, [...new Set([...Object.keys(row), ...absent])]), 'SET ' + assignments.join(', '), names, values);
}
const put = (table: string, item: Row, primary: string) => ({ Put: { TableName: table, Item: item,
  ConditionExpression: 'attribute_not_exists(#primary)', ExpressionAttributeNames: { '#primary': primary } } });
function wallet(row: Row | null, id: string, owner: string, type: string): Row {
  if (!row || row.walletId !== id || row.sk !== 'META' || row.ownerId !== owner || row.ownerType !== type ||
      row.currency !== 'IQD' || row.status !== 'ACTIVE' || row.deletedAt != null || row.deletionRequestId != null || row.isDeleted === true ||
      ![row.availableBalance, row.lockedBalance, row.version].every(Number.isSafeInteger) || row.version < 1 ||
      row.version >= Number.MAX_SAFE_INTEGER || row.availableBalance < 0 || row.lockedBalance < 0) return fail('FULL_CASH_WALLET_UNAVAILABLE');
  safe(row.availableBalance + row.lockedBalance); return row;
}
/** Versioned COD writer; runtime routing requires an explicit settlement capability.
 * Requires a V3 accepted offer and new-model collateral. No legacy promotion
 * holds or platform wallet is consumed. Balanced GL proves the funding expense
 * and merchant/driver liabilities even when platform contribution is negative.
 * Payout remains a separate operation requiring actual liquidity and evidence.
 */
export function createFullCashCompletion(options: {
  db: Pick<DynamoDBDocumentClient, 'send'>; enabled: boolean;
  authenticateDriver: () => Promise<{ driverId: string; subjectId: string }>; now?: () => number;
  authenticateStaff?: () => Promise<{kind:string;subjectId:string}>;
}) {
  const db = options.db, now = options.now || Date.now;
  async function run(value: unknown, administrative?: {decisionId:string}) {
    if (options.enabled !== true) return fail('FULL_CASH_COMPLETION_DISABLED');
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== 'cashCollected,orderId' || (value as Row).cashCollected !== true ||
        !quoteEntityIdValid((value as Row).orderId)) return fail('INVALID_FULL_CASH_COMPLETION');
    const orderId: string = (value as Row).orderId;
    if(administrative && !options.authenticateStaff)return fail('UNAUTHORIZED');
    const staff = administrative ? detach(await options.authenticateStaff!()) : null;
    if(administrative && (!staff || staff.kind!=='STAFF' || !quoteEntityIdValid(staff.subjectId)))return fail('UNAUTHORIZED');
    const adminOrder = administrative ? await strongGet(db,T.orders,{PK:'ORDER#'+orderId,SK:'META'}) : null;
    const adminDriver = administrative && adminOrder ? await strongGet(db,T.driver,{driverId:adminOrder.driverId}) : null;
    const actor = administrative ? {driverId:adminOrder?.driverId,subjectId:adminDriver?.cognitoSub??adminDriver?.driverId} : detach(await options.authenticateDriver());
    const cashCase=administrative?await strongGet(db,T.holds,{orderId,sk:'CUSTOMER_CASH_REVIEW'}):null;
    const decision=cashCase?.adjudication;
    if(administrative && (!cashCase || cashCase.state==='CLOSED' || decision?.status!=='APPROVED' || decision.decisionId!==administrative.decisionId ||
      decision.caseId!==cashCase.caseId || adminOrder?.openPaymentClaimId!==cashCase.caseId ||
      (cashCase.refunds?.refunds??[]).some((r:Row)=>r.status!=='CANCELLED') || decision.reportsDigest!==cashReportsDigest(cashCase) || decision.acceptedTermsDigest!==quoteHash(adminOrder?.financialAcceptance)))return fail('CASH_ADJUDICATION_CHANGED');
    const adjustment=administrative?cashAdjudicationAdjustment(decision):null;
    if (!actor || ![actor.driverId, actor.subjectId].every(quoteEntityIdValid)) return fail('UNAUTHORIZED');
    const operationId = 'FCS:' + quoteHash({ orderId, settlementModel: FULL_CASH_SETTLEMENT_MODEL }).slice(0, 48);
    const outcomeKey = { orderId, sk: 'FINANCIAL_OUTCOME' };
    function prior(row: Row | null) {
      if (!row) return null;
      if (row.kind !== 'FULL_CASH_COMPLETION_JOURNAL' || row.schemaVersion !== 3 ||
          row.settlementModel !== FULL_CASH_SETTLEMENT_MODEL || row.operationId !== operationId || row.orderId !== orderId ||
          row.driverId !== actor.driverId || row.subjectId !== actor.subjectId || row.outcome !== 'COMPLETED' ||
          row.receipt?.orderId !== orderId || row.receipt?.operationId !== operationId) return fail();
      return detach({ ...row.receipt, replayed: true });
    }
    const replay = prior(await strongGet(db, T.holds, outcomeKey));
    if (replay) {if(administrative)return fail('CASH_ADJUDICATION_CHANGED');return replay;}
    const key = { PK: 'ORDER#' + orderId, SK: 'META' }, order = await strongGet(db, T.orders, key);
    if (!order || order.orderId !== orderId || order.driverId !== actor.driverId ||
        !['picked_up', 'heading_to_customer', 'arrived_at_customer'].includes(order.status) ||
        (order.orderStatus !== undefined && order.orderStatus !== order.status) ||
        !Number.isSafeInteger(order.assignmentAttemptCounter) || order.assignmentAttemptCounter < 1 ||
        order.assignmentAttemptCounter > 1000 || order.financialAcceptance?.paymentMethod !== 'COD' ||
        [...(administrative?[]:['openPaymentClaimId']), 'financialOutcome', 'returnStatus', 'returnCaseId', 'cancellationStatus', 'cancellationRequestId',
          'deletionStatus', 'deletionRequestId', 'deletedAt'].some(k => order[k] != null) || order.isDeleted === true) return fail();
    const offerKey = { orderId, SK: `FINANCIAL#${actor.driverId}#WAVE#${order.assignmentWaveNumber}` };
    const saved = await strongGet(db, T.offers, offerKey);
    if (!saved || saved.orderId !== orderId || saved.driverId !== actor.driverId || saved.SK !== offerKey.SK) return fail();
    const offer = verifyFullCashAssignment(order, saved, actor.subjectId), a = offer.settlement.allocation;
    const posting = prepareFullCashJournal(offer.settlement,order.commercialPricing?.cashRounding), branchId = offer.baseOffer.branchId;
    const agreement = order.commercialPricing?.agreement;
    if (!agreement || !quoteEntityIdValid(agreement.id) || !Number.isSafeInteger(agreement.version) || agreement.version < 1 ||
        !/^[a-f0-9]{64}$/.test(agreement.termsHash || '')) return fail('FULL_CASH_AGREEMENT_REQUIRED');
    // No third-party payout adapter is enabled by this internal writer.
    if (toWholeIqdExact(a.thirdPartyPayable) !== 0) return fail('FULL_CASH_THIRD_PARTY_ADAPTER_REQUIRED');
    posting.lines.forEach(line => toWholeIqdExact(line.amount));
    const H = toWholeIqdExact(a.driverWalletHold), A = safe(toWholeIqdExact(a.driverWalletCreditTotal)+(adjustment?.driverCreditIqd??0)),
      M = safe(toWholeIqdExact(a.merchantPayable)-(adjustment?.merchantReductionIqd??0)), C = toWholeIqdExact(a.customerTotal);
    if(M<0)return fail('CASH_ADJUSTMENT_EXCEEDS_PAYABLE');
    const actualCollected=administrative?decision.collectedIqd:C;
    const timestamp = new Date(now()).toISOString();
    if (Date.parse(order.financialAcceptance.acceptedAt) > Date.parse(timestamp) || order.holdAmount !== H ||
        order.holdStatus !== (H ? 'ACTIVE' : 'NOT_REQUIRED')) return fail();
    const driver = await strongGet(db, T.driver, { driverId: actor.driverId }), branch = await strongGet(db, T.branch, { businessId: branchId });
    if (!driver || (driver.cognitoSub ?? driver.driverId) !== actor.subjectId || (!administrative && !['APPROVED', 'VERIFIED'].includes(driver.status)) ||
        (!administrative && (driver.isSuspended === true || driver.isBanned === true)) || driver.isDeleted === true || driver.deletionRequestId != null || driver.deletedAt != null ||
        !branch || (!administrative && branch.status !== 'approved') || branch.businessId !== branchId || branch.organizationId !== offer.baseOffer.source.order.merchantId ||
        !quoteEntityIdValid(branch.ownerId) || branch.cognitoUserId !== branch.ownerId || branch.isDeleted === true ||
        branch.deletionRequestId != null || branch.deletedAt != null) return fail('FULL_CASH_PARTY_UNAVAILABLE');
    const jobKey = { orderId, SK: 'METADATA' }, job = await strongGet(db, T.jobs, jobKey),
      liveKey = { driverId: actor.driverId }, live = await strongGet(db, T.live, liveKey);
    if (!job || job.assignedDriverId !== actor.driverId || job.status !== 'assigned' || job.dispatchJobId !== offer.baseOffer.assignmentId ||
        !live || live.currentOrderId !== orderId || live.activeOrdersCount !== 1) return fail();
    const driverId = 'WALLET#DRIVER#' + actor.driverId, merchantId = 'WALLET#MERCHANT#' + branchId;
    const dw = wallet(await strongGet(db, T.wallets, { walletId: driverId, sk: 'META' }), driverId, actor.driverId, 'DRIVER');
    const merchantWalletRow=await strongGet(db,T.wallets,{walletId:merchantId,sk:'META'});
    const mw = wallet(merchantWalletRow??{walletId:merchantId,sk:'META',ownerId:branchId,ownerType:'MERCHANT',currency:'IQD',status:'ACTIVE',availableBalance:0,lockedBalance:0,version:1}, merchantId, branchId, 'MERCHANT');
    const holdKey = { orderId, sk: 'HOLD' }, hold = await strongGet(db, T.holds, holdKey);
    if (!hold || hold.financialSchemaVersion !== 4 || hold.settlementModel !== FULL_CASH_SETTLEMENT_MODEL ||
        hold.walletId !== driverId || hold.amount !== H || hold.status !== (H ? 'ACTIVE' : 'NOT_REQUIRED') ||
        hold.holdId !== order.holdId || hold.metadata?.offerDigest !== offer.digest ||
        hold.metadata?.assignmentAttempt !== order.assignmentAttemptCounter || dw.lockedBalance < H) return fail();
    const operations: Row[] = [exactCheck(T.offers, offerKey, saved), exactCheck(T.driver, { driverId: actor.driverId }, driver),
      exactCheck(T.branch, { businessId: branchId }, branch)];
    if(order.assignmentAttemptCounter===1){if(order.financialRelease!=null)return fail();}
    else{
      const previousAttempt=order.assignmentAttemptCounter-1,release=order.financialRelease,
        releaseKey={orderId,sk:'ASSIGNMENT_RELEASE#'+previousAttempt},archive=await strongGet(db,T.holds,releaseKey);
      if(!archive||archive.schemaVersion!==3||archive.settlementModel!==FULL_CASH_SETTLEMENT_MODEL||
        archive.kind!=='COD_ASSIGNMENT_RELEASE'||archive.outcome!=='UNASSIGNED'||archive.orderId!==orderId||
        archive.attempt!==previousAttempt||archive.branchId!==branchId||archive.snapshotDigest!==quoteHash(order.financialSnapshot)||
        release?.attempt!==previousAttempt||release.offerId!==archive.offerId||release.operationId!==archive.operationId)return fail();
      operations.push(exactCheck(T.holds,releaseKey,archive));
    }
    for (const pk of new Set(['ACCOUNT_LIFECYCLE#DRIVER#' + actor.driverId, 'ACCOUNT_LIFECYCLE#DRIVER#' + actor.subjectId,
        'BUSINESS_LIFECYCLE#MERCHANT#' + branchId, 'ACCOUNT_LIFECYCLE#MERCHANT#' + branch.ownerId])) {
      const deletionKey = { pk, sk: 'META' };
      if (await strongGet(db, T.deletion, deletionKey)) return fail('FULL_CASH_PARTY_UNAVAILABLE');
      operations.push({ ConditionCheck: { TableName: T.deletion, Key: deletionKey, ConditionExpression: 'attribute_not_exists(pk)' } });
    }
    // A new-model transaction must never strand a cash reservation from the old model.
    for (const sk of ['PROMOTION_FUNDING', 'DELIVERY_PROMOTION_FUNDING']) {
      const oldKey = { orderId, sk };
      if (await strongGet(db, T.holds, oldKey)) return fail('FULL_CASH_LEGACY_FUNDING_CONFLICT');
      operations.push({ ConditionCheck: { TableName: T.holds, Key: oldKey, ConditionExpression: 'attribute_not_exists(orderId)' } });
    }
    const budgetKey = { orderId, sk: 'FULL_CASH_FUNDING_COMMITMENT' }, budget = await strongGet(db, T.holds, budgetKey);
    if (!budget || budget.kind !== 'FULL_CASH_FUNDING_COMMITMENT' || budget.status !== 'COMMITTED' ||
        budget.settlementModel !== FULL_CASH_SETTLEMENT_MODEL || budget.snapshotDigest !== offer.financialSnapshot.digest ||
        !equal(budget.deliveryFunding, offer.financialSnapshot.deliveryFunding) ||
        !equal(budget.platformGoodsFunding, a.platformGoodsDiscountFunding)) return fail('FULL_CASH_BUDGET_COMMITMENT_REQUIRED');
    if(!equal(budget.cashRounding??null,order.commercialPricing?.cashRounding??null))return fail('CASH_ROUNDING_SETTLEMENT_MISMATCH');
    if(a.platformGoodsDiscountFunding.minorAmount>0){verifyGoodsPromotionExposure(budget.goodsExposure,a.platformGoodsDiscountFunding);if(!equal(budget.goodsExposure,order.commercialPricing?.funding?.exposure))return fail('FULL_CASH_BUDGET_COMMITMENT_REQUIRED');}
    operations.push(set(T.holds, budgetKey, budget, { status: 'CONSUMED', operationId, consumedAt: timestamp }),
      set(T.holds, holdKey, hold, { status: H ? 'SETTLED' : 'NOT_REQUIRED', settlementOperationId: operationId, settledAt: timestamp }));
    if(H){const lcKey={operationId:hold.holdId},lc=await strongGet(db,'staging-WalletLifecycle',lcKey);if(!lc||lc.kind!=='FULL_CASH_HOLD'||lc.financialSchemaVersion!==4||lc.orderId!==orderId||lc.status!=='FULL_CASH_PENDING_COMPLETION'||lc.amount!==H||lc.walletId!==driverId)return fail();operations.push(set('staging-WalletLifecycle',lcKey,lc,{status:'COMPLETED',action:'NONE',updatedAt:timestamp,lastError:null,settlementOperationId:operationId}));}
    if(order.platformBenefitReceipt?.target==='GOODS'){const benefit=await settlePlatformBenefit(db,{orderId,target:'GOODS',outcome:'CAPTURED'});if(benefit.replayed)return fail();operations.push(...benefit.operations);}
    if(offer.financialSnapshot.deliveryFunding){const campaign=await createStagingDeliveryCampaignBudget({db,now}).settle({orderId,outcome:'CAPTURED',expectedFunding:offer.financialSnapshot.deliveryFunding});if(campaign.replayed)return fail();operations.push(...campaign.operations);}
    operations.push(...await prepareMerchantAccrualIndex(db,{branchId,orderId,operationId,deliveredAt:timestamp,merchantNetIqd:M,financialSchemaVersion:4}));
    const walletLines: Row[] = [];
    for (const [w, available, locked] of [[dw, A, -H], [mw, 0, M]] as [Row, number, number][]) {
      const nextAvailable = safe(w.availableBalance + available), nextLocked = safe(w.lockedBalance + locked);
      safe(nextAvailable + nextLocked); if (nextAvailable < 0 || nextLocked < 0) return fail('FULL_CASH_WALLET_UNAVAILABLE');
      if(w===mw&&!merchantWalletRow)operations.push(put(T.wallets,{...mw,availableBalance:nextAvailable,lockedBalance:nextLocked,version:1,createdAt:timestamp,updatedAt:timestamp},'walletId'));
      else if (available || locked) operations.push(set(T.wallets, { walletId: w.walletId, sk: 'META' }, w,
        { availableBalance: nextAvailable, lockedBalance: nextLocked, version: w.version + 1, updatedAt: timestamp }, ['deletionRequestId', 'deletedAt', 'isDeleted']));
      else operations.push(exactCheck(T.wallets, { walletId: w.walletId, sk: 'META' }, w, [...Object.keys(w), 'deletionRequestId', 'deletedAt', 'isDeleted']));
      for (const [bucket, delta, before] of [['AVAILABLE', available, w.availableBalance], ['LOCKED', locked, w.lockedBalance]] as [string, number, number][]) {
        if (!delta) continue;
        const line = { walletId: w.walletId, balanceType: bucket, delta, unit: 'IQD_WHOLE', balanceBefore: before, balanceAfter: safe(before + delta) };
        walletLines.push(line);
        operations.push(put(T.ledger, { walletId: w.walletId, sk: `ts#${timestamp}#${bucket}#${operationId}`, transactionId: operationId,
          type: delta > 0 ? 'CREDIT' : 'DEBIT', category: administrative?'CASH_ADJUDICATION_SETTLED':'FULL_CASH_COMPLETED', amount: delta,
          balanceBefore: before, balanceAfter: line.balanceAfter, relatedEntityId: orderId, relatedEntityType: 'ORDER', createdAt: timestamp,
          metadata: { orderId, operationId, balanceType: bucket, ...(administrative?{decisionId:decision.decisionId,driverShortfallCreditIqd:adjustment!.driverCreditIqd}:{}), financialSchemaVersion: 4, settlementModel: FULL_CASH_SETTLEMENT_MODEL } }, 'sk'));
      }
    }
    // Wallet movements alone are not the GL: the signed platform position is
    // recorded in the same transaction, never disguised as a wallet transfer.
    if (walletLines.reduce((sum, line) => sum + BigInt(line.delta), 0n) + BigInt(toWholeIqdExact(a.platformNetContribution)) - BigInt(adjustment?.driverCreditIqd??0) + BigInt(adjustment?.merchantReductionIqd??0) !== 0n) return fail('FULL_CASH_WALLET_GL_MISMATCH');
    const receipt = { success: true, kind: 'FULL_CASH_COMPLETION', orderId, operationId, deliveredAt: timestamp,
      cashCollected: actualCollected===C, cashCollectedAmount: actualCollected, ...(administrative?{administrativeDecisionId:decision.decisionId,administrativeActorId:staff!.subjectId,driverNetPositionIqd:actualCollected+A-H,adjustment}:{}), retainedCash: toWholeIqdExact(a.driverCashRetained), driverWalletCredit: A,
      settledCollateral: H, payoutPerformed: false, replayed: false };
    operations.push(put(T.journal, { pk: 'FULL_CASH_JOURNAL#' + orderId, sk: 'META', kind: 'FULL_CASH_ACCOUNTING_JOURNAL',
      schemaVersion: 1, status: 'POSTED', orderId, operationId, driverId: actor.driverId, branchId, settlementModel: FULL_CASH_SETTLEMENT_MODEL,
      offerDigest: offer.digest, allocationDigest: offer.settlement.digest, postingDigest: posting.digest, ...(administrative?{cashAdjudication:{decisionId:decision.decisionId,actualCollectedIqd:actualCollected,adjustment}}:{}),
      ...(order.commercialPricing?.cashRounding?{cashRounding:order.commercialPricing.cashRounding}:{}),lines: posting.lines, debit: posting.debit, credit: posting.credit, funding: posting.funding, walletLines, createdAt: timestamp }, 'pk'),
      put(T.holds, { ...outcomeKey, kind: 'FULL_CASH_COMPLETION_JOURNAL', schemaVersion: 3, outcome: 'COMPLETED',
        settlementModel: FULL_CASH_SETTLEMENT_MODEL, orderId, operationId, driverId: actor.driverId, subjectId: actor.subjectId, branchId,
        offerDigest: offer.digest,offerId:offer.baseOffer.offerId,attempt:order.assignmentAttemptCounter, allocation: a, journalDigest: posting.digest, walletLines, receipt, createdAt: timestamp }, 'orderId'),
      put(T.holds, { orderId, sk: 'MERCHANT_PAYABLE', kind: 'MERCHANT_ORDER_PAYABLE', financialSchemaVersion: 4,
        settlementModel: FULL_CASH_SETTLEMENT_MODEL, walletId: merchantId, branchId, amount: M, operationId, agreement,
        status: 'LOCKED_PENDING_SETTLEMENT', deliveryFunding: offer.financialSnapshot.deliveryFunding,
        journalDigest: posting.digest, createdAt: timestamp }, 'orderId'),
      set(T.orders, key, order, { status: 'delivered', orderStatus: 'delivered', deliveredAt: timestamp, updatedAt: timestamp,
        cashCollected: actualCollected===C, cashCollectedAmount: actualCollected, ...codCollectedPaymentFields(order, timestamp),
        ...(administrative?{openPaymentClaimId:null,deliveryEvidenceSource:'ADMINISTRATIVE_FINDING',cashAdjudication:{caseId:cashCase!.caseId,decisionId:decision.decisionId,actualCollectedIqd:actualCollected,outcome:decision.outcome},
          ...(actualCollected!==C?{paymentStatus:'administratively_resolved',...(order.paymentStatus_gsi!==undefined?{paymentStatus_gsi:'administratively_resolved#'+order.paymentStatus_gsi.slice('pending#'.length)}:{})}:{} )}:{}), holdStatus: H ? 'SETTLED' : 'NOT_REQUIRED', walletFinancialStatus: 'SETTLED',
        financialOutcome: operationId }, ['openPaymentClaimId', 'financialOutcome', 'financialRelease', 'returnStatus', 'returnCaseId', 'cancellationStatus',
        'cancellationRequestId', 'deletionStatus', 'deletionRequestId', 'deletedAt', 'isDeleted']),
      set(T.jobs, jobKey, job, { status: 'completed', completedAt: timestamp }),
      set(T.live, liveKey, live, { status: live.isActive === true && driver.isSuspended!==true && driver.isBanned!==true ? 'available' : 'offline', ...(administrative&&(driver.isSuspended===true||driver.isBanned===true)?{isActive:false}:{}), currentOrderId: null, activeOrdersCount: 0, isSearching: false }),
      put(T.audit, { datePartition: 'date#' + timestamp.slice(0, 10).replace(/-/g, ''), sk: timestamp + '#' + operationId,
        action: administrative?'CASH_ADJUDICATION_ORDER_COMPLETED':'FULL_CASH_ORDER_COMPLETED', actorId: administrative?staff!.subjectId:actor.subjectId, orderId, branchId, operationId,
        settlementModel: FULL_CASH_SETTLEMENT_MODEL, cashEvidence: administrative?'ADMINISTRATIVE_FINDING':'DRIVER_DECLARATION', amount: actualCollected, currency: 'IQD', createdAt: timestamp }, 'sk'));
    operations.push(codIntegrationEvent({kind:'COD_COMPLETION_OUTBOX',financialOperationId:operationId,orderId,driverId:actor.driverId,subjectId:actor.subjectId,branchId,offerId:offer.baseOffer.offerId,attempt:order.assignmentAttemptCounter,waveNumber:order.assignmentWaveNumber,createdAt:timestamp}));
    if(administrative){
      const journal={orderId,sk:'CASH_ADJUDICATION_JOURNAL',financialSchemaVersion:4,kind:'CASH_ADJUDICATION_ACCOUNTING_JOURNAL',status:'POSTED',
        operationId,branchId,driverId:actor.driverId,caseId:cashCase!.caseId,decisionId:decision.decisionId,actorId:staff!.subjectId,
        lines:adjustment!.lines,adjustment,actualCollectedIqd:actualCollected,expectedIqd:C,originalAllocationDigest:offer.settlement.digest,createdAt:timestamp};
      operations.push(put(T.holds,{...journal,digest:quoteHash(journal)},'orderId'));
      if(adjustment!.receivableIqd)operations.push(put(T.holds,{orderId,sk:'CUSTOMER_CASH_RECEIVABLE',kind:'CUSTOMER_CASH_RECEIVABLE',financialSchemaVersion:4,status:'OPEN',amountIqd:adjustment!.receivableIqd,
        customerId:order.userSub,driverId:actor.driverId,branchId,caseId:cashCase!.caseId,decisionId:decision.decisionId,operationId,createdAt:timestamp},'orderId'));
      if(!equal(staff,await options.authenticateStaff!()))return fail('UNAUTHORIZED');
      return {operations,receipt};
    }
    if (operations.length > 100 || Buffer.byteLength(JSON.stringify(operations)) > 3500000) return fail('FULL_CASH_TRANSACTION_TOO_LARGE');
    if (!equal(actor, await options.authenticateDriver())) return fail('UNAUTHORIZED');
    try { await db.send(new TransactWriteCommand({ TransactItems: operations as any, ClientRequestToken: quoteHash(operations).slice(0, 36) })); }
    catch { const recovered = prior(await strongGet(db, T.holds, outcomeKey)); if (recovered && equal(actor, await options.authenticateDriver())) return recovered; return fail('FULL_CASH_CONFLICT_OR_UNKNOWN_OUTCOME_RETRY'); }
    return receipt;
  }
  return Object.freeze({complete:(value:unknown)=>run(value),
    prepareAdministrative:(orderId:string,decisionId:string)=>run({orderId,cashCollected:true},{decisionId})});
}
