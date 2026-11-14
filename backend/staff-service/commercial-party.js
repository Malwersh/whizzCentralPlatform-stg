'use strict';
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
const P='staging-MerchantPlatform',S='staging-PlatformStaff',L='staging-AccountDeletion';
const managers=new Set(['MANAGER','BRANCH_MANAGER','LEGACY_MANAGER']);
// Product rule: an assigned active branch manager may accept discount sharing.
// This does not enable the unfinished all-purpose manager preset or fee agreements.
function manager(member,branch,subject,policy){
 if(!member||member.pk!=='BRANCH#'+branch.businessId||member.sk!=='MEMBER#'+subject||member.subjectId!==subject||member.ownerId!==branch.ownerId||member.businessId!==branch.businessId||member.status!=='ACTIVE'||!managers.has(member.role)||!Number.isSafeInteger(member.version)||member.version<1)return false;
 if(member.permissionSchema===undefined)return member.role==='MANAGER';
 return member.permissionSchema===2&&member.grant?.roleId===member.role&&member.grant.branchIds?.length===1&&member.grant.branchIds[0]===branch.businessId&&member.grant.permissions?.includes('branch.read')&&policy?.enabledPermissions?.includes('branch.read');
}
async function resolve(db,branch,subject){
 if(subject===branch.ownerId)return {role:'OWNER',subjectId:subject,ownerId:branch.ownerId,guards:[]};
 const get=async(t,k)=>(await db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;
 const key={pk:'BRANCH#'+branch.businessId,sk:'MEMBER#'+subject},member=await get(P,key),policy=member?.permissionSchema===2?await get(S,{pk:'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',sk:'CURRENT'}):null;
 if(!manager(member,branch,subject,policy))throw Object.assign(Error('BUSINESS_UNAVAILABLE'),{status:404});
 const guards=[{ConditionCheck:{TableName:P,Key:key,ConditionExpression:'#v=:v AND #s=:s AND ownerId=:owner AND subjectId=:subject AND #r=:r',ExpressionAttributeNames:{'#v':'version','#s':'status','#r':'role'},ExpressionAttributeValues:{':v':member.version,':s':'ACTIVE',':owner':branch.ownerId,':subject':subject,':r':member.role}}},{ConditionCheck:{TableName:L,Key:{pk:'ACCOUNT_LIFECYCLE#MERCHANT#'+subject,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}}];
 if(policy)guards.push({ConditionCheck:{TableName:S,Key:{pk:policy.pk,sk:policy.sk},ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':policy.version}}});
 return {role:'MANAGER',subjectId:subject,ownerId:branch.ownerId,guards};
}
module.exports={manager,resolve};
