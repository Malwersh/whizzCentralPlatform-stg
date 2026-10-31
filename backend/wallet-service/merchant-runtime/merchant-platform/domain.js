'use strict';
const fail=code=>{throw Object.assign(Error(code),{code});};
const text=(v,max,required=true)=>{if(v==null&&!required)return null;if(typeof v!=='string'||v.trim().length>max||(required&&!v.trim()))fail('INVALID_TEXT');return v.trim();};
const ROLES=Object.freeze({OWNER:['branch.read','branch.hours.write','branch.description.write','branch.photo.write','branch.instructions.write','branch.phone.change','branch.manage','menu.read','menu.write','menu.import','orders.read','orders.manage','device.manage','staff.manage','finance.read','reports.read','business.close'],MANAGER:['branch.read','branch.hours.write','menu.read','menu.write','menu.import','orders.read','orders.manage'],RECEPTION:['branch.read','menu.read','orders.read','orders.manage'],FINANCE:['branch.read','finance.read'],REPORT_READER:['branch.read','reports.read']});
function phone(v){const n=String(v??'').replace(/[٠-٩]/g,c=>c.charCodeAt(0)-1632).replace(/[۰-۹]/g,c=>c.charCodeAt(0)-1776).replace(/[\s()-]/g,'');if(/^07\d{9}$/.test(n))return '+964'+n.slice(1);if(/^\+?9647\d{9}$/.test(n))return '+'+n.replace(/^\+/,'');fail('INVALID_PHONE');}
function person(input){return {name:text(input.name,100),phone:phone(input.phone),termsVersion:text(input.termsVersion,40)};}
function branchDraft(input,policy){
 if(!policy||!Array.isArray(policy.types))fail('ONBOARDING_SETTINGS_UNAVAILABLE');
 const type=policy.types.find(t=>t.id===input.businessType);if(!type||!['FOOD','RETAIL'].includes(type.model))fail('INVALID_BUSINESS_TYPE');
 const fields=type.fields;if(!Array.isArray(fields))fail('ONBOARDING_SETTINGS_UNAVAILABLE');
 for(const f of fields){const value=input[f.id];if(!f.visible&&value!=null)fail('HIDDEN_FIELD');if(f.required&&(value==null||(typeof value==='string'&&!value.trim())))fail('REQUIRED_FIELD');}

 const latitude=input.latitude,longitude=input.longitude;if(typeof latitude!=='number'||!Number.isFinite(latitude)||Math.abs(latitude)>90||typeof longitude!=='number'||!Number.isFinite(longitude)||Math.abs(longitude)>180)fail('INVALID_LOCATION');
 // Identity, status, ownership and health certificates never come from form fields.
 return {name:text(input.name,150),businessType:input.businessType,address:text(input.address,500),latitude,longitude,contactPhone:phone(input.contactPhone),description:input.description==null?null:text(input.description,2000),registrationCertificateAssetId:input.registrationCertificateAssetId==null?null:text(input.registrationCertificateAssetId,150),reviewStatus:'DRAFT',operatingStatus:'OFFLINE',version:1};
}
function eligible(branch){return !!branch&&branch.reviewStatus==='APPROVED'&&!branch.deletionRequestId&&branch.lifecycleStatus!=='CLOSING'&&branch.lifecycleStatus!=='CLOSED';}
function permissions(membership,policy,registry,branchId){if(membership?.permissionSchema!==undefined){if(membership.permissionSchema!==2||!membership.grant)fail('INVALID_STAFF_GRANT');return require('./staff-permission-policy').effectivePermissions({...membership.grant,status:membership.status,version:membership.version},policy,registry,branchId);}if(membership?.status!=='ACTIVE')return [];if(!ROLES[membership.role])fail('INVALID_ROLE');const defaults=ROLES[membership.role];return [...new Set([...defaults,...(membership.extraPermissions||[])])];}
function authorize({subjectId,membership,branchId,permission,session,device,policy,registry,now=Date.now()/1000}){
 if(!subjectId||membership?.subjectId!==subjectId||membership?.status!=='ACTIVE'||!Number.isSafeInteger(membership.version))fail('MEMBERSHIP_REQUIRED');
 if(!Array.isArray(membership.branchIds)||!membership.branchIds.includes(branchId))fail('BRANCH_SCOPE_REQUIRED');
 if(session?.subjectId!==subjectId||session.membershipId!==membership.membershipId||session.membershipVersion!==membership.version||session.branchId!==branchId||!Number.isFinite(session.expiresAt)||session.expiresAt<=now)fail('SESSION_REVOKED');
 if(device?.status!=='ACTIVE'||device.branchId!==branchId||device.deviceId!==session.deviceId||device.version!==session.deviceVersion)fail('DEVICE_REVOKED');
 if(!permissions(membership,policy,registry,branchId).includes(permission))fail('PERMISSION_REQUIRED');return true;
}
function delegate(actor,requested){const owned=new Set(permissions(actor));if(!owned.has('staff.manage'))fail('PERMISSION_REQUIRED');if(requested.role==='OWNER')fail('OWNERSHIP_TRANSFER_REQUIRED');for(const b of requested.branchIds||[])if(!actor.branchIds?.includes(b))fail('BRANCH_SCOPE_REQUIRED');for(const p of permissions({...requested,status:'ACTIVE'}))if(!owned.has(p))fail('PRIVILEGE_ESCALATION');return true;}
function priceIQD(value,{allowZero=false}={}){if(!Number.isSafeInteger(value)||value<(allowZero?0:1)||value>1000000000)fail('INVALID_PRICE');return value;}
function quote(item,selections){
 if(!item||item.status!=='PUBLISHED'||item.isAvailable!==true)fail('ITEM_UNAVAILABLE');let total=priceIQD(item.price);if(!Array.isArray(selections))fail('INVALID_SELECTION');
 const groups=item.optionGroups||[],chosen=new Map();
 if(!Array.isArray(groups))fail('INVALID_OPTION_GROUP');const ids=new Set();for(const g of groups){if(typeof g.id!=='string'||ids.has(g.id)||!Array.isArray(g.options))fail('INVALID_OPTION_GROUP');ids.add(g.id);const optionIds=new Set();for(const o of g.options){if(typeof o.id!=='string'||optionIds.has(o.id))fail('INVALID_OPTION_GROUP');optionIds.add(o.id);}} for(const selection of selections){if(!selection||typeof selection.groupId!=='string'||typeof selection.optionId!=='string')fail('INVALID_SELECTION');const key=selection.groupId+':'+selection.optionId;if(chosen.has(key))fail('DUPLICATE_OPTION');chosen.set(key,selection);}
 const consumed=new Set();const snapshot=[];
 for(const group of groups){if(!Number.isSafeInteger(group.min)||!Number.isSafeInteger(group.max)||group.min<0||group.max<group.min)fail('INVALID_OPTION_GROUP');let count=0;for(const option of group.options||[]){const key=group.id+':'+option.id;if(!chosen.has(key))continue;const q=chosen.get(key).quantity??1;if(!Number.isSafeInteger(q)||q<1||q>(option.maxQuantity??1)||option.isAvailable!==true)fail('INVALID_OPTION');count+=q;total+=priceIQD(option.price,{allowZero:true})*q;consumed.add(key);snapshot.push({groupId:group.id,optionId:option.id,name:option.name,quantity:q,unitPrice:option.price});}if(count<group.min||count>group.max)fail('OPTION_LIMIT');}
 if(consumed.size!==chosen.size)fail('FOREIGN_OPTION');if(!Number.isSafeInteger(total)||total>1000000000)fail('INVALID_PRICE');return {itemId:item.id,menuVersion:item.menuVersion,name:item.name,unitPrice:item.price,options:snapshot,total};
}
function assertSubmissionAllowed(policy,typeId,regionId){const t=policy?.types?.find(t=>t.id===typeId);if(!t||t.registrationOpen!==true||!Array.isArray(t.regions)||(t.regions.length&&!t.regions.includes(regionId)))fail('REGISTRATION_CLOSED');return true;}
module.exports={assertSubmissionAllowed,ROLES,phone,person,branchDraft,eligible,permissions,authorize,delegate,priceIQD,quote};
