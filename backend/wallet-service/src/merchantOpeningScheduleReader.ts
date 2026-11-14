import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {createMerchantSettlementScheduleReader} from './merchantSettlementScheduleReader';
import {quoteEntityIdValid} from './deliveryQuoteRecord';
/** Opening cutoff is the first approved schedule, never a client-supplied past anchor. */
export function createMerchantOpeningScheduleReader(db:Pick<DynamoDBDocumentClient,'send'>){
 return async(branchId:string)=>{
  if(!quoteEntityIdValid(branchId))throw Error('INVALID_SETTLEMENT_SCHEDULE_SELECTION');
  const table='staging-MerchantPlatform',pk='BRANCH#'+branchId,currentKey={pk,sk:'SETTLEMENT_SCHEDULE#CURRENT'};
  const current=await strongGet(db,table,currentKey);if(!current)return null;
  if(!await createMerchantSettlementScheduleReader(db)(branchId,current.effectiveFrom))return null;
  const firstKey={pk,sk:'SETTLEMENT_SCHEDULE#VERSION#1'},first=await strongGet(db,table,firstKey);
  if(!first||first.schedule?.version!==1||first.branchId!==branchId||first.effectiveFrom>current.effectiveFrom)throw Error('SETTLEMENT_SCHEDULE_HISTORY_INVALID');
  const adapter={send:async(command:any)=>command.input.TableName===table&&equal(command.input.Key,currentKey)?{Item:{...first,sk:currentKey.sk}}:db.send(command)};
  const original=await createMerchantSettlementScheduleReader(adapter as any)(branchId,first.effectiveFrom);
  if(!original||current.schedule.version===1&&first.digest!==current.digest)throw Error('SETTLEMENT_SCHEDULE_HISTORY_INVALID');
  const after=await strongGet(db,table,currentKey);if(!equal(current,after))throw Error('SETTLEMENT_SCHEDULE_CHANGED');
  return {schedule:original.schedule,openingCutoff:first.effectiveFrom,guard:exactCheck(table,currentKey,current),guards:[exactCheck(table,firstKey,first)]};
 };
}
