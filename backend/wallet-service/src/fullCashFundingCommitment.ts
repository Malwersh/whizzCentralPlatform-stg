import {verifyGoodsPromotionExposure} from './goodsPromotionExposure';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { strongGet, exactCheck, equal } from './driverFinancialTransaction';
import { FULL_CASH_SETTLEMENT_MODEL } from './fullCashSettlement';
import { readMoney } from './money';
type Row=Record<string,any>;
/** Retain the server-created authorization/budget commitment, never a wallet cash hold. */
export async function retainFullCashFundingCommitment(db:Pick<DynamoDBDocumentClient,'send'>,value:{orderId:string;snapshotDigest:string;deliveryFunding:Row|null;goodsAmount:unknown;goodsExposure?:Row}) {
 const key={orderId:value.orderId,sk:'FULL_CASH_FUNDING_COMMITMENT'};
 const row=await strongGet(db,'staging-Holds',key);
 if(!row||row.kind!=='FULL_CASH_FUNDING_COMMITMENT'||row.status!=='COMMITTED'||row.settlementModel!==FULL_CASH_SETTLEMENT_MODEL||row.snapshotDigest!==value.snapshotDigest||!equal(row.deliveryFunding,value.deliveryFunding)||!equal(row.platformGoodsFunding,readMoney(value.goodsAmount)))throw Error('FULL_CASH_BUDGET_COMMITMENT_REQUIRED');
 if(readMoney(value.goodsAmount).minorAmount>0){verifyGoodsPromotionExposure(row.goodsExposure,value.goodsAmount);if(!equal(row.goodsExposure,value.goodsExposure))throw Error('FULL_CASH_BUDGET_COMMITMENT_REQUIRED');}
 return exactCheck('staging-Holds',key,row);
}
