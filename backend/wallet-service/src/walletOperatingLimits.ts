import {DynamoDBDocumentClient,GetCommand} from '@aws-sdk/lib-dynamodb';
import {WalletError} from './types';
export const walletLimitsKey={idempotencyKey:'CONFIG#WALLET_OPERATING_LIMITS',sk:'META'};
export const defaultWalletLimits={version:0,manualMinimumIqd:25000,manualMaximumIqd:500000,manualApprovalDailyIqd:500000,driverPayoutMaximumIqd:1000000000};
export type WalletLimits=typeof defaultWalletLimits;
export const limitsError=(message:string,code='WALLET_LIMITS_INVALID',status=409):never=>{throw new WalletError(message,code,status);};
export function validateWalletLimits(v:any):WalletLimits{
 if(!v||Object.keys(v).some(k=>!Object.keys(defaultWalletLimits).includes(k))||!Number.isSafeInteger(v.version)||v.version<0)return limitsError('إعداد حدود المحفظة غير صالح');
 for(const k of Object.keys(defaultWalletLimits).filter(k=>k!=='version'))if(!Number.isSafeInteger(v[k])||v[k]<1)return limitsError('الحدود يجب أن تكون أعدادًا صحيحة موجبة');
 if(v.manualMinimumIqd>v.manualMaximumIqd||v.manualMaximumIqd>v.manualApprovalDailyIqd||v.manualMaximumIqd>1000000000||v.manualApprovalDailyIqd>10000000000||v.driverPayoutMaximumIqd>1000000000)return limitsError('حدود الشحن والصرف غير متناسقة');
 return {...v};
}
export async function readWalletLimits(db:Pick<DynamoDBDocumentClient,'send'>,table='staging-IdempotencyKeys'):Promise<WalletLimits>{
 const {Item}=await db.send(new GetCommand({TableName:table,Key:walletLimitsKey,ConsistentRead:true}));
 return Item?validateWalletLimits(Item.config):{...defaultWalletLimits};
}
export function walletLimitsGuard(limits:WalletLimits,table='staging-IdempotencyKeys'){
 return {ConditionCheck:{TableName:table,Key:walletLimitsKey,ConditionExpression:limits.version===0?'attribute_not_exists(idempotencyKey)':'config.#v=:v',...(limits.version===0?{}:{ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':limits.version}})}};
}
