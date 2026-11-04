'use strict';
// Presentation and explicit catalog selectors, never order/pricing eligibility.
const fail=message=>Object.assign(Error(message),{status:400});
const id=v=>typeof v==='string'&&/^[\w-]{1,128}$/.test(v)&&!['__proto__','prototype','constructor'].includes(v);
const ICONS=['grid','restaurant','store','cafe','grocery','sweets','pizza','chicken','burger','breakfast','healthy','sandwich'];
const ACTIVITIES=['restaurant','store','cafe','grocery','sweets'];
function validate(value){
 if(value==null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.enabled!=='boolean'||!Array.isArray(value.items)||value.items.length<1||value.items.length>20)throw fail('Invalid navigation strip.');
 const seen=new Set();const items=value.items.map(r=>{
  if(!r||!id(r.id)||seen.has(r.id)||typeof r.label!=='string'||!r.label.trim()||r.label.length>35||/[<>\u0000-\u001f\u202a-\u202e\u2066-\u2069]/i.test(r.label))throw fail('Invalid navigation label or ID.');seen.add(r.id);
  if(!['all','activity','cuisine','brand'].includes(r.kind)||typeof r.enabled!=='boolean'||!['all','guest','signedIn'].includes(r.audience)||!ICONS.includes(r.icon))throw fail('Invalid navigation kind.');
  if(r.kind==='activity'&&!(ACTIVITIES.includes(r.value)||/^[A-Z][A-Z0-9_]{1,39}$/.test(r.value))||['cuisine','brand'].includes(r.kind)&&!id(r.value)||r.kind==='all'&&(r.id!=='all'||r.value!==null))throw fail('Invalid navigation selector.');
  if(!Array.isArray(r.regionIds)||r.regionIds.length>40||new Set(r.regionIds).size!==r.regionIds.length||r.regionIds.some(v=>!id(v)))throw fail('Invalid navigation regions.');
  const parentActivities=r.parentActivities??(r.kind==='cuisine'?['restaurant','cafe','sweets']:[]);if(!Array.isArray(parentActivities)||parentActivities.length>30||new Set(parentActivities).size!==parentActivities.length||parentActivities.some(v=>!(ACTIVITIES.includes(v)||/^[A-Z][A-Z0-9_]{1,39}$/.test(v)))||['all','activity'].includes(r.kind)&&parentActivities.length)throw fail('Invalid parent activities.');
  const startAt=r.startAt||null,endAt=r.endAt||null;
  if([startAt,endAt].some(x=>x!==null&&(typeof x!=='string'||!Number.isFinite(Date.parse(x))))||startAt&&endAt&&Date.parse(startAt)>=Date.parse(endAt))throw fail('Invalid navigation schedule.');
  const imageKey=r.imageKey||null;if(imageKey!==null&&(typeof imageKey!=='string'||!/^home-slideshow\/[\w-]+\/[\w-]+\.(jpg|gif)$/.test(imageKey)))throw fail('Upload a valid category image.');
  if(r.kind==='all'&&(!r.enabled||r.audience!=='all'||r.regionIds.length||startAt||endAt))throw fail('All category must remain available.');
  return {id:r.id,label:r.label.trim(),kind:r.kind,value:r.value,enabled:r.enabled,audience:r.audience,regionIds:r.regionIds,icon:r.icon,imageKey,startAt,endAt,parentActivities};
 });
 if(items.filter(r=>r.kind==='all').length!==1||items[0].kind!=='all')throw fail('Keep All first and available.');
 if(['activitiesEnabled','topicsEnabled'].some(k=>value[k]!=null&&typeof value[k]!=='boolean'))throw fail('Invalid strip visibility.');
 return {enabled:value.enabled,activitiesEnabled:value.activitiesEnabled??true,topicsEnabled:value.topicsEnabled??true,items};
}
function references(nav,catalog,activities){if(activities){const ids=new Set(activities.map(x=>x.id));for(const r of nav?.items||[]){for(const value of [...(r.kind==='activity'?[r.value]:[]),...(r.parentActivities||[])])if(!ACTIVITIES.includes(value)&&!ids.has(value))throw fail('Unknown onboarding activity.');}}for(const r of nav?.items||[]){if(['cuisine','brand'].includes(r.kind)&&!(catalog?.[r.kind==='cuisine'?'cuisines':'brands']||[]).some(v=>v.id===r.value))throw fail('Unknown navigation classification.');}}
function project(nav,{signedIn=false,regionIds=[],now=Date.now()}={}){
 if(nav==null)return null;
 return {enabled:nav.enabled,activitiesEnabled:nav.activitiesEnabled??true,topicsEnabled:nav.topicsEnabled??true,items:nav.enabled?nav.items.filter(r=>r.enabled&&(r.audience==='all'||r.audience===(signedIn?'signedIn':'guest'))&&(!r.regionIds.length||r.regionIds.some(v=>regionIds.includes(v)))&&(!r.startAt||Date.parse(r.startAt)<=now)&&(!r.endAt||Date.parse(r.endAt)>now)).map(({id,label,kind,value,icon,imageKey,parentActivities})=>({id,label,kind,value,icon,imageKey,parentActivities:parentActivities??(kind==='cuisine'?['restaurant','cafe','sweets']:[])})):[]};
}
let client;
async function imageUrl(key){
 const {S3Client,GetObjectCommand}=require('@aws-sdk/client-s3'),{getSignedUrl}=require('@aws-sdk/s3-request-presigner');
 client??=new S3Client({});return getSignedUrl(client,new GetObjectCommand({Bucket:'staging-wizz-home-slideshow-699561669180',Key:key}),{expiresIn:3600});
}
async function decorate(nav,ctx={}){if(nav==null)return nav;return {...nav,items:await Promise.all(nav.items.map(async r=>{if(!r.imageKey)return {...r};try{return {...r,imageUrl:await (ctx.categoryImageUrl||imageUrl)(r.imageKey)};}catch{return {...r,imageUrl:null};}}))};}
module.exports={validate,references,project,decorate,ICONS,ACTIVITIES};
