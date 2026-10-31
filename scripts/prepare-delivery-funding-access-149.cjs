'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const tables=new Set(['arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff','arn:aws:dynamodb:us-east-1:699561669180:table/staging-MerchantPlatform']);
const actions=new Set(['dynamodb:GetItem','dynamodb:PutItem','dynamodb:ConditionCheckItem','dynamodb:Query']);
function prepare(results){
 const grouped=new Map();
 for(const r of results){
  if(r.error||r.missingContext?.length||!['allowed','implicitDeny'].includes(r.decision))throw Error('ACCESS_REVIEW_INCOMPLETE');
  if(r.decision==='allowed')continue;
  if(r.permissionsBoundary?.AllowedByPermissionsBoundary===false)throw Error('BOUNDARY_REVIEW_REQUIRED');
  if(!tables.has(r.resource)||!actions.has(r.action)||!/^arn:aws:iam::699561669180:role\/.+/.test(r.role)||!r.function||
    !/^(?:DELIVERY_(?:BUDGET|USAGE|RESERVATION|FUNDING)|EMPLOYEE|BRANCH|PERSON)#review$|^OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS$/.test(r.leadingKey))throw Error('ACCESS_SCOPE_INVALID');
  const prefix=r.leadingKey.replace(/#review$/,'#*');
  if(r.action==='dynamodb:PutItem'&&!/^DELIVERY_(BUDGET|USAGE|RESERVATION)#/.test(prefix))throw Error('UNEXPECTED_NEW_WRITE_AUTHORITY');
  if(r.action==='dynamodb:Query'&&(r.resource!==[...tables][1]||prefix!=='BRANCH#*'))throw Error('UNEXPECTED_NEW_QUERY_AUTHORITY');
  if(!grouped.has(r.role))grouped.set(r.role,{functions:new Set(),byPrefix:new Map()});const role=grouped.get(r.role);role.functions.add(r.function);
  const key=r.resource+'|'+prefix;if(!role.byPrefix.has(key))role.byPrefix.set(key,{resource:r.resource,prefix,actions:new Set()});role.byPrefix.get(key).actions.add(r.action);
 }
 return [...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([role,entry])=>{
  const byActions=new Map();for(const row of entry.byPrefix.values()){const list=[...row.actions].sort(),key=JSON.stringify([row.resource,list]);if(!byActions.has(key))byActions.set(key,{resource:row.resource,actions:list,prefixes:[]});byActions.get(key).prefixes.push(row.prefix);}
  const statements=[...byActions.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))).map((r,i)=>({Sid:'DeliveryFunding149'+i,Effect:'Allow',Action:r.actions,Resource:r.resource,Condition:{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':r.prefixes.sort()},Null:{'dynamodb:LeadingKeys':'false'}}}));
  return {roleArn:role,functions:[...entry.functions].sort(),policyName:'DeliveryFunding149',policy:{Version:'2012-10-17',Statement:statements}};
 });
}
module.exports={prepare};
if(require.main===module){
 const dir=process.argv[2];if(!dir||!path.isAbsolute(dir))throw Error('ABSOLUTE_AUDIT_DIRECTORY_REQUIRED');
 const inventory=JSON.parse(fs.readFileSync(path.join(dir,'inventory.private.json'))),sim=JSON.parse(fs.readFileSync(path.join(dir,'simulations.private.json')));
 if(inventory.accountId!=='699561669180'||inventory.applied!==false||sim.applied!==false)throw Error('INVALID_AUDIT');
 const roles=prepare(sim.results);for(const row of roles){const name=row.roleArn.split('/').pop(),snapshot=fs.readFileSync(path.join(dir,name+'.policies.private.json'));row.expectedRolePolicySnapshotSha256=crypto.createHash('sha256').update(snapshot).digest('hex');}
 const candidate={part:149,reviewOnly:true,applied:false,baselineAt:inventory.at,simulationCount:sim.results.length,roles,excluded:['wallets','ledger','holds','Cognito','DeleteItem','new tables or indexes'],scope:'Only implicitly denied actions from the captured live principal-policy simulation; no activation or deployment.'};
 fs.writeFileSync(path.join(dir,'permission-candidates.json'),JSON.stringify(candidate,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({roles:roles.length,statements:roles.reduce((n,r)=>n+r.policy.Statement.length,0),applied:false}));
}
