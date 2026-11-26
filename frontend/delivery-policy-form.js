'use strict';
// UI contract builder only. Server validation/authorization remains authoritative.
(function(root){
 const number=(v,min=0)=>{if(!/^\d+$/.test(String(v))||!Number.isSafeInteger(Number(v))||Number(v)<min)throw Error('أدخل عددًا صحيحًا صالحًا.');return Number(v);};
 const money=v=>{const n=number(v);if(!Number.isSafeInteger(n*1000))throw Error('المبلغ أكبر من الحد المسموح.');return {moneySchemaVersion:1,currency:'IQD',scale:1000,minorAmount:n*1000};};
 const date=v=>{if(typeof v!=='string'||!/\dT/.test(v))throw Error('حدد تاريخ ووقت السريان.');const n=new Date(v.endsWith('Z')?v:v+'Z');if(!Number.isFinite(n.getTime()))throw Error('تاريخ غير صالح.');return n.toISOString();};
 function build(data,scope){
  if(!scope||!scope.businessId||!scope.merchantId||!scope.id||!Number.isSafeInteger(scope.version)||scope.version<1)throw Error('أعد تحميل بيانات الفرع.');
  if(data.mode==='AGREEMENT'){
   if(!['FREE','FIXED_TARIFF'].includes(data.rule))throw Error('اختر مجاني أو رسم توصيل ثابت.');
   const allowed=new Set((scope.regions||[]).map(r=>r.id));if(!Array.isArray(data.regions)||!data.regions.length||data.regions.length>100||new Set(data.regions).size!==data.regions.length||data.regions.some(id=>!allowed.has(id)))throw Error('اختر المناطق المشمولة.');
   const effectiveFrom=date(data.from),effectiveTo=date(data.to);if(effectiveTo<=effectiveFrom)throw Error('النهاية يجب أن تكون بعد البداية.');
   let funding;if(['MERCHANT','PLATFORM'].includes(data.funder))funding={kind:data.funder};else if(data.funder==='SHARED'){const n=number(data.merchantPercent);if(n>100)throw Error('راجع نسبة المشاركة.');funding={kind:'SHARED_RATIO',merchantNumerator:n,denominator:100};}else throw Error('اختر جهة تحمّل الفرق.');
   const pct=number(data.commissionPercent);if(pct>100)throw Error('عمولة المنصة بين صفر و100%.');
   return {schemaVersion:2,id:scope.id,version:scope.version,merchantId:scope.merchantId,branchId:scope.businessId,origin:data.funder,effectiveFrom,effectiveTo,
    customerRule:data.rule==='FREE'?{kind:'FREE'}:{kind:'FIXED_TARIFF',amount:money(data.amount)},funding,eligibility:{regionIds:data.regions,minimumGoods:money(data.minimumGoods)},
    commission:{kind:'PERCENT',basis:'GOODS_GROSS',fixed:null,rate:{numerator:pct,denominator:100},rounding:'TOWARD_ZERO',finalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}}};
  }
  const customerRule={kind:data.rule};
  if(['CAPPED_PRICE','AMOUNT_OFF'].includes(data.rule))customerRule.amount=money(data.amount);
  else if(data.rule==='PERCENT_OFF'){customerRule.numerator=number(data.percent);customerRule.denominator=100;if(customerRule.numerator>100)throw Error('النسبة لا تتجاوز 100%.');customerRule.maximumDiscount=money(data.maximumDiscount);}
  else if(data.rule!=='FREE')throw Error('اختر نوع عرض التوصيل.');
  const limits={merchantPerOrder:money(data.merchantPerOrder),platformPerOrder:money(data.platformPerOrder),merchantBudget:money(data.merchantBudget),platformBudget:money(data.platformBudget),perCustomerUses:number(data.perCustomerUses,1)};
  let origin=data.funder,funding;
  if(['MERCHANT','PLATFORM'].includes(origin)){
   funding={kind:origin};const other=origin==='MERCHANT'?'platform':'merchant';
   if(limits[other+'Budget'].minorAmount||limits[other+'PerOrder'].minorAmount)throw Error('الطرف غير المموّل يجب أن تكون مساهمته صفرًا.');
  }else if(origin==='SHARED'){
   const pct=number(data.merchantPercent,1);if(pct>=100)throw Error('نسبة المطعم المشتركة بين 1 و99%.');
   funding={kind:'SHARED_RATIO',merchantNumerator:pct,denominator:100,merchantCap:limits.merchantPerOrder,platformCap:limits.platformPerOrder};
  }else if(['MERCHANT_THEN_PLATFORM','PLATFORM_THEN_MERCHANT'].includes(origin)){
   const contributor=origin.startsWith('MERCHANT')?'MERCHANT':'PLATFORM';origin='SHARED';
   const contribution=money(data.contribution);if(contribution.minorAmount>(contributor==='MERCHANT'?limits.merchantPerOrder:limits.platformPerOrder).minorAmount)throw Error('المساهمة تتجاوز سقف الطرف لكل طلب.');
   funding={kind:'CONTRIBUTION_THEN_REMAINDER',contributor,contribution,remainderCap:contributor==='MERCHANT'?limits.platformPerOrder:limits.merchantPerOrder};
  }else throw Error('اختر جهة التمويل.');
  for(const party of ['merchant','platform'])if(limits[party+'PerOrder'].minorAmount>limits[party+'Budget'].minorAmount)throw Error('ميزانية الحملة أقل من سقف الطلب.');
  const allowed=new Set((scope.regions||[]).map(r=>r.id)),regions=data.regions;
  if(!Array.isArray(regions)||!regions.length||regions.length>100||new Set(regions).size!==regions.length||regions.some(id=>!allowed.has(id)))throw Error('اختر مناطق مسماة من القائمة.');
  const effectiveFrom=date(data.from),effectiveTo=date(data.to);if(effectiveTo<=effectiveFrom)throw Error('النهاية يجب أن تكون بعد البداية.');
  if(!['ALL','NEW_CUSTOMER'].includes(data.audience)||!['ALLOW','DENY'].includes(data.stacking)||!['GOODS_GROSS','AFTER_GOODS_DISCOUNTS'].includes(data.basis))throw Error('راجع شروط أهلية العرض.');
  return {schemaVersion:1,id:scope.id,version:scope.version,merchantId:scope.merchantId,branchId:scope.businessId,origin,effectiveFrom,effectiveTo,customerRule,funding,
   eligibility:{regionIds:regions,maximumRoadMeters:number(data.maximumRoadMeters,1),minimumGoods:money(data.minimumGoods),minimumGoodsBasis:data.basis,audience:data.audience,goodsDiscountStacking:data.stacking},limits,onUnavailable:'NORMAL_TARIFF'};
 }
 const api={build};if(typeof module==='object')module.exports=api;else root.DeliveryPolicyForm=api;
})(typeof window==='object'?window:globalThis);
