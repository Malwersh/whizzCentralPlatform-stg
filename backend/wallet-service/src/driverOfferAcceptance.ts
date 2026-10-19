import { prepareDeliveryFundingRetention } from './deliveryFundingRetention';
import { assignedArrivalEstimate } from './orderArrivalEstimate';
import {pinnedFinancialWaveFence} from './dispatchWaveFence';
import {createStagingDispatchCoordinator} from './dispatchCoordinator';
import { codIntegrationEvent, codAcceptanceOperation } from './codIntegrationEvent';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createStagingDriverOfferContext } from './driverOfferContext';
import { resolveFinancialOffer,versionedFinancialOfferView,versionedFinancialOfferAcceptance } from './financialOfferVersion';
import { quoteHash, quoteEntityIdValid } from './deliveryQuoteRecord';
import { detach, equal, strongGet, exactCheck, updateChecked, FinancialRow as Row } from './driverFinancialTransaction';
const tables={offers:'WaveOffers_staging',jobs:'WizzDispatchJobs_staging',wallets:'staging-Wallets',holds:'staging-Holds',
  ledger:'staging-LedgerEntries',audit:'staging-AuditLog',lifecycle:'staging-WalletLifecycle'};
export class DriverAcceptanceError extends Error {
  constructor(public readonly code:'INVALID_FINANCIAL_ACCEPTANCE'|'FINANCIAL_ACCEPTANCE_UNAVAILABLE'|'FINANCIAL_ACCEPTANCE_CONFLICT'|'DRIVER_WALLET_UNAVAILABLE'|'INSUFFICIENT_BALANCE') {
    super(code);this.name='DriverAcceptanceError';
  }
}
const fail=(c:DriverAcceptanceError['code']):never=>{throw new DriverAcceptanceError(c);};
/** Sole new acceptance transaction: never call createHold before or after this writer.
 * authenticateDriver must verify live credentials; selectors never supply the acting identity.
 * COD assignment attempts. Replacement requires a verified release archive; schema-2 holds use the financial lifecycle writers.
 */
