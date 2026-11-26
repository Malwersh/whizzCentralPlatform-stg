'use strict';
window.FinancePeriodLabel=period=>{
 if(period?.kind==='MERCHANT_OFF_CYCLE_PERIOD'){
  const time=v=>new Date(v).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'});
  return 'كشف استثنائي خارج الدورة · من '+time(period.fromUtc)+' حتى '+time(period.untilExclusiveUtc)+' (وقت النهاية غير مشمول) · بتوقيت العراق';
 }
 return (period?.kind==='MERCHANT_OPENING_PERIOD'?'كشف افتتاحي · ':'كشف دوري · ')+(period?.startLocalDate||'')+' إلى '+(period?.endExclusiveLocalDate||'')+' · النهاية غير مشمولة · بتوقيت العراق';
};
