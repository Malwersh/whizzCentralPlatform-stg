'use strict';
const DEFAULTS={enabled:false,source:'both',selection:null,backgroundColor:'#00296B',itemBackgroundColor:null,title:'مزايا ويز',intervalSeconds:6,subtitle:'عروض وخصومات',scenes:[],startAt:null,endAt:null};
function validate(value){
 if(value==null)return {...DEFAULTS};
 const bad=()=>{throw Object.assign(Error('Invalid promotion header settings.'),{status:400});};
 if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(DEFAULTS,k)))bad();
 const v={...DEFAULTS,...value};
 if(typeof v.enabled!=='boolean'||!['both','platform','merchant'].includes(v.source)||!/^#[0-9A-Fa-f]{6}$/.test(v.backgroundColor)||typeof v.title!=='string'||!v.title.trim()||v.title.length>45||/[<>\u0000-\u001f]/.test(v.title)||!Number.isInteger(v.intervalSeconds)||v.intervalSeconds<5||v.intervalSeconds>15)bad();
 if(typeof v.subtitle!=='string'||v.subtitle.length>100||/[<>\u0000-\u001f]/.test(v.subtitle)||!Array.isArray(v.scenes)||v.scenes.length>20)bad();
 const ids=new Set();v.scenes=v.scenes.map(s=>{if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['id','enabled','title','subtitle','productMode','productIds'].includes(k))||typeof s.id!=='string'||!/^[-\w]{1,150}$/.test(s.id)||ids.has(s.id)||typeof s.enabled!=='boolean'||typeof s.title!=='string'||s.title.length>80||typeof s.subtitle!=='string'||s.subtitle.length>100||/[<>\u0000-\u001f]/.test(s.title+s.subtitle)||!['discounted','menu','selected'].includes(s.productMode)||!Array.isArray(s.productIds)||s.productIds.length>6||new Set(s.productIds).size!==s.productIds.length||s.productIds.some(x=>typeof x!=='string'||!/^[-\w]{1,150}$/.test(x)))bad();ids.add(s.id);return {...s,productIds:[...s.productIds]};});
 if(v.itemBackgroundColor!==null&&(typeof v.itemBackgroundColor!=='string'||!/^#[0-9A-Fa-f]{6}$/.test(v.itemBackgroundColor)))bad();
 if(v.selection!==null){const s=v.selection;if(typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['source','id'].includes(k))||!['benefit','platform','merchant'].includes(s.source)||typeof s.id!=='string'||!/^[-\w]{1,150}$/.test(s.id)||(v.source==='merchant'&&s.source!=='merchant')||(v.source==='platform'&&s.source==='merchant'))bad();}
 if([v.startAt,v.endAt].some(x=>x!==null&&(typeof x!=='string'||!Number.isFinite(Date.parse(x))))||(v.startAt&&v.endAt&&Date.parse(v.startAt)>=Date.parse(v.endAt)))bad();
 return {...v,title:v.title.trim(),backgroundColor:v.backgroundColor.toUpperCase()};
}
function project(value,now=Date.now()){const v=validate(value);return {...v,enabled:v.enabled&&(!v.startAt||Date.parse(v.startAt)<=now)&&(!v.endAt||Date.parse(v.endAt)>now)};}
module.exports={DEFAULTS,validate,project};
