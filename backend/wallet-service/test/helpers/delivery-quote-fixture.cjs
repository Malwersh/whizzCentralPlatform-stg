const {createStagingDeliveryQuotes}=require('../../dist/deliveryQuote');
const {TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createStagingDeliveryRouting}=require('../../dist/regionCoverage');
const {parseIqd:m}=require('../../dist/money');
const at=Date.parse('2026-10-15T12:00:00.000Z');
const point={latitude:31.925,longitude:44.457};
const rule=(scope={type:'GLOBAL',id:'GLOBAL'},base='1000')=>({id:'r-'+scope.type,version:1,scope,priority:1,status:'PUBLISHED',
 effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:null,rounding:'HALF_AWAY_FROM_ZERO',vehicleType:null,
 base:m(base),perKm:m('1000'),tiers:[],longDistance:{afterMeters:5000,flat:m('0'),perKm:m('0')},peaks:[],
 minimum:m('0'),maximum:m('10000'),coverage:{enabled:true,maxRoadMeters:10000,maxDurationSeconds:3600,supportedZoneIds:['zone']},fallbackPolicyId:null});
function fixture(){
 const levels=['country','governorate','district','zone'];
 const regions=new Map(levels.map((regionId,level)=>[regionId,{regionId,level,parent_id:level?levels[level-1]:'ROOT',is_active:1,
  ...(level===3?{geometry:{type:'Polygon',coordinates:[[[44.4,31.9],[44.5,31.9],[44.5,32],[44.4,32],[44.4,31.9]]]}}:{})}]));
 const branch={businessId:'b1',branchId:'b1',ownerId:'owner1',cognitoUserId:'owner1',organizationId:'org1',...point,address:{...point},
  regionId:'zone',regionPath:levels,status:'approved',isActive:true,onboardingSchemaVersion:2,onboardingComplete:true,acceptingOrders:true};
 const address={addressId:'a1',userId:'u1',...point};
 const policy={pk:'OPERATIONAL_SETTINGS#DELIVERY_PRICING',sk:'CURRENT',version:3,values:{deliveryRules:[rule()],driverRules:[]}};
 const organization={organizationId:'org1',subjectId:'owner1',version:1};
 const state={branch,address,policy,organization,regions,calls:[],providerCalls:0,authCalls:0,
  authenticate:async()=>({userId:'u1',subjectId:'sub1'}),afterProvider:()=>{},failTable:null,deleted:false};
 state.saved=new Map();state.orders=new Map();state.time=at;state.beforeTransaction=()=>{};state.transactions=[];state.loseResponse=false;
 const profile={userId:'u1',cognitoSub:'sub1',isActive:true};state.profile=profile;
 const auth=async()=>{const c=await state.authenticate();return {...c,condition:{ConditionCheck:{TableName:'WizzUser_users_staging',Key:{userId:c.userId},
  ConditionExpression:'attribute_exists(userId) AND cognitoSub = :sub AND isActive = :yes AND attribute_not_exists(deletionRequestId)',ExpressionAttributeValues:{':sub':c.subjectId,':yes':true}}}};};
 function value(row,path,names={}){for(const p of path.split('.')){if(row==null)return undefined;row=row[names[p]??p];}return row;}
 function matches(check,row){
  function split(expression,word){let depth=0;for(let i=0;i<expression.length;i++){if(expression[i]==='(')depth++;if(expression[i]===')')depth--;if(depth===0&&expression.slice(i,i+word.length)===word)return [expression.slice(0,i),expression.slice(i+word.length)];}return null;}
  function evaluate(expression){
   let clause=expression.trim(),parts=split(clause,' AND ');if(parts)return parts.every(evaluate);
   parts=split(clause,' OR ');if(parts)return parts.some(evaluate);
   if(clause.startsWith('(')&&clause.endsWith(')'))return evaluate(clause.slice(1,-1));
   let m=/^attribute_(not_)?exists\(([^)]+)\)$/.exec(clause);
   if(m)return (value(row,m[2],check.ExpressionAttributeNames)!==undefined)!==!!m[1];
   m=/^([A-Za-z0-9_#.]+)\s*(<=|>=|=|>|<)\s*(:[A-Za-z0-9]+)$/.exec(clause);if(!m)throw Error('unsupported expression '+clause);
   const left=value(row,m[1],check.ExpressionAttributeNames),right=check.ExpressionAttributeValues[m[3]];
   return m[2]==='='?JSON.stringify(left)===JSON.stringify(right):m[2]==='>'?left>right:m[2]==='<'?left<right:m[2]==='<='?left<=right:left>=right;
  }
  return evaluate(check.ConditionExpression);
 }
 function lookup(table,key){const extra=state.extraLookup?.(table,key);if(extra!==undefined)return extra;switch(table){
  case 'WizzOrders':return state.orders.get(key.PK+'|'+key.SK);
  case 'staging-DeliveryQuotes':return state.saved.get(key.pk+'|'+key.sk);
  case 'WizzUser_users_staging':return state.profile?.userId===key.userId?state.profile:undefined;
  case 'WizzCentral_Regions':return regions.get(key.regionId);
  case 'WizzCentral_RegionsDerived_staging':return {regionId:key.regionId,effective_is_active:state.derivedActive??1};
  case 'WhizzMerchants_Businesses':return state.branch;
  case 'WizzUser_addresses_staging':return state.address;
  case 'staging-PlatformStaff':return state.policy;
  case 'staging-MerchantPlatform':return state.organization;
  case 'staging-AccountDeletion':return state.deleted?{pk:key.pk}:undefined;
  default:if(state.extraLookup)return state.extraLookup(table,key);throw Error('unexpected table '+table);
 }}
 state.lookup=lookup;
 const db={send:async cmd=>{ if(cmd instanceof TransactWriteCommand){
  state.beforeTransaction(cmd.input);state.transactions.push(cmd.input);
  for(const action of cmd.input.TransactItems){
   const op=action.ConditionCheck??action.Put??action.Update;
   if(op&&!matches(op,lookup(op.TableName,op.Key??(op.Item.PK?{PK:op.Item.PK,SK:op.Item.SK}:{pk:op.Item.pk,sk:op.Item.sk}))))throw Object.assign(Error('conditional'),{name:'TransactionCanceledException'});
  }
  for(const a of cmd.input.TransactItems){
   if(a.Put&&state.extraPut?.(a.Put))continue;
   if(a.Put){const store=a.Put.TableName==='WizzOrders'?state.orders:state.saved;const r=a.Put.Item;store.set((r.PK??r.pk)+'|'+(r.SK??r.sk),structuredClone(r));}
   if(a.Update && state.extraUpdate && a.Update.TableName!=='staging-DeliveryQuotes'){state.extraUpdate(a.Update);continue;}
   if(a.Update){if(a.Update.TableName!=='staging-DeliveryQuotes'||a.Update.UpdateExpression!=='SET consumption=:used')throw Error('unexpected update');lookup(a.Update.TableName,a.Update.Key).consumption=structuredClone(a.Update.ExpressionAttributeValues[':used']);}
   if(a.Delete)state.saved.delete(a.Delete.Key.pk+'|'+a.Delete.Key.sk);
  }
  if(state.loseResponse&&cmd.input.TransactItems.some(a=>a.Put)){state.loseResponse=false;throw Error('lost acknowledgement');}
  return {};
 }
  const q=cmd.input;state.calls.push(q);
  if(q.TableName===state.failTable)throw Error('sensitive SDK data');
  if(q.TableName==='WizzCentral_RegionIndex_staging')return {Items:[{h3_cell:q.ExpressionAttributeValues[':cell'],regionId:'zone'}]};
  if(q.TableName==='staging-DeliveryQuotes'&&!q.Key){const all=[...state.saved.values()].filter(r=>r.pk===q.ExpressionAttributeValues[':pk']);return {Items:all.slice(0,20),...(all.length>20?{LastEvaluatedKey:{pk:all[19].pk,sk:all[19].sk}}:{})};}
  const item=lookup(q.TableName,q.Key);
  return {Item:item&&structuredClone(item)};
 }};
 const createRouter=db=>createStagingDeliveryRouting({db,getAccessToken:async()=>'test',profile:'driving',ttlSeconds:state.routeTTL??120,timeoutMs:1000,now:()=>state.time,
  fetchImpl:async()=>{state.providerCalls++;state.afterProvider();return new Response(JSON.stringify({code:'Ok',routes:[{distance:2100,duration:300}]}));}});
 state.db=db;state.auth=auth;
 state.service=createStagingDeliveryQuotes({db,createRouter,authenticateCustomer:auth,now:()=>state.time});
 state.create=(patch={})=>state.service.create({branchId:'b1',addressId:'a1',requestId:'12345678-1234-4123-8123-123456789abc',...patch});
 return state;
}
module.exports={fixture,at,point,m};
