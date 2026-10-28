const assert=require('node:assert/strict');
const {TABLES:T}=require('../repository');
const classes={};for(const name of ['GetCommand','ScanCommand','QueryCommand','TransactWriteCommand','BatchWriteCommand','DeleteCommand'])classes[name]=({[name]:class{constructor(input){this.input=input;}}})[name];
const copy=structuredClone;
function fixture(){
 const rows=new Map(),calls=[],messages=[];let hook,clock=Date.parse('2026-10-26T12:00:00Z'),unprocessed=0,budget=45000,loseCommit;
 const keyOf=(table,row)=>table==='staff'?{pk:row.pk,sk:row.sk}:table===T.index?{index_cell_id:row.index_cell_id}:table===T.neighbors?{neighbor_pair_id:row.neighbor_pair_id}:table===T.audit?{audit_id:row.audit_id}:{regionId:row.regionId};
 const key=(t,k)=>t+'|'+JSON.stringify(k),get=(t,k)=>rows.get(key(t,k)),put=(t,r)=>rows.set(key(t,keyOf(t,r)),copy(r));
 function check(q,row){if(!q.ConditionExpression)return true;return q.ConditionExpression.split(' AND ').every(term=>{let a=term.match(/^attribute_not_exists\(([^)]+)\)$/);if(a)return row?.[q.ExpressionAttributeNames?.[a[1]]??a[1]]===undefined;const m=term.match(/^([^=]+)=([^=]+)$/);assert(m,'unsupported '+term);const field=q.ExpressionAttributeNames?.[m[1].trim()]??m[1].trim();return JSON.stringify(row?.[field])===JSON.stringify(q.ExpressionAttributeValues[m[2].trim()]);});}
 const db={async send(command){calls.push(command);const q=command.input;
  if(command instanceof classes.GetCommand)return {Item:copy(get(q.TableName,q.Key))};
  if(command instanceof classes.ScanCommand)return {Items:[...rows.entries()].filter(([k])=>k.startsWith(q.TableName+'|')).map(([,r])=>copy(r))};
  if(command instanceof classes.QueryCommand){let list=[...rows.entries()].filter(([k])=>k.startsWith(q.TableName+'|')).map(([,r])=>copy(r));
   if(q.KeyConditionExpression.startsWith('pk=')){list=list.filter(r=>r.pk===q.ExpressionAttributeValues[':pk']);if(q.ExpressionAttributeValues[':prefix'])list=list.filter(r=>r.sk.startsWith(q.ExpressionAttributeValues[':prefix']));list.sort((a,b)=>a.sk.localeCompare(b.sk));if(q.ScanIndexForward===false)list.reverse();}
   else list=list.filter(r=>r.regionId===q.ExpressionAttributeValues[':id']);
   if(q.ExclusiveStartKey){const i=list.findIndex(r=>JSON.stringify(keyOf(q.TableName,r))===JSON.stringify(q.ExclusiveStartKey));if(i>=0)list=list.slice(i+1);}
   const limit=q.Limit||100000,more=list.length>limit;list=list.slice(0,limit);const last=list.at(-1);if(q.FilterExpression)list=list.filter(r=>r.publicationId===q.ExpressionAttributeValues[':job']);
   return {Items:q.Select==='COUNT'?undefined:list,Count:list.length,...(more?{LastEvaluatedKey:keyOf(q.TableName,last)}:{})};
  }
  if(command instanceof classes.BatchWriteCommand){if(unprocessed-->0)return {UnprocessedItems:q.RequestItems};for(const [t,items]of Object.entries(q.RequestItems))for(const op of items){if(op.PutRequest)put(t,op.PutRequest.Item);else rows.delete(key(t,op.DeleteRequest.Key));}return {};}
  if(command instanceof classes.DeleteCommand){if(!check(q,get(q.TableName,q.Key)))throw Object.assign(Error('condition'),{name:'ConditionalCheckFailedException'});rows.delete(key(q.TableName,q.Key));return {};}
  assert(command instanceof classes.TransactWriteCommand);const ops=q.TransactItems;
  const identities=ops.map(op=>{const x=op.Put||op.Delete||op.ConditionCheck;return key(x.TableName,op.Put?keyOf(x.TableName,x.Item):x.Key);});assert.equal(new Set(identities).size,identities.length,'duplicate transaction item');
  if(hook){const h=hook;hook=null;h(ops);}
  for(const op of ops){const x=op.Put||op.Delete||op.ConditionCheck,k=op.Put?keyOf(x.TableName,x.Item):x.Key;if(!check(x,get(x.TableName,k)))throw Object.assign(Error('condition'),{name:'TransactionCanceledException'});}
  for(const op of ops){if(op.Put)put(op.Put.TableName,op.Put.Item);else if(op.Delete)rows.delete(key(op.Delete.TableName,op.Delete.Key));}if(loseCommit&&loseCommit(ops)){loseCommit=null;throw Object.assign(Error('response lost'),{name:'TimeoutError'});}return {};
 }};
 const square=(x,y,size=0.01)=>({type:'Polygon',coordinates:[[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]]});
 const actor={employeeId:'admin',status:'ACTIVE',version:1,scope:{allRegions:true,regionIds:[]},permissions:['regions.read','regions.edit','regions.activate']};put('staff',{pk:'EMPLOYEE#admin',sk:'PROFILE',...actor});
 const region=(id,level,parent,geometry)=>({regionId:id,level,parent_id:parent,geometry,name:id,name_ar:'اسم '+id,is_active:true,version:1,service_config:{delivery:true,pickup:false,dineIn:false},delivery_config:{estimated_time_minutes:20}});
 for(const r of [region('country',0,null,square(40,28,10)),region('gov',1,'country',square(41,29,5)),region('district',2,'gov',square(42,30,3)),region('a',3,'district',square(44,31))]){put(T.base,r);put(T.derived,{regionId:r.regionId,parent_id:r.parent_id||'ROOT',level:r.level,version:1,effective_is_active:1,effective_config:{delivery:{estimated_time_minutes:20}},effective_pricing:{base_fee:3000},effective_limits:{max_active_orders_per_driver:1}});}
 const allowed=(a,p)=>a.permissions?.includes(p);
 const ctx={db,sdk:classes,table:'staff',allowed,claims:{},recent:()=>{},now:()=>clock,guard:a=>({ConditionCheck:{TableName:'staff',Key:{pk:'EMPLOYEE#'+a.employeeId,sk:'PROFILE'},ConditionExpression:'#v=:v AND #s=:s',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':a.version,':s':'ACTIVE'}}}),audit:(actor,action,before,after,id)=>({Put:{TableName:'staff',Item:{pk:'AUDIT',sk:id,actor,action,before,after},ConditionExpression:'attribute_not_exists(pk)'}}),enqueue:async id=>messages.push(id)};
 const worker=require('../worker').make({...ctx,deadline:()=>clock+budget,sleep:async()=>{}});
 const route=(action,body,who=actor)=>require('../service').route(ctx,who,action==='get'?'GET':'POST','/staff/regions/manage'+(action==='get'?'':'/'+action),body);
 const saveDraft=async r=>{const c=await route('get'),prior=c.drafts.find(d=>d.region.regionId===r.regionId);return route('draft',{region:r,catalogDigest:c.digest,expectedDraftVersion:prior?.version??0,reason:'حدود تمت مراجعتها للاختبار'});};
 const publish=async(ids,requestId='request_1')=>{const c=await route('get');return route('publish',{catalogDigest:c.digest,drafts:c.drafts.filter(d=>ids.includes(d.region.regionId)).map(d=>({regionId:d.region.regionId,version:d.version})),requestId,reason:'نشر الحدود المراجعة للاختبار'});};
 const job=id=>get('staff',{pk:'REGION_JOB#'+id,sk:'META'});
 async function drain(id,max=30){for(let i=0;i<max;i++){clock+=71000;await worker.run(id);const j=job(id);if(['FAILED','CANCELLED'].includes(j.status)||j.status==='PUBLISHED'&&!j.cleanupPending)return j;}throw Error('not finished '+JSON.stringify(job(id)));}
 return {ctx,actor,route,saveDraft,publish,drain,worker,job,rows,calls,messages,get,put,square,region,hook:fn=>hook=fn,advance:ms=>clock+=ms,unprocessed:n=>unprocessed=n,setBudget:n=>budget=n,loseCommit:fn=>loseCommit=fn};
}
module.exports={fixture};
