 'use strict';
const {GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {createHash}=require('node:crypto');
const PK='OPERATIONAL_SETTINGS#ORDER_RECEPTION';
const fail=(code,status=400)=>Object.assign(Error(code),{status});
function decode(audio){
 if(typeof audio!=='string'||audio.length>350000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audio))throw fail('INVALID_SOUND_FILE');
 const b=Buffer.from(audio,'base64');
 if(b.length<44||b.length>256000||b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'||b.readUInt32LE(4)!==b.length-8)throw fail('INVALID_SOUND_FILE');
 let format,bytes=0;
 for(let pos=12;pos+8<=b.length;){const id=b.toString('ascii',pos,pos+4),len=b.readUInt32LE(pos+4),start=pos+8;if(start+len>b.length)throw fail('INVALID_SOUND_FILE');if(id==='fmt '){if(len<16)throw fail('INVALID_SOUND_FILE');format={pcm:b.readUInt16LE(start),channels:b.readUInt16LE(start+2),rate:b.readUInt32LE(start+4),bps:b.readUInt32LE(start+8),align:b.readUInt16LE(start+12),bits:b.readUInt16LE(start+14)};}if(id==='data')bytes+=len;pos=start+len+(len%2);}
 if(!format||format.pcm!==1||![1,2].includes(format.channels)||![8,16].includes(format.bits)||format.rate<8000||format.rate>48000||format.align!==format.channels*format.bits/8||format.bps!==format.rate*format.align||!bytes||bytes%format.align||bytes/format.bps>5)throw fail('INVALID_SOUND_FILE');
 const hash=createHash('sha256').update(b).digest('hex');return {id:'custom_'+hash,file:'custom_'+hash+'.wav',audio:b.toString('base64'),durationSeconds:bytes/format.bps,sha256:hash};
}
const view=row=>({id:row.id,label:row.label,file:row.file,audio:row.audio,sha256:row.sha256,durationSeconds:row.durationSeconds});
async function list(db,table){const items=[];let cursor;do{const r=await db.send(new QueryCommand({TableName:table,KeyConditionExpression:'pk=:pk AND begins_with(sk,:s)',ExpressionAttributeValues:{':pk':PK,':s':'SOUND#'},ExclusiveStartKey:cursor,ConsistentRead:true}));items.push(...r.Items||[]);cursor=r.LastEvaluatedKey;}while(cursor);return items.map(view);}
async function selected(db,table,values){const ids=[...new Set(Object.values(values).filter(v=>typeof v==='string'&&/^custom_[a-f0-9]{64}$/.test(v)))];return Promise.all(ids.map(async id=>{const row=(await db.send(new GetCommand({TableName:table,Key:{pk:PK,sk:'SOUND#'+id},ConsistentRead:true}))).Item;if(!row)throw fail('SOUND_NOT_FOUND',503);return view(row);}));}
async function upload(ctx,actor,input){
 if(!ctx.enrolled||!ctx.allowed(actor,'settings.change.request'))throw fail('PERMISSION_REQUIRED',403);ctx.recent(ctx.claims);
 if(typeof input.label!=='string'||!input.label.trim()||input.label.length>80)throw fail('INVALID_SOUND_LABEL');
 const sound=decode(input.audio),key={pk:PK,sk:'SOUND#'+sound.id};
 const old=(await ctx.db.send(new GetCommand({TableName:ctx.table,Key:key,ConsistentRead:true}))).Item;if(old)return {sound:view(old)};
 const counterKey={pk:PK,sk:'SOUND_CATALOG_COUNT'};const countRow=(await ctx.db.send(new GetCommand({TableName:ctx.table,Key:counterKey,ConsistentRead:true}))).Item;const count=countRow?.count??0;if(count>=12)throw fail('SOUND_CATALOG_FULL');
 const item={...key,...sound,label:input.label.trim(),createdBy:actor.employeeId,createdAt:new Date().toISOString()};
 await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),{Put:{TableName:ctx.table,Item:{...counterKey,count:count+1},ConditionExpression:countRow?'#c=:c':'attribute_not_exists(pk)',...(countRow?{ExpressionAttributeNames:{'#c':'count'},ExpressionAttributeValues:{':c':count}}:{})}},{Put:{TableName:ctx.table,Item:item,ConditionExpression:'attribute_not_exists(sk)'}},ctx.audit(actor.employeeId,'NOTIFICATION_SOUND_UPLOADED',null,{id:sound.id,sha256:sound.sha256,label:item.label},sound.id)]}));return {sound:view(item)};
}
module.exports={decode,list,selected,upload};
