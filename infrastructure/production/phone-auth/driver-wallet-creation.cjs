'use strict';
// Production adapter of WalletService.createWallet: zero balance, conditional
// creation, plus an atomic account lifecycle fence. No funding is performed.
const POOL='us-east-1_5sUT54eCB';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function createDriverWallet({event,db,GetCommand,TransactWriteCommand,now=()=>new Date().toISOString()}){
 const a=event?.request?.userAttributes;
 if(event?.userPoolId!==POOL||event?.triggerSource!=='PostConfirmation_ConfirmSignUp'||!UUID.test(a?.sub||'')||a?.phone_number_verified!=='true')throw Error('InvalidDriverConfirmation');
 const subject=a.sub,key={walletId:'WALLET#DRIVER#'+subject,sk:'META'};
 const lifecycle={TableName:'wizz-production-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+subject,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'};
 const read=async()=> (await db.send(new GetCommand({TableName:'wizz-production-Wallets',Key:key,ConsistentRead:true}))).Item;
 const validate=w=>{if(!w||w.ownerId!==subject||w.ownerType!=='DRIVER'||w.currency!=='IQD'||w.status!=='ACTIVE'||w.deletionRequestId)throw Error('WalletNotEligible');return {walletId:key.walletId};};
 const marker=await db.send(new GetCommand({TableName:lifecycle.TableName,Key:lifecycle.Key,ConsistentRead:true}));
 if(marker.Item)throw Error('AccountClosing');
 const existing=await read();if(existing)return validate(existing);
 const timestamp=now();
 try{await db.send(new TransactWriteCommand({TransactItems:[{ConditionCheck:lifecycle},{Put:{TableName:'wizz-production-Wallets',Item:{...key,ownerType:'DRIVER',ownerId:subject,currency:'IQD',status:'ACTIVE',availableBalance:0,lockedBalance:0,minRequiredBalance:0,version:0,createdAt:timestamp,updatedAt:timestamp},ConditionExpression:'attribute_not_exists(walletId)'}}]}));}
 catch(e){if(e.name!=='TransactionCanceledException')throw e;
 // A concurrent creator may win; a concurrent deletion must never be ignored.
 const currentMarker=await db.send(new GetCommand({TableName:lifecycle.TableName,Key:lifecycle.Key,ConsistentRead:true}));if(currentMarker.Item)throw Error('AccountClosing');
 const winner=await read();if(!winner)throw e;return validate(winner);}
 return validate(await read());
}
module.exports={createDriverWallet};
