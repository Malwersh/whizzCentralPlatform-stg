'use strict';
const {driverPhoneClosureKey}=require('../../../backend/account-deletion/driver-phone-binding');
function phoneClosureCondition(phone){
 return {ConditionCheck:{TableName:'wizz-production-AccountDeletion',Key:driverPhoneClosureKey(phone),ConditionExpression:'attribute_not_exists(pk)'}};
}
async function checkPhoneOpen(db,GetCommand,phone){
 const {TableName,Key}=phoneClosureCondition(phone).ConditionCheck;
 if((await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item)throw Error('AccountClosing');
}
const POOL='us-east-1_5sUT54eCB';
function lifecycleCondition(subject){
 if(typeof subject!=='string'||!subject||subject.length>128)throw Error('InvalidIdentity');
 return {ConditionCheck:{TableName:'wizz-production-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+subject,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}};
}
async function requireWallet({db,GetCommand,lambda,InvokeCommand,event,subject}){
 if(event.request?.userAttributes?.sub!==subject)throw Error('InvalidIdentity');
 if(event.userPoolId!==POOL)throw Error('InvalidIdentityPool');
 const key={walletId:'WALLET#DRIVER#'+subject,sk:'META'};
 const fence=lifecycleCondition(subject);
 const marker=await db.send(new GetCommand({TableName:fence.ConditionCheck.TableName,Key:fence.ConditionCheck.Key,ConsistentRead:true}));
 if(marker.Item)throw Error('AccountClosing');
 const read=()=>db.send(new GetCommand({TableName:'wizz-production-Wallets',Key:key,ConsistentRead:true}));
 let wallet=(await read()).Item;
 if(!wallet){
  const response=await lambda.send(new InvokeCommand({FunctionName:'wizz-production-wallet-creation-trigger',InvocationType:'RequestResponse',Payload:Buffer.from(JSON.stringify(event))}));
  if(response.FunctionError||response.StatusCode!==200)throw Error('WalletProvisioningUnavailable');
  wallet=(await read()).Item;
 }
 if(!wallet)throw Error('WalletProvisioningUnavailable');
 if(wallet.ownerType!=='DRIVER'||wallet.ownerId!==subject||wallet.status!=='ACTIVE'||wallet.deletionRequestId||wallet.currency!=='IQD')throw Error('WalletNotEligible');
 return fence;
}
module.exports={requireWallet,lifecycleCondition,phoneClosureCondition,checkPhoneOpen};
