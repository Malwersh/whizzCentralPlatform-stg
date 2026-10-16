const assert=require('node:assert/strict');
const {createStagingCommercialSource:create}=require('../../dist/orderCommercialSource');
const {quoteHash}=require('../../dist/deliveryQuoteRecord');
const {parseIqd:m}=require('../../dist/money');
const at='2026-10-15T12:00:00.000Z';
const zero=()=>({kind:'NONE',basis:null,fixed:null,rate:null,rounding:'EXACT'});
function fixture(merchantId='org',ownerId='owner'){
 const records=new Map(),put=(t,key,row)=>records.set(t+'|'+JSON.stringify(key),{...key,...row});
 const branch={businessId:'b1',ownerId,cognitoUserId:ownerId,organizationId:merchantId,status:'approved',isActive:true,
  commercialAgreementId:'a1',commercialAgreementVersion:1,regionPath:['country','gov','city','zone']};
 put('WhizzMerchants_Businesses',{businessId:'b1'},branch);
 put('staging-MerchantPlatform',{pk:'PERSON#'+ownerId,sk:'ORGANIZATION#'+merchantId},{organizationId:merchantId,subjectId:ownerId,version:1});
 const terms={id:'a1',version:1,status:'ACTIVE',merchantId,branchId:'b1',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:null,
  acceptedAt:'2026-10-01T00:00:00.000Z',approvedAt:'2026-10-01T00:00:00.000Z',commission:zero(),serviceFee:{kind:'FIXED',basis:null,fixed:m('500'),rate:null,rounding:'EXACT'}};
 const payload={terms,otherCharges:{merchant:m('0'),platform:m('0'),thirdParty:m('0')},allowedFundingPolicyIds:['fp1']};
 const termsHash=quoteHash(payload),record={schemaVersion:1,...payload,termsHash};
 put('staging-MerchantPlatform',{pk:'COMMERCIAL_AGREEMENT#a1',sk:'VERSION#1'},record);
 put('staging-MerchantPlatform',{pk:'COMMERCIAL_AGREEMENT#a1',sk:'CURRENT'},{version:1,termsHash,status:'ACTIVE'});
 put('staging-MerchantPlatform',{pk:'COMMERCIAL_AGREEMENT#a1',sk:'ACCEPTANCE#1'},{subjectId:ownerId,termsHash,acceptedAt:terms.acceptedAt,status:'ACCEPTED'});
 put('staging-PlatformStaff',{pk:'COMMERCIAL_AGREEMENT#a1',sk:'APPROVAL#1'},{staffId:'staff1',termsHash,approvedAt:terms.approvedAt,status:'APPROVED'});
 put('WhizzMerchants_Products',{productId:'p1'},{businessId:'b1',name:'Test',categoryId:'cat1',price:3500,isAvailable:true});
 put('WhizzMerchants_Categories',{categoryId:'cat1'},{isActive:true});
 for(const [regionId,parent_id,level] of [['zone','city',3],['city','gov',2],['gov','country',1]])put('WizzCentral_Regions',{regionId},{parent_id,level,is_active:1});
 put('staging-PlatformStaff',{pk:'DISCOUNT_FUNDING#fp1',sk:'CURRENT'},{schemaVersion:1,id:'fp1',version:1,status:'ACTIVE',campaignId:'d1',campaignVersion:1,
  source:'MERCHANT',merchantId,branchId:'b1',target:'GOODS',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:'2026-11-01T00:00:00.000Z',
  merchantNumerator:1,denominator:2,rounding:'MERCHANT_TOWARD_ZERO_PLATFORM_REMAINDER',approvedBy:'staff',approvedAt:'2026-10-01T00:00:00.000Z'});
 put('staging-Wallets',{walletId:'WALLET#PLATFORM',sk:'META'},{ownerType:'PLATFORM',ownerId:'platform',currency:'IQD',status:'ACTIVE',availableBalance:10000,lockedBalance:0,version:1});
 const input={orderId:'o1',branchId:'b1',items:[{productId:'p1',quantity:1}],quote:{createdAt:at,expiresAt:'2026-10-15T12:02:00.000Z',deliveryFeeMinor:1000000,
  origin:{latitude:31.92,longitude:44.45},destination:{latitude:31.93,longitude:44.46},destinationRegionId:'zone'},tip:m('0'),discount:null};
 const calls=[],db={async send(c){calls.push(c);assert.equal(c.input.ConsistentRead,true);return {Item:structuredClone(records.get(c.input.TableName+'|'+JSON.stringify(c.input.Key)))};}};
 const change=(t,k)=>records.get(t+'|'+JSON.stringify(k));
 const funded=()=>{input.discount={snapshot:{discountId:'d1',version:1,source:'MERCHANT',target:'GOODS',amount:1000000},campaign:{discountId:'d1',version:1,fundingPolicyId:'fp1',fundingPolicyVersion:1}};return input;};
 return {records,put,change,input,calls,funded,prepare:()=>create({db,now:()=>Date.parse(at)+1000}).prepare(input)};
}
module.exports={fixture};