export function createStagingDriverOfferAcceptance(options:{db:Pick<DynamoDBDocumentClient,'send'>;
  context:ReturnType<typeof createStagingDriverOfferContext>;
  contextForOffer?:(offer:Row)=>ReturnType<typeof createStagingDriverOfferContext>;
  authenticateDriver:()=>Promise<{driverId:string;subjectId:string}>;now?:()=>number;enableDeliveryFunding?:boolean}) {
  const {db,context,authenticateDriver}=options,now=options.now??Date.now;
  async function afterDecline(saved:Row){
    try{const assignment=await strongGet(db,tables.jobs,{orderId:saved.orderId,SK:'METADATA'});
    if(!assignment||!Object.prototype.hasOwnProperty.call(assignment,'dispatchCycle'))return {success:true,declined:true,offerId:saved.offerId};
    const transition=await createStagingDispatchCoordinator({db,now,enableDeliveryFunding:options.enableDeliveryFunding}).plan({orderId:saved.orderId,assignmentId:resolveFinancialOffer(saved.financialOffer,options.enableDeliveryFunding).assignmentId,source:'DECLINE'});return {success:true,declined:true,offerId:saved.offerId,transition};}
    catch{return {success:true,declined:true,offerId:saved.offerId,transitionPending:true};}
  }
  return Object.freeze({async accept(value:unknown) {
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='offerId,orderId,waveNumber')return fail('INVALID_FINANCIAL_ACCEPTANCE');
    const input=detach(value as Row),{orderId,offerId,waveNumber}=input;
    if(![orderId,offerId].every(quoteEntityIdValid)||!Number.isSafeInteger(waveNumber)||waveNumber<1||waveNumber>1000)return fail('INVALID_FINANCIAL_ACCEPTANCE');
    const actor=detach(await authenticateDriver());
    if(!actor||![actor.driverId,actor.subjectId].every(quoteEntityIdValid))return fail('INVALID_FINANCIAL_ACCEPTANCE');
    const key={orderId,SK:`FINANCIAL#${actor.driverId}#WAVE#${waveNumber}`};
    let saved:Row|null;
    try{saved=await strongGet(db,tables.offers,key);}catch{return fail('FINANCIAL_ACCEPTANCE_UNAVAILABLE');}
    if(!saved||saved.kind!=='FINANCIAL_DRIVER_OFFER'||saved.schemaVersion!==2||saved.offerId!==offerId||saved.driverId!==actor.driverId||saved.waveNumber!==waveNumber||saved.orderId!==orderId||saved.SK!==key.SK)return fail('FINANCIAL_ACCEPTANCE_CONFLICT');
    const offer=resolveFinancialOffer(saved.financialOffer,options.enableDeliveryFunding);
    if(!equal(offer.versionedOffer,saved.financialOffer)||offer.driverId!==actor.driverId||offer.driverSubjectId!==actor.subjectId||offer.offerId!==offerId||offer.orderId!==orderId)return fail('FINANCIAL_ACCEPTANCE_CONFLICT');
    function prior(row:Row|null) {
      if(row?.responseStatus!=='financial_accepted'||row.isWinner!==true||!equal(row.financialOffer,offer.versionedOffer)||
          row.financialReceipt?.offerId!==offerId||row.financialReceipt?.driverId!==actor.driverId||
          row.financialReceipt?.orderId!==orderId||row.acceptedTerms?.offerDigest!==offer.digest)return null;
      return detach({...row.financialReceipt,replayed:true});
    }
    const replay=prior(saved);if(replay)return replay;
    if(saved.responseStatus!=='financial_pending'||saved.isWinner!==false)return fail('FINANCIAL_ACCEPTANCE_CONFLICT');
    const references=await (options.contextForOffer?.(offer)??context).checkAcceptance({orderId,branchId:offer.branchId,driverId:actor.driverId,offerId,waveNumber});
    if(references.subjectId!==actor.subjectId||references.driver.vehicleType!==offer.source.driver.vehicleType||references.assignment.dispatchJobId!==offer.assignmentId)return fail('FINANCIAL_ACCEPTANCE_CONFLICT');
    const timestamp=new Date(now()).toISOString();
    const enabled=references.bundle.driverRules.filter((r:Row)=>r.status==='PUBLISHED'&&Date.parse(r.effectiveFrom)<=Date.parse(timestamp)&&
      (r.effectiveTo===null||Date.parse(r.effectiveTo)>Date.parse(timestamp))).map((r:Row)=>({id:r.id,version:r.version,hash:quoteHash(r)}));
    const plan=versionedFinancialOfferAcceptance({offer,offerId,driverId:actor.driverId,subjectId:actor.subjectId,
      assignmentId:references.assignment.dispatchJobId,assignmentVersion:waveNumber,order:references.order.snapshot,...(references.order.deliveryFunding?{deliveryFunding:references.order.deliveryFunding}:{}),at:timestamp,
      policy:{version:references.policy.version,enabledRuleVersions:enabled}},options.enableDeliveryFunding);
    const waveKey={orderId,SK:`FINANCIAL_WAVE#${waveNumber}`},wave=await strongGet(db,tables.jobs,waveKey);
    if(!wave||wave.kind!=='FINANCIAL_WAVE'||wave.state!=='READY'||wave.assignmentId!==offer.assignmentId||wave.branchId!==offer.branchId||
        !Array.isArray(wave.driverIds)||!wave.driverIds.includes(actor.driverId))return fail('FINANCIAL_ACCEPTANCE_CONFLICT');
    const pinnedGuards=await pinnedFinancialWaveFence(db,references.assignment,offer,waveNumber,wave,now());
    const walletId='WALLET#DRIVER#'+actor.driverId,walletKey={walletId,sk:'META'},wallet=await strongGet(db,tables.wallets,walletKey);
    if(!wallet||wallet.ownerType!=='DRIVER'||wallet.ownerId!==actor.driverId||wallet.currency!=='IQD'||wallet.status!=='ACTIVE'||wallet.deletionRequestId!=null||
        ![wallet.availableBalance,wallet.lockedBalance,wallet.version].every(Number.isSafeInteger)||wallet.availableBalance<0||wallet.lockedBalance<0||wallet.version<1||
        !Number.isSafeInteger(wallet.availableBalance+wallet.lockedBalance)||wallet.version===Number.MAX_SAFE_INTEGER)return fail('DRIVER_WALLET_UNAVAILABLE');
    const amount=plan.legacyWalletAmounts.acceptanceHoldIqd;
    if(wallet.availableBalance<amount)return fail('INSUFFICIENT_BALANCE');
    const holdKey={orderId,sk:'HOLD'},oldHold=await strongGet(db,tables.holds,holdKey);
    if(oldHold&&(!references.order.priorRelease||oldHold.status!=='RELEASED'||oldHold.releaseOperationId!==references.order.priorRelease.operationId||oldHold.metadata?.assignmentAttempt!==references.order.nextAssignmentAttempt-1||oldHold.metadata?.offerDigest!==references.order.priorRelease.offerDigest||!equal(oldHold,references.order.priorRelease.releasedHold)))return fail('FINANCIAL_ACCEPTANCE_CONFLICT');
    const holdId=amount?'FH:'+quoteHash({orderId,offerId,digest:offer.digest}).slice(0,48):null;
    const receipt={success:true,kind:'FINANCIAL_DRIVER_ACCEPTANCE',offerId,orderId,driverId:actor.driverId,acceptedAt:timestamp,
      assignmentAttempt:references.order.nextAssignmentAttempt,holdId,holdStatus:amount?'ACTIVE':'NOT_REQUIRED',holdAmount:amount,replayed:false};
    // Older deployed context readers omit preparation metadata. Hydrate it here
    // and fence it in the same assignment transaction without repricing money.
    const arrivalSource=await strongGet(db,'WizzOrders',{PK:'ORDER#'+orderId,SK:'META'});
    if(!arrivalSource||arrivalSource.orderId!==orderId)return fail('FINANCIAL_ACCEPTANCE_CONFLICT');
    const readyAt=arrivalSource.estimatedReadyAt,arrivalGuard=detach(references.order.condition);
    const arrivalCheck=arrivalGuard.ConditionCheck;
    arrivalCheck.ExpressionAttributeNames={...arrivalCheck.ExpressionAttributeNames,'#etaReady':'estimatedReadyAt'};
    if(readyAt===undefined)arrivalCheck.ConditionExpression+=' AND attribute_not_exists(#etaReady)';
    else {arrivalCheck.ExpressionAttributeValues={...arrivalCheck.ExpressionAttributeValues,':etaReady':readyAt};arrivalCheck.ConditionExpression+=' AND #etaReady=:etaReady';}
    const g=references.guards;
    const ops:Row[]=[g.driver,g.policy,g.branch,...g.deletions,...(references.order.releaseCondition?[references.order.releaseCondition]:[]),
      exactCheck(tables.jobs,waveKey,wave),...pinnedGuards,
      updateChecked(g.assignment,'SET #uStatus=:uAssigned, #uDriver=:uDriver, #uAt=:uAt',
        {'#uStatus':'status','#uDriver':'assignedDriverId','#uAt':'assignedAt'},{':uAssigned':'assigned',':uDriver':actor.driverId,':uAt':timestamp}),
      updateChecked(g.position,'SET #uStatus=:uBusy, #uOrder=:uOrder, #uCount=:uCount, #uSearch=:uFalse',
        {'#uStatus':'status','#uOrder':'currentOrderId','#uCount':'activeOrdersCount','#uSearch':'isSearching'},
        {':uBusy':'busy',':uOrder':orderId,':uCount':1,':uFalse':false}),
      updateChecked(arrivalGuard,'SET #uStatus=:uAssigned, #uStatus2=:uAssigned, #uDriver=:uDriver, #uAt=:uAt, #uTerms=:uTerms, #uHold=:uHold, #uHs=:uHs, #uHa=:uHa, #uFrozen=:uTrue, #uAttempt=:uOne, #uWave=:uWave',
        {'#uStatus':'status','#uStatus2':'orderStatus','#uDriver':'driverId','#uAt':'assignedAt','#uTerms':'financialAcceptance','#uHold':'holdId',
          '#uHs':'holdStatus','#uHa':'holdAmount','#uFrozen':'pricingFrozen','#uAttempt':'assignmentAttemptCounter','#uWave':'assignmentWaveNumber'},
        {':uAssigned':'assigned',':uDriver':actor.driverId,':uAt':timestamp,':uTerms':plan.acceptedTerms,':uHold':holdId,':uHs':receipt.holdStatus,':uHa':amount,':uTrue':true,':uOne':references.order.nextAssignmentAttempt,':uWave':waveNumber}),
      updateChecked(exactCheck(tables.offers,key,saved),'SET #uStatus=:uAccepted, #uWin=:uTrue, #uAt=:uAt, #uTerms=:uTerms, #uReceipt=:uReceipt',
        {'#uStatus':'responseStatus','#uWin':'isWinner','#uAt':'responseAt','#uTerms':'acceptedTerms','#uReceipt':'financialReceipt'},
        {':uAccepted':'financial_accepted',':uTrue':true,':uAt':timestamp,':uTerms':plan.acceptedTerms,':uReceipt':receipt}),
      {Put:{TableName:tables.audit,Item:{datePartition:'date#'+timestamp.slice(0,10).replace(/-/g,''),sk:timestamp+'#'+offerId,
        logId:offerId,action:'FINANCIAL_DRIVER_OFFER_ACCEPTED',actorId:actor.subjectId,driverId:actor.driverId,branchId:offer.branchId,orderId,offerId,holdId,amount,currency:'IQD',createdAt:timestamp},ConditionExpression:'attribute_not_exists(sk)'}}];
    if(references.order.deliveryFunding)ops.push(...await prepareDeliveryFundingRetention(db,{orderId,at:timestamp,operationId:codAcceptanceOperation(orderId,offerId,references.order.nextAssignmentAttempt),deliveryFunding:references.order.deliveryFunding,goodsAmount:references.order.snapshot.allocation.platformGoodsDiscount,commercialPricing:references.order.commercialPricing}));
    const arrival=assignedArrivalEstimate(timestamp,offer.calculation.pickupRoute.durationSeconds,
      offer.calculation.deliveryRoute.durationSeconds,readyAt);
    const orderUpdate=ops.find(op=>op.Update?.TableName==='WizzOrders')?.Update;
    if(!orderUpdate)return fail('FINANCIAL_ACCEPTANCE_UNAVAILABLE');
    orderUpdate.UpdateExpression+=', #arrivalTime=:arrivalTime, #arrivalEstimate=:arrivalEstimate';
    Object.assign(orderUpdate.ExpressionAttributeNames,{'#arrivalTime':'estimatedDeliveryTime','#arrivalEstimate':'deliveryEstimate'});
    Object.assign(orderUpdate.ExpressionAttributeValues,{':arrivalTime':arrival.estimatedDeliveryTime,':arrivalEstimate':arrival.deliveryEstimate});
    ops.push(codIntegrationEvent({kind:'COD_ACCEPTANCE_OUTBOX',financialOperationId:codAcceptanceOperation(orderId,offerId,references.order.nextAssignmentAttempt),
      orderId,driverId:actor.driverId,subjectId:actor.subjectId,branchId:offer.branchId,offerId,attempt:references.order.nextAssignmentAttempt,waveNumber,createdAt:timestamp}));
    const walletFence=exactCheck(tables.wallets,walletKey,wallet,['walletId','sk','ownerType','ownerId','status','currency','availableBalance','lockedBalance','version','deletionRequestId']);
    if(amount){
      ops.push(updateChecked(walletFence,'SET #uAv=:uAv, #uLocked=:uLocked, #uVersion=:uVersion, #uAt=:uAt',
        {'#uAv':'availableBalance','#uLocked':'lockedBalance','#uVersion':'version','#uAt':'updatedAt'},
        {':uAv':wallet.availableBalance-amount,':uLocked':wallet.lockedBalance+amount,':uVersion':wallet.version+1,':uAt':timestamp}),
        {Put:{TableName:tables.holds,Item:{...holdKey,holdId,walletId,amount,status:'ACTIVE',statusCreatedAt:'ACTIVE#'+timestamp,
          financialSchemaVersion:2,createdAt:timestamp,updatedAt:timestamp,metadata:{assignmentAttempt:references.order.nextAssignmentAttempt,offerId,offerDigest:offer.digest}},...(oldHold?{ConditionExpression:exactCheck(tables.holds,holdKey,oldHold).ConditionCheck.ConditionExpression,ExpressionAttributeNames:exactCheck(tables.holds,holdKey,oldHold).ConditionCheck.ExpressionAttributeNames,ExpressionAttributeValues:exactCheck(tables.holds,holdKey,oldHold).ConditionCheck.ExpressionAttributeValues}:{ConditionExpression:'attribute_not_exists(orderId)'})}},
        {Put:{TableName:tables.lifecycle,Item:{operationId:holdId,orderId,walletId,amount,financialSchemaVersion:2,status:'REVIEW_REQUIRED',action:'REVIEW',
          lastError:'FINANCIAL_SETTLEMENT_PENDING',createdAt:timestamp,updatedAt:timestamp},ConditionExpression:'attribute_not_exists(operationId)'}});
      for(const locked of [false,true])ops.push({Put:{TableName:tables.ledger,Item:{walletId,sk:'ts#'+timestamp+'#'+(locked?'LOCKED#':'AVAILABLE#')+holdId,
        transactionId:holdId,type:locked?'CREDIT':'DEBIT',category:'HOLD_CREATED',amount:locked?amount:-amount,
        balanceBefore:locked?wallet.lockedBalance:wallet.availableBalance,balanceAfter:locked?wallet.lockedBalance+amount:wallet.availableBalance-amount,
        relatedEntityId:orderId,relatedEntityType:'HOLD',metadata:{orderId,holdId,balanceType:locked?'LOCKED':'AVAILABLE',financialSchemaVersion:2},createdAt:timestamp},ConditionExpression:'attribute_not_exists(sk)'}});
    }else {
      ops.push(walletFence);
      if(oldHold){const fence=exactCheck(tables.holds,holdKey,oldHold).ConditionCheck;
       ops.push({Put:{TableName:tables.holds,Item:{...holdKey,holdId:null,walletId,amount:0,status:'NOT_REQUIRED',financialSchemaVersion:2,createdAt:timestamp,metadata:{assignmentAttempt:references.order.nextAssignmentAttempt,offerId,offerDigest:offer.digest}},ConditionExpression:fence.ConditionExpression,ExpressionAttributeNames:fence.ExpressionAttributeNames,ExpressionAttributeValues:fence.ExpressionAttributeValues}});
      }else ops.push({ConditionCheck:{TableName:tables.holds,Key:holdKey,ConditionExpression:'attribute_not_exists(orderId)'}});
    }
    if(Buffer.byteLength(JSON.stringify(ops))>3500000||ops.length>100)return fail('FINANCIAL_ACCEPTANCE_UNAVAILABLE');
    const confirmedActor=await authenticateDriver();
    if(!equal(actor,confirmedActor))return fail('INVALID_FINANCIAL_ACCEPTANCE');
    versionedFinancialOfferView(offer,actor.driverId,actor.subjectId,new Date(now()).toISOString(),options.enableDeliveryFunding);
    try{await db.send(new TransactWriteCommand({TransactItems:ops as any,ClientRequestToken:quoteHash(ops).slice(0,36)}));}
    catch(e:any){
      const committed=prior(await strongGet(db,tables.offers,key));if(committed)return committed;
      return fail(e?.name==='TransactionCanceledException'?'FINANCIAL_ACCEPTANCE_CONFLICT':'FINANCIAL_ACCEPTANCE_UNAVAILABLE');
    }
    return receipt;
  }, async decline(value:unknown) {
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='offerId,orderId,waveNumber')return fail('INVALID_FINANCIAL_ACCEPTANCE');
    const input=detach(value as Row),actor=detach(await authenticateDriver());
    if(![input.orderId,input.offerId,actor.driverId,actor.subjectId].every(quoteEntityIdValid)||!Number.isSafeInteger(input.waveNumber)||input.waveNumber<1||input.waveNumber>1000)return fail('INVALID_FINANCIAL_ACCEPTANCE');
    const key={orderId:input.orderId,SK:`FINANCIAL#${actor.driverId}#WAVE#${input.waveNumber}`},saved=await strongGet(db,tables.offers,key);
    if(!saved||saved.offerId!==input.offerId)return fail('FINANCIAL_ACCEPTANCE_CONFLICT');
    const offer=resolveFinancialOffer(saved.financialOffer,options.enableDeliveryFunding);
    if(!equal(offer.versionedOffer,saved.financialOffer)||offer.driverSubjectId!==actor.subjectId||offer.driverId!==actor.driverId||offer.orderId!==input.orderId||offer.offerId!==input.offerId)return fail('FINANCIAL_ACCEPTANCE_CONFLICT');
    if(saved.responseStatus==='financial_declined')return afterDecline(saved);
    if(saved.responseStatus!=='financial_pending'||saved.isWinner!==false)return fail('FINANCIAL_ACCEPTANCE_CONFLICT');
    const live=await (options.contextForOffer?.(offer)??context).checkAcceptance({orderId:input.orderId,branchId:offer.branchId,driverId:actor.driverId,offerId:input.offerId,waveNumber:input.waveNumber});
    versionedFinancialOfferView(offer,actor.driverId,actor.subjectId,new Date(now()).toISOString(),options.enableDeliveryFunding);
    const wave=Object.prototype.hasOwnProperty.call(live.assignment,'dispatchCycle')?await strongGet(db,tables.jobs,{orderId:input.orderId,SK:'FINANCIAL_WAVE#'+input.waveNumber}):null;
    const pinnedGuards=await pinnedFinancialWaveFence(db,live.assignment,offer,input.waveNumber,wave,now());
    const g=live.guards;
    await db.send(new TransactWriteCommand({TransactItems:[live.order.condition,...(live.order.releaseCondition?[live.order.releaseCondition]:[]),g.assignment,g.driver,g.position,g.policy,g.branch,...g.deletions,...pinnedGuards,...(wave?[exactCheck(tables.jobs,{orderId:input.orderId,SK:wave.SK},wave)]:[]),
      updateChecked(exactCheck(tables.offers,key,saved),'SET #uStatus=:uStatus, #uAt=:uAt',{'#uStatus':'responseStatus','#uAt':'responseAt'},
        {':uStatus':'financial_declined',':uAt':new Date(now()).toISOString()})] as any}));
    return afterDecline(saved);
  }});
}
