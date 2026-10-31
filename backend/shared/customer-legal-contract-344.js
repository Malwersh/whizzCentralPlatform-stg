'use strict';
const {createHash}=require('node:crypto');
const PK='OPERATIONAL_SETTINGS#CUSTOMER_LEGAL';
const AUDIENCES=['CUSTOMER','DRIVER','MERCHANT'];
const pkFor=audience=>{if(!AUDIENCES.includes(audience))fail('INVALID_LEGAL_AUDIENCE');return 'OPERATIONAL_SETTINGS#'+audience+'_LEGAL';};
const IDS=['USAGE','TERMS','PRIVACY','CANCELLATION'];
const copy=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status,statusCode:status});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const text=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
function validate(v){
 if(!exact(v,['schemaVersion','audience','brand','documents'])||v.schemaVersion!==1||!AUDIENCES.includes(v.audience)||!exact(v.brand,['appName','companyName','supportPhone','supportEmail','logoKey'])||!text(v.brand.appName,1,60)||!text(v.brand.companyName,3,120)||!/^\+9647\d{9}$/.test(v.brand.supportPhone)||!(v.brand.supportEmail===''||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.brand.supportEmail)&&v.brand.supportEmail.length<120)||!['WIZZ_BLUE','WIZZ_PRIMARY'].includes(v.brand.logoKey)||!Array.isArray(v.documents)||v.documents.length!==IDS.length)fail('INVALID_LEGAL_DOCUMENTS');
 const ids=new Set();
 for(const d of v.documents){
  if(!exact(d,['id','title','sections'])||!IDS.includes(d.id)||ids.has(d.id)||!text(d.title,3,120)||!Array.isArray(d.sections)||d.sections.length<1||d.sections.length>30)fail('INVALID_LEGAL_DOCUMENTS');ids.add(d.id);
  for(const s of d.sections)if(!exact(s,['heading','body'])||!text(s.heading,2,160)||!text(s.body,10,4000))fail('INVALID_LEGAL_DOCUMENTS');
 }
 if(Buffer.byteLength(JSON.stringify(v))>180000)fail('LEGAL_DOCUMENTS_TOO_LARGE');
 return copy(v);
}
function readPublished(row){
 if(!row||row.pk!==pkFor(row.values?.audience)||row.sk!=='CURRENT'||row.status!=='PUBLISHED'||!Number.isSafeInteger(row.version)||row.version<1||!Number.isFinite(Date.parse(row.publishedAt)))fail('LEGAL_DOCUMENTS_UNAVAILABLE',503);
 const values=validate(row.values);
 const body={schemaVersion:1,revision:row.version,publishedAt:row.publishedAt,...values};
 const digest=hash(body);if(row.digest!==digest)fail('LEGAL_DOCUMENTS_UNAVAILABLE',503);
 return {...body,digest};
}
function pin(bundle){return {revision:bundle.revision,digest:bundle.digest};}
async function published(db,Get,table,audience='CUSTOMER'){if(!table)fail('LEGAL_DOCUMENTS_UNAVAILABLE',503);const r=await db.send(new Get({TableName:table,Key:{pk:pkFor(audience),sk:'CURRENT'},ConsistentRead:true}));const bundle=readPublished(r.Item);if(bundle.audience!==audience)fail('LEGAL_DOCUMENTS_UNAVAILABLE',503);return bundle;}
async function consent(db,Get,table,input,audience='CUSTOMER'){
 const bundle=await published(db,Get,table,audience);
 if(!exact(input,['revision','digest'])||input.revision!==bundle.revision||input.digest!==bundle.digest)fail('LEGAL_VERSION_CHANGED',409);
 return {bundle,condition:{ConditionCheck:{TableName:table,Key:{pk:pkFor(audience),sk:'CURRENT'},ConditionExpression:'#v = :v AND #d = :d AND #s = :published',ExpressionAttributeNames:{'#v':'version','#d':'digest','#s':'status'},ExpressionAttributeValues:{':v':bundle.revision,':d':bundle.digest,':published':'PUBLISHED'}}}};
}
const defaults=audience=>{pkFor(audience);return copy(require('./'+audience.toLowerCase()+'-legal-defaults-344.json'));};
module.exports={PK,IDS,AUDIENCES,pkFor,defaults,hash,validate,readPublished,pin,published,consent,DEFAULTS:require('./customer-legal-defaults-344.json')};
