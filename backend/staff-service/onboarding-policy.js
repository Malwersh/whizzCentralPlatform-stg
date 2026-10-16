'use strict';
const fail=()=>{throw Object.assign(Error('INVALID_ONBOARDING_SETTINGS'),{status:400});};
const FIELDS=Object.freeze({name:'text',address:'text',contactPhone:'phone',latitude:'number',longitude:'number',description:'text',registrationCertificateAssetId:'document'});
const label=v=>typeof v==='string'&&v.trim().length>0&&v.length<=150;
function validate(input){
 if(input?.partnershipReady!==undefined&&typeof input.partnershipReady!=='boolean')fail();
 if(!input||Object.keys(input).some(k=>!['types','termsVersion','termsTextAr','orphanUploadDays','partnershipReady'].includes(k))||!Array.isArray(input.types)||input.types.length<1||input.types.length>30||!label(input.termsVersion)||typeof input.termsTextAr!=='string'||input.termsTextAr.trim().length<10||input.termsTextAr.length>20000||!Number.isSafeInteger(input.orphanUploadDays)||input.orphanUploadDays<1||input.orphanUploadDays>35)fail();
 const ids=new Set();for(const type of input.types){
  if(!type||Object.keys(type).some(k=>!['id','labelAr','labelEn','order','registrationOpen','regions','model','fields','importEnabled'].includes(k))||typeof type.id!=='string'||!(/^[A-Z][A-Z0-9_]{1,39}$/).test(type.id)||ids.has(type.id)||!label(type.labelAr)||!label(type.labelEn)||!['FOOD','RETAIL'].includes(type.model)||!Number.isSafeInteger(type.order)||type.order<0||type.order>1000||typeof type.registrationOpen!=='boolean'||typeof type.importEnabled!=='boolean'||!Array.isArray(type.regions)||type.regions.length>100||type.regions.some(r=>!label(r))||new Set(type.regions).size!==type.regions.length||!Array.isArray(type.fields))fail();ids.add(type.id);
  const fields=new Set();for(const f of type.fields){if(!f||Object.keys(f).some(k=>!['id','labelAr','labelEn','visible','required','order'].includes(k))||!Object.hasOwn(FIELDS,f.id)||fields.has(f.id)||!label(f.labelAr)||!label(f.labelEn)||typeof f.visible!=='boolean'||typeof f.required!=='boolean'||(f.required&&!f.visible)||!Number.isSafeInteger(f.order)||f.order<0||f.order>1000)fail();fields.add(f.id);}
  if(fields.size!==Object.keys(FIELDS).length)fail();
  // These fields define an operational branch, not optional presentation choices.
  for(const id of ['name','address','contactPhone','latitude','longitude']){const f=type.fields.find(f=>f.id===id);if(!f.visible||!f.required)fail();}
 }
 return JSON.parse(JSON.stringify(input));
}
const names={name:['اسم النشاط','Business name'],address:['العنوان','Address'],contactPhone:['هاتف الفرع','Branch phone'],latitude:['خط العرض','Latitude'],longitude:['خط الطول','Longitude'],description:['الوصف','Description'],registrationCertificateAssetId:['شهادة التسجيل — اختياري','Registration certificate — optional']};
const DEFAULTS={termsVersion:'staging-draft-1',termsTextAr:'نص اتفاقية الشراكة قيد الاعتماد؛ لا يُفتح التسجيل الجديد قبل اعتماد نص الاتفاقية ومسار التقديم.',orphanUploadDays:7,types:[['RESTAURANT','مطعم','Restaurant','FOOD'],['MARKET','أسواق','Market','RETAIL'],['STORE','متجر','Store','RETAIL']].map(([id,labelAr,labelEn,model],order)=>({id,labelAr,labelEn,model,order,registrationOpen:false,regions:[],importEnabled:true,fields:Object.entries(names).map(([id,[labelAr,labelEn]],order)=>({id,labelAr,labelEn,order,visible:true,required:!['description','registrationCertificateAssetId'].includes(id)}))}))};
module.exports={validate,DEFAULTS,FIELDS};
