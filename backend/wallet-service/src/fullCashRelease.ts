import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal,updateChecked} from './driverFinancialTransaction';
import {toWholeIqdExact} from './money';
import {createStagingDeliveryCampaignBudget} from './deliveryCampaignBudget';
type Row=Record<string,any>;
const fail=():never=>{throw Error('FULL_CASH_RELEASE_CONFLICT');};
function set(check:Row,fields:Row){const names:Row={},values:Row={};const assignments=Object.entries(fields).map(([k,v],i)=>{names['#u'+i]=k;values[':u'+i]=v;return '#u'+i+'=:u'+i;});return updateChecked(check,'SET '+assignments.join(', '),names,values);}
/** Plan only: caller must atomically pin authenticated order/attempt/outcome guards. */
export async function prepareFullCashRelease(db:Pick<DynamoDBDocumentClient,'send'>,order:Row,offer:Row,at:string,operationId:string,terminal:boolean){
 const H=toWholeIqdExact(offer.allocation.driverWalletHold),orderId=order.orderId,operations:Row[]=[],journalLines:Row[]=[];
 if(order.financialSnapshot?.schemaVersion!==3||order.holdAmount!==H||order.holdStatus!==(H?'ACTIVE':'NOT_REQUIRED'))return fail();
 const holdKey={orderId,sk:'HOLD'},hold=await strongGet(db,'staging-Holds',holdKey);
 if(order.financialAcceptance){
  if(!hold||hold.financialSchemaVersion!==4||hold.settlementModel!=='FULL_CASH_AT_DELIVERY_V1'||hold.status!==(H?'ACTIVE':'NOT_REQUIRED')||hold.holdId!==order.holdId||hold.amount!==H||hold.walletId!=='WALLET#DRIVER#'+order.driverId||hold.metadata?.offerDigest!==offer.digest||hold.metadata?.assignmentAttempt!==order.assignmentAttemptCounter)return fail();
  operations.push(set(exactCheck('staging-Holds',holdKey,hold),{status:'RELEASED',statusCreatedAt:'RELEASED#'+at,updatedAt:at,releaseOperationId:operationId}));
 }else{
  if(H||hold||order.driverId!=null||order.holdId!=null)return fail();
  operations.push({ConditionCheck:{TableName:'staging-Holds',Key:holdKey,ConditionExpression:'attribute_not_exists(orderId)'}});
 }
 if(H){
  const walletKey={walletId:hold!.walletId,sk:'META'},wallet=await strongGet(db,'staging-Wallets',walletKey);
  if(!wallet||wallet.ownerId!==order.driverId||wallet.ownerType!=='DRIVER'||wallet.currency!=='IQD'||!['ACTIVE','SUSPENDED'].includes(wallet.status)||wallet.deletionRequestId!=null||wallet.deletedAt!=null||wallet.isDeleted===true||![wallet.availableBalance,wallet.lockedBalance,wallet.version].every(Number.isSafeInteger)||wallet.availableBalance<0||wallet.lockedBalance<H||wallet.version<1||wallet.version>=Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(wallet.availableBalance+wallet.lockedBalance)||!Number.isSafeInteger(wallet.availableBalance+H))return fail();
  operations.push(set(exactCheck('staging-Wallets',walletKey,wallet,[...Object.keys(wallet),'deletionRequestId','deletedAt','isDeleted']),{availableBalance:wallet.availableBalance+H,lockedBalance:wallet.lockedBalance-H,version:wallet.version+1,updatedAt:at}));
  const lcKey={operationId:hold!.holdId},lc=await strongGet(db,'staging-WalletLifecycle',lcKey);
  if(!lc||lc.kind!=='FULL_CASH_HOLD'||lc.financialSchemaVersion!==4||lc.status!=='FULL_CASH_PENDING_COMPLETION'||lc.orderId!==orderId||lc.amount!==H)return fail();
  operations.push(set(exactCheck('staging-WalletLifecycle',lcKey,lc),{status:'COMPLETED',action:'NONE',updatedAt:at,lastError:null,releaseOperationId:operationId}));
  for(const bucket of ['AVAILABLE','LOCKED']){const delta=bucket==='AVAILABLE'?H:-H,before=bucket==='AVAILABLE'?wallet.availableBalance:wallet.lockedBalance;const line={walletId:wallet.walletId,balanceType:bucket,delta,unit:'IQD_WHOLE',balanceBefore:before,balanceAfter:before+delta};journalLines.push(line);operations.push({Put:{TableName:'staging-LedgerEntries',Item:{walletId:wallet.walletId,sk:`ts#${at}#${bucket}#${operationId}`,transactionId:operationId,type:delta>0?'CREDIT':'DEBIT',category:'FULL_CASH_RELEASED',amount:delta,balanceBefore:before,balanceAfter:before+delta,relatedEntityId:orderId,relatedEntityType:'ORDER',createdAt:at,metadata:{orderId,operationId,balanceType:bucket,financialSchemaVersion:4,settlementModel:'FULL_CASH_AT_DELIVERY_V1'}},ConditionExpression:'attribute_not_exists(sk)'}});}
 }
 const key={orderId,sk:'FULL_CASH_FUNDING_COMMITMENT'},budget=await strongGet(db,'staging-Holds',key),funding=order.financialSnapshot.deliveryFunding;
 if(!budget||budget.status!=='COMMITTED'||budget.kind!=='FULL_CASH_FUNDING_COMMITMENT'||budget.snapshotDigest!==order.financialSnapshot.digest||!equal(budget.deliveryFunding,funding)||!equal(budget.platformGoodsFunding,offer.allocation.platformGoodsDiscountFunding))return fail();
 operations.push(terminal?set(exactCheck('staging-Holds',key,budget),{status:'RELEASED',operationId,releasedAt:at}):exactCheck('staging-Holds',key,budget));
 if(terminal&&funding){const campaign=await createStagingDeliveryCampaignBudget({db}).settle({orderId,outcome:'RELEASED',expectedFunding:funding});if(campaign.replayed)return fail();operations.push(...campaign.operations);}
 return {operations,journalLines,H,F:0,DF:0,hold};
}
