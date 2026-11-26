'use strict';

(() => {
  const labels = {
    OPEN: 'قيد المراجعة', RESOLVED: 'محسومة', APPEAL_OPEN: 'اعتراض مفتوح',
    COUNT_LATE: 'احتساب التأخير', EXCUSED: 'استبعاد التأخير بعذر',
    KEEP: 'احتساب التقييم الأصلي', EXCLUDE: 'استبعاد التقييم من المتوسط',
    PENDING_REVIEW: 'تحتاج أدلة إضافية', UPHELD: 'تأييد القرار', REVISED: 'تعديل القرار',
    DRIVER: 'السائق', CUSTOMER: 'الزبون', MERCHANT: 'المطعم',
    PLATFORM: 'المنصة', EXTERNAL: 'جهة خارجية', SYSTEM: 'سجل النظام',
    PICKUP_DELAY_REQUIRES_REVIEW: 'تأخر الاستلام ويحتاج سبب الانتظار إلى مراجعة.',
    STORE_ARRIVAL_AFTER_TARGET: 'وصل السائق إلى المطعم بعد الموعد الأصلي وفترة السماح.',
    CUSTOMER_ARRIVAL_AFTER_TARGET: 'وصل السائق إلى الزبون بعد الموعد الأصلي وفترة السماح.',
    WITHIN_ORIGINAL_TARGETS: 'أُكد الوصول ضمن المواعيد الأصلية.',
    ORIGINAL_TARGET_UNAVAILABLE: 'لا توجد مواعيد أصلية محفوظة لهذه الرحلة.',
    SERVER_EVENTS_INCOMPLETE: 'سجل أوقات مراحل التوصيل غير مكتمل.',
  };
  const errors = {
    DRIVER_TIMING_ATTEMPT_UNAVAILABLE: 'لا توجد رحلة مكتملة بهذه المحاولة لهذا السائق. تحقق من رقم الطلب والمحاولة.',
    DRIVER_RATING_SOURCE_UNAVAILABLE: 'لا يوجد تقييم موثّق مطابق لهذا الطلب ضمن ملف السائق.',
    DRIVER_RATING_AGGREGATE_UNVERIFIED: 'أوقف الحفظ لأن متوسط السائق يحتاج إلى مطابقة مع سجل التقييمات.',
    DRIVER_TIMING_REVIEW_CONFLICT: 'تغيّرت المراجعة. اعرض الحالة من جديد قبل تسجيل القرار.',
    DRIVER_RATING_REVIEW_CONFLICT: 'تغيّرت المراجعة. اعرض الحالة من جديد قبل تسجيل القرار.',
    INDEPENDENT_EVIDENCE_REQUIRED: 'يلزم دليلان من مصدرين مختلفين لاتخاذ هذا القرار.',
    EXCEPTION_EVIDENCE_REQUIRED: 'اختر الأدلة المحفوظة التي استندت إليها.',
    DRIVER_TIMING_APPEAL_OPEN: 'حسم الاعتراض المفتوح مطلوب قبل تأكيد احتساب التأخير.',
    DRIVER_TIMING_APPEAL_CONFLICT: 'راجع القرار الحالي والاعتراض قبل تسجيل هذه النتيجة.',
    DRIVER_RATING_APPEAL_CONFLICT: 'راجع القرار الحالي والاعتراض قبل تسجيل هذه النتيجة.',
  };
  const parties = ['DRIVER','CUSTOMER','MERCHANT','PLATFORM','EXTERNAL','SYSTEM'];
  const dateFormat = new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'});
  const date = value => Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) : 'غير متاح';
  const el = (tag,text) => {
    const node = document.createElement(tag);
    if(text !== undefined) node.textContent = text;
    return node;
  };
  function field(form,title,input) {
    const label = el('label',title);
    label.append(input);
    form.append(label);
    input.required = true;
    return input;
  }
  function select(form,title,choices) {
    const input = el('select');
    input.append(new Option('اختر…',''));
    for(const value of choices) input.append(new Option(labels[value],value));
    return field(form,title,input);
  }
  function evidenceChoices(form,evidence) {
    const group=el('fieldset');
    group.append(el('legend','الأدلة التي استندت إليها'));
    const checks=evidence.map(entry=>{
      const checkbox=el('input');
      checkbox.type='checkbox';
      const label=el('label',' '+labels[entry.party]+' · '+entry.reference+' · '+entry.note);
      label.prepend(checkbox);
      group.append(label);
      return {checkbox,id:entry.id};
    });
    form.append(group);
    return ()=>checks.filter(({checkbox})=>checkbox.checked).map(({id})=>id);
  }

  function view({root,api,path,isCurrent},type,title) {
    const timing=type==='TIMING';
    const lookup=el('form'), result=el('div'), status=el('p'), panel=el('details');
    panel.className='review-decision';
    const order=field(lookup,'رقم الطلب',el('input'));
    order.maxLength=150;
    const attempt=timing?field(lookup,'محاولة الإسناد',el('input')):null;
    if(attempt)Object.assign(attempt,{type:'number',min:'1',max:'999',value:'1'});
    const fetchCase=el('button','عرض المراجعة');
    lookup.append(fetchCase);
    status.setAttribute('role','status');
    panel.append(el('summary',title),lookup,status,result);
    root.append(panel);

    const requests=new Map();
    let busy=false;
    async function load(reference) {
      const data=await api(path,{action:'READ_DRIVER_'+type+'_REVIEW',...reference});
      if(isCurrent()) render(data.item,data.capabilities?.review===true);
    }
    lookup.onsubmit=async event=>{
      event.preventDefault();
      if(busy||!isCurrent())return;
      busy=true;
      fetchCase.disabled=true;
      result.replaceChildren();
      status.textContent='جارٍ تحميل المراجعة…';
      try {
        await load({orderId:order.value.trim(),...(attempt?{attempt:Number(attempt.value)}:{})});
        if(isCurrent())status.textContent='';
      }catch(error){if(isCurrent())status.textContent=errors[error.code]||error.message;}
      finally{busy=false;fetchCase.disabled=false;}
    };

    function render(item,canReview) {
      result.replaceChildren();
      const summary=el('section');
      summary.className='review-summary';
      summary.append(el('h4',item.orderNumber),el('p',item.branchName));
      result.append(summary);
      if(timing){
        summary.append(el('p',labels[item.observation?.reason]||'لا توجد ملاحظة تأخير قابلة للمراجعة.'));
        if(item.targets)summary.append(el('p','الموعد الأصلي للمطعم '+date(item.targets.pickupTargetAt)+' · الموعد الأصلي للزبون '+date(item.targets.customerTargetAt)));
      } else if(item.rating){
        summary.append(el('p','التقييم الأصلي '+item.rating.stars+' من ٥ · '+date(item.rating.createdAt)));
        if(item.rating.comment)summary.append(el('p',item.rating.comment));
        summary.append(el('p',item.rating.included?'يُحتسب في متوسط السائق.':'مستبعد من متوسط السائق.'));
      }else summary.append(el('p','لا يوجد تقييم للسائق على هذا الطلب.'));
      const review=item.review;
      if(review){
        summary.append(el('p',labels[review.state]));
        if(review.decision)summary.append(el('p',labels[review.decision.value]+' · '+review.decision.reason));
        const history=el('details');
        history.className='review-history';
        history.append(el('summary','الأدلة والقرارات والاعتراضات'));
        for(const entry of review.evidence)history.append(el('p',labels[entry.party]+' · '+entry.reference+' · '+entry.note));
        for(const entry of review.history)history.append(el('p',date(entry.createdAt)+' · '+entry.reason));
        for(const entry of review.appeals)history.append(el('p',(entry.status==='OPEN'?labels.APPEAL_OPEN:labels[entry.resolution])+' · '+entry.reason));
        result.append(history);
      }
      if(item.sourceChanged){summary.append(el('p','تغيّرت بيانات الرحلة الأصلية. يلزم مراجعة المصدر قبل الحسم.'));return;}
      if(!canReview) return;
      const reference={orderId:item.orderId,...(timing?{attempt:item.attempt}:{})};
      function action(title,command,fields=()=>()=>({})) {
        const box=el('details'), form=el('form'), submit=el('button',title);
        box.className='review-decision';
        const values=fields(form);
        const reason=field(form,'سبب الإجراء',el('textarea'));
        Object.assign(reason,{rows:3,minLength:5,maxLength:1000});
        form.append(submit);
        box.append(el('summary',title),form);
        result.append(box);
        form.onsubmit=async event=>{
          event.preventDefault();
          if(busy||!isCurrent())return;
          const body={action:command,...reference,reason:reason.value.trim(),expectedVersion:review?.version??0,
            ...(review?{caseId:review.caseId}:{}),...values()};
          const key=JSON.stringify(body);
          if(!requests.has(key))requests.set(key,crypto.randomUUID());
          body.idempotencyKey=requests.get(key);
          busy=true;
          submit.disabled=true;
          status.textContent='جارٍ حفظ الإجراء…';
          try{
            await api(path,body);
            requests.delete(key);
            if(!isCurrent())return;
            try{await load(reference);if(isCurrent())status.textContent='تم حفظ الإجراء.';}
            catch{if(isCurrent())status.textContent='تم حفظ الإجراء. اعرض المراجعة من جديد لتحديث النتيجة.';}
          }catch(error){if(isCurrent())status.textContent=errors[error.code]||error.message;}
          finally{busy=false;submit.disabled=false;}
        };
      }
      if(!review){
        if(item.reviewable)action('فتح مراجعة','OPEN_DRIVER_'+type+'_REVIEW',form=>{
          if(!timing)form.append(el('p','يُستبعد التقييم من المتوسط أثناء المراجعة، ويُحفظ تقييم الزبون الأصلي.'));
          return ()=>({});
        });
        return;
      }
      action('إضافة دليل أو إفادة','ADD_DRIVER_'+type+'_EVIDENCE',form=>{
        const party=select(form,'مصدر الإفادة',parties);
        const ref=field(form,'مرجع الإفادة',el('input'));
        Object.assign(ref,{minLength:3,maxLength:500});
        return ()=>({reportedByParty:party.value,reference:ref.value.trim()});
      });
      action('تسجيل قرار المراجعة','DECIDE_DRIVER_'+type+'_REVIEW',form=>{
        const decision=select(form,'القرار',timing?['PENDING_REVIEW','EXCUSED','COUNT_LATE']:['PENDING_REVIEW','EXCLUDE','KEEP']);
        const evidence=evidenceChoices(form,review.evidence);
        return ()=>({decision:decision.value,evidenceIds:evidence(),supersedesDecisionId:review.decision?.id??null});
      });
      const appeal=review.appeals.find(entry=>entry.status==='OPEN');
      if(!appeal&&review.decision&&review.decision.value!=='PENDING_REVIEW'){
        action('تسجيل اعتراض مستلم','OPEN_DRIVER_'+type+'_APPEAL',form=>{
          const party=timing?null:select(form,'صاحب الاعتراض',['DRIVER','CUSTOMER']);
          const ref=field(form,'مرجع الاعتراض',el('input'));
          Object.assign(ref,{minLength:3,maxLength:500});
          return ()=>({reference:ref.value.trim(),...(party?{reportedByParty:party.value}:{})});
        });
      }
      if(appeal)action('حسم الاعتراض','CLOSE_DRIVER_'+type+'_APPEAL',form=>{
        const resolution=select(form,'النتيجة',['UPHELD','REVISED']);
        const evidence=evidenceChoices(form,review.evidence);
        form.append(el('p','لتعديل النتيجة، سجّل القرار الجديد أولًا ثم احسم الاعتراض.'));
        return ()=>({appealId:appeal.id,resolution:resolution.value,evidenceIds:evidence()});
      });
    }
  }
  window.WizzDriverPerformanceReview={render(options){
    options.root.append(el('h3','مراجعات الأداء'));
    view(options,'TIMING','مراجعة التأخير');
    view(options,'RATING','مراجعة تقييم الزبون');
  }};
})();
