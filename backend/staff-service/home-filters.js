'use strict';
const fail=m=>Object.assign(Error(m),{status:400});
const defaults=()=>({enabled:true,priceBands:{economyMaxIqd:7000,mediumMaxIqd:15000,minSamples:3},items:[
 {id:'all',label:'الكل',kind:'all',enabled:true,value:null},
 {id:'offers',label:'عروض',kind:'offers',enabled:true,value:null},
 {id:'open',label:'مفتوح الآن',kind:'openNow',enabled:true,value:null},
 {id:'price',label:'السعر',kind:'menuPrice',enabled:true,value:null},
 {id:'rating',label:'تقييم ٤ فأعلى',kind:'rating',enabled:true,value:4},
 {id:'fast',label:'توصيل سريع',kind:'fastDelivery',enabled:true,value:30},
 {id:'free',label:'توصيل مجاني',kind:'freeDelivery',enabled:true,value:null},
 {id:'sort',label:'ترتيب',kind:'sort',enabled:true,value:null},
]});
const KINDS=['all','offers','openNow','menuPrice','rating','fastDelivery','freeDelivery','deliveryFee','preparation','sort'];
function validate(raw){
 if(raw==null)return defaults();
 if(typeof raw.enabled!=='boolean'||!Array.isArray(raw.items)||raw.items.length<1||raw.items.length>12)throw fail('Invalid filter strip.');
 const b=raw.priceBands;if(!b||!Number.isInteger(b.economyMaxIqd)||!Number.isInteger(b.mediumMaxIqd)||b.economyMaxIqd<1000||b.mediumMaxIqd<=b.economyMaxIqd||b.mediumMaxIqd>1000000||!Number.isInteger(b.minSamples)||b.minSamples<3||b.minSamples>30)throw fail('Invalid menu price bands.');
 const ids=new Set(),kinds=new Set();const items=raw.items.map(r=>{
  if(!r||typeof r.id!=='string'||!/^[-\w]{1,80}$/.test(r.id)||ids.has(r.id)||kinds.has(r.kind)||!KINDS.includes(r.kind)||typeof r.enabled!=='boolean'||typeof r.label!=='string'||!r.label.trim()||r.label.length>35||/[<>\u0000-\u001f]/.test(r.label))throw fail('Invalid filter.');ids.add(r.id);kinds.add(r.kind);
  const value=r.value??null;
  if(r.kind==='rating'&&(!Number.isFinite(value)||value<1||value>5)||['fastDelivery','preparation'].includes(r.kind)&&(!Number.isInteger(value)||value<5||value>180)||r.kind==='deliveryFee'&&(!Number.isInteger(value)||value<0||value>100000)||!['rating','fastDelivery','preparation','deliveryFee'].includes(r.kind)&&value!==null)throw fail('Invalid filter threshold.');
  if(r.kind==='all'&&(r.id!=='all'||!r.enabled))throw fail('All filter must remain available.');
  return {id:r.id,label:r.label.trim(),kind:r.kind,enabled:r.enabled,value};
 });
 if(items[0].kind!=='all')throw fail('Keep All filter first.');return {enabled:raw.enabled,priceBands:{...b},items};
}
module.exports={defaults,validate,KINDS};
