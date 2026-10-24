'use strict';
const {GetCommand}=require('@aws-sdk/lib-dynamodb');
const contract=require('../../merchant-platform/staff-permission-policy');
const {REGISTRY}=require('../../merchant-platform/staff-capabilities');
const TABLE='staging-PlatformStaff',KEY={pk:'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',sk:'CURRENT'};
const fail=(code,status=403)=>{throw Object.assign(Error(code),{status});};
async function read(db){
 let row;try{row=(await db.send(new GetCommand({TableName:TABLE,Key:KEY,ConsistentRead:true,ProjectionExpression:'#v, enabledPermissions, #roles',ExpressionAttributeNames:{'#v':'version','#roles':'roles'}}))).Item;contract.validatePolicy(row,REGISTRY);}catch(_){fail('STAFF_POLICY_UNAVAILABLE',503);}
 return row;
}
function fence(policy){return {ConditionCheck:{TableName:TABLE,Key:KEY,ConditionExpression:'#v=:v',ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':policy.version}}};}
function selection(input,policy,businessId){
 if(!input||Object.keys(input).some(k=>!['roleId','expectedPolicyVersion'].includes(k)))fail('INVALID_STAFF_GRANT',400);
 let grant;try{grant=contract.snapshotGrant({policy,registry:REGISTRY,...input,branchIds:[businessId]});}catch(e){fail(e.code||'INVALID_STAFF_GRANT',e.code==='POLICY_VERSION_CONFLICT'?409:400);}
 if(!grant.permissions.includes('branch.read'))fail('BRANCH_READ_REQUIRED',400);
 const actions=['orders.accept','orders.reject','orders.prepare','orders.ready'];
 if(actions.some(id=>grant.permissions.includes(id))&&!actions.every(id=>grant.permissions.includes(id)))fail('ROLE_ORDER_BUNDLE_REQUIRED',400);
 return {permissionSchema:2,role:grant.roleId,extraPermissions:[],grant};
}
const centralMode=()=>{const mode=process.env.MERCHANT_STAFF_PERMISSION_MODE||'LEGACY';if(!['LEGACY','CENTRAL'].includes(mode))fail('STAFF_PERMISSION_MODE_INVALID',503);return mode==='CENTRAL';};
function requireExplicit(action,input){if(centralMode()&&['invite','update'].includes(action)&&input===undefined)fail('EXPLICIT_STAFF_GRANT_REQUIRED',409);}
function legacy(row,policy){try{return require('../../merchant-platform/staff-legacy-grants').snapshot(row,policy);}catch(_){fail('LEGACY_GRANT_REVIEW_REQUIRED',409);}}
async function employee(db,m,businessId){
 let policy;const central=centralMode();
 if(m.permissionSchema===undefined){if(!central)return null;policy=await read(db);m={...m,...legacy(m,policy)};}
 if(m.permissionSchema!==2||!m.grant||m.role!==m.grant.roleId||m.grant.branchIds?.length!==1||m.grant.branchIds[0]!==businessId||m.businessId!==businessId)fail('INVALID_STAFF_GRANT');
 policy=policy||await read(db);
 let permissions;try{permissions=contract.effectivePermissions({...m.grant,status:m.status,version:m.version},policy,REGISTRY,businessId);}catch(_){fail('INVALID_STAFF_GRANT');}
 return {policy,permissions,fence:fence(policy),membership:m};
}
// Existing invitations retain their saved snapshot; template edits never widen them.
function validateInvitation(grant,policy,businessId){
 let checked;try{checked=contract.snapshotGrant({policy,registry:REGISTRY,roleId:grant?.roleId,selectedPermissions:grant?.permissions,branchIds:[businessId],expectedPolicyVersion:grant?.policyVersion});}catch(e){fail(e.code||'INVALID_STAFF_GRANT',409);}
 if(checked.roleVersion!==grant.roleVersion)fail('POLICY_VERSION_CONFLICT',409);
}
function publicPolicy(policy){return {version:policy.version,enabledPermissions:policy.enabledPermissions,roles:policy.roles.filter(r=>r.enabled),capabilities:REGISTRY};}
module.exports={read,fence,selection,validateInvitation,employee,publicPolicy,centralMode,requireExplicit,legacy};
