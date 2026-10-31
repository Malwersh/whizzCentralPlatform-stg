(function(global){
'use strict';
let context=null,caseId=null,host=null,draft=false;
const reasonNames={VehicleIssue:'مشكلة في السيارة',Emergency:'حالة طارئة',TooFar:'مسافة بعيدة',TrafficJam:'ازدحام',Other:'سبب آخر'};
const labels={COUNT_FAILURE:'عدم إكمال يُحتسب',EXCUSED:'استثناء معذور — لا يخفض الإكمال',PENDING_REVIEW:'قيد المراجعة — لا يخفض الإكمال مؤقتًا'};
function node(tag,text){const e=document.createElement(tag);if(text)e.textContent=text;return e;}
function field(label,input){const l=node('label',label);l.append(input);return l;}
function render(item,events,options){
 context={item,events,options};host=document.getElementById('driver-performance-case');
 if(!host){host=node('fieldset');host.id='driver-performance-case';document.getElementById('case-detail').append(host);}
 host.className='workflow-card';host.style.scrollMarginTop='24px';
 const next=document.getElementById('case-next-step');if(next)next.after(host);
 host.hidden=false;
 if(!options.canOperate||!(item.performanceAssignments||[]).length){caseId=null;host.replaceChildren(node('legend','أثر الحالة على أداء السائق'),node('p',!options.canOperate?'عرض فقط؛ تسجيل قرار الأداء يحتاج صلاحية إدارة الطلبات أو اعتماد المالية.':'لم تصل محاولة إسناد قابلة للمراجعة ضمن تفاصيل القضية. حدّث الحالة؛ لا يمكن تسجيل قرار على محاولة غير موثقة.'));return;}

 if(caseId!==item.caseId){caseId=item.caseId;draft=false;host.replaceChildren();host.append(node('legend','أثر الحالة على أداء السائق'),node('p','قرار الأداء مستقل عن التعويض. اختر محاولة الإسناد، وحدد الأثر مع الأدلة. لا تعني عدم استحقاق التعويض أن السائق مسؤول.'));
  const attempts=node('select');attempts.id='performance-attempt';host.append(field('محاولة الإسناد',attempts));
  const summary=node('p');summary.id='performance-current';host.append(summary);
  const decision=node('select');decision.id='performance-decision';decision.append(new Option('اختر أثر الحالة',''));for(const [value,label]of Object.entries(labels))decision.append(new Option(label,value));host.append(field('أثر الحالة',decision));
  const evidence=node('div');evidence.id='performance-evidence';host.append(node('p','أدلة القرار؛ احتساب عدم الإكمال يحتاج مصدرين مستقلين على الأقل.'),evidence);
  const reason=node('textarea');reason.id='performance-reason';reason.maxLength=2000;reason.rows=3;host.append(field('تعليل القرار',reason));
  const button=node('button','حفظ قرار الأداء');button.type='button';button.id='save-driver-performance';host.append(button);const feedback=node('p');feedback.id='performance-feedback';feedback.setAttribute('role','status');host.append(feedback);
  host.addEventListener('input',()=>draft=true);host.addEventListener('change',()=>draft=true);
  attempts.onchange=()=>{const selected=context.item.performanceAssignments[Number(attempts.value)],prior=(context.item.driverPerformanceDecisions||[]).find(d=>d.driverId===selected?.driverId&&d.attempt===selected?.attempt);summary.textContent=(selected?.reportedReason?'السبب المبلغ عنه: '+(reasonNames[selected.reportedReason]||'سبب مسجل')+' — ':'')+(prior?'القرار الحالي: '+labels[prior.decision]+' — '+prior.reason:'لا يوجد قرار أداء؛ تبقى الحالة للمراجعة.');decision.value='';};
  button.onclick=async()=>{
   const c=context,target=c.item.performanceAssignments[Number(attempts.value)],value=decision.value,note=reason.value.trim(),evidenceIds=[...evidence.querySelectorAll('input:checked')].map(e=>e.value);
   if(!target||!value||note.length<5||value!=='PENDING_REVIEW'&&!evidenceIds.length){feedback.textContent='اختر المحاولة والأثر، واكتب التعليل وحدد الأدلة.';return;}
   const prior=(c.item.driverPerformanceDecisions||[]).find(d=>d.driverId===target.driverId&&d.attempt===target.attempt);
   button.disabled=true;feedback.textContent='جارٍ حفظ القرار…';
   const success=await c.options.submit('SET_DRIVER_PERFORMANCE',{offerId:target.offerId,attempt:target.attempt,decision:value,evidenceIds,reason:note,supersedesDecisionId:prior?.decisionId??null});
   if(context.item.caseId!==c.item.caseId)return;
   if(success){draft=false;reason.value='';decision.value='';feedback.textContent='حُفظ أثر الحالة على الأداء. لم يتغير التعويض أو الرصيد.';}else feedback.textContent='تعذر حفظ القرار. راجع الأدلة والصلاحية وحدّث الحالة عند التعارض.';
   button.disabled=false;
  };
 }
 const attempts=host.querySelector('#performance-attempt'),old=attempts.value;attempts.replaceChildren();
 for(const [index,a]of item.performanceAssignments.entries())attempts.append(new Option('المحاولة '+a.attempt+(a.outcome==='UNASSIGNED'?' — فُك إسناد السائق':' — انتهت المهمة'),String(index)));
 if([...attempts.options].some(o=>o.value===old))attempts.value=old;
 const selected=item.performanceAssignments[Number(attempts.value)],prior=(item.driverPerformanceDecisions||[]).find(d=>d.driverId===selected?.driverId&&d.attempt===selected?.attempt);
 host.querySelector('#performance-current').textContent=(selected?.reportedReason?'السبب المبلغ عنه: '+(reasonNames[selected.reportedReason]||'سبب مسجل')+' — ':'')+(prior?'القرار الحالي: '+labels[prior.decision]+' — '+prior.reason:'لا يوجد قرار أداء؛ تبقى الحالة للمراجعة.');
 const evidence=host.querySelector('#performance-evidence'),checked=new Set([...evidence.querySelectorAll('input:checked')].map(e=>e.value));evidence.replaceChildren();
 for(const [index,id]of (item.evidenceIds||[]).entries()){const event=events.find(e=>e.evidenceId===id),checkbox=node('input');checkbox.type='checkbox';checkbox.value=id;checkbox.checked=checked.has(id);evidence.append(field('دليل '+(index+1)+' — '+(event?.proof?.note||event?.reason||'إفادة مسجلة في القضية'),checkbox));}
}
global.WizzDriverPerformanceCase={render,hasDraft:()=>draft};
})(window);
