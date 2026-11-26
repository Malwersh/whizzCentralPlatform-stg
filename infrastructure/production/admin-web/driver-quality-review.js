'use strict';
(() => {
  const labels = {
    OPEN: 'قيد المراجعة', APPEAL_OPEN: 'اعتراض مفتوح', RESOLVED: 'محسومة',
    VERIFICATION_PENDING: 'القرار بانتظار التحقق',
    ORDER_DAMAGE: 'تلف الأصناف', MISSING_ITEMS: 'أصناف ناقصة',
    CONDUCT: 'السلوك والتعامل', ROAD_SAFETY: 'السلامة المرورية',
    PERSONAL_SAFETY: 'سلامة الأشخاص', OTHER: 'أخرى',
    NORMAL: 'اعتيادية', HIGH: 'مرتفعة', URGENT: 'عاجلة',
    DRIVER: 'السائق', MERCHANT: 'المطعم', CUSTOMER: 'الزبون',
    PLATFORM: 'المنصة', EXTERNAL: 'جهة خارجية', SYSTEM: 'سجل النظام',
    SUBSTANTIATED: 'واقعة مثبتة', NOT_SUBSTANTIATED: 'لم تثبت مسؤولية السائق',
    PENDING_REVIEW: 'تحتاج أدلة إضافية', UPHELD: 'تأييد القرار', REVISED: 'تعديل القرار',
  };
  const errors = {
    DRIVER_QUALITY_ATTEMPT_UNAVAILABLE: 'لم تُعثر على محاولة إسناد موثقة لهذا السائق. تحقق من رقم الطلب والمحاولة.',
    INVALID_DRIVER_QUALITY_REVIEW: 'راجع البيانات المطلوبة.',
    DRIVER_QUALITY_REVIEW_CONFLICT: 'تغيّرت الحالة. حدّثها قبل تسجيل قرار جديد.',
    DRIVER_QUALITY_SOURCE_NOT_REVIEWABLE: 'تغيّر سجل الإسناد. راجع المصدر قبل الحسم.',
    INDEPENDENT_EVIDENCE_REQUIRED: 'يلزم دليلان من مصدرين مختلفين لإثبات الواقعة.',
    EXCEPTION_EVIDENCE_REQUIRED: 'اختر الأدلة التي استندت إليها.',
    DRIVER_QUALITY_APPEAL_OPEN: 'يوجد اعتراض مفتوح على هذه الحالة.',
    DRIVER_QUALITY_APPEAL_CONFLICT: 'راجع القرار الحالي وحالة الاعتراض.',
    DRIVER_QUALITY_REVIEW_LIMIT: 'بلغت هذه الحالة الحد الأقصى لسجل المراجعة.',
  };
  const el = (tag, text) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  function field(form, title, input) {
    const label = el('label', title);
    label.append(input);
    form.append(label);
    return input;
  }
  const button = (text, fn) => {
    const element = el('button', text);
    element.type = 'button';
    element.onclick = fn;
    return element;
  };
  function select(form, title, values) {
    const element = el('select');
    element.append(new Option('اختر…', ''));
    for (const value of values) element.append(new Option(labels[value], value));
    element.required = true;
    return field(form, title, element);
  }
  function textField(form,title,multiline=false) {
    const element=el(multiline?'textarea':'input');
    element.required=true;
    element.minLength=multiline?5:3;
    element.maxLength=multiline?1000:500;
    if(multiline)element.rows=3;
    return field(form,title,element);
  }
  const label = value => labels[value] || 'غير محدّد';

  function render({root, api, path, isCurrent}) {
    if (!isCurrent()) return;
    const status = el('p'), queue = el('section'), details = el('div');
    const pending = new Map();
    let busy = false, canReview = false;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    root.append(status, queue, details);

    async function request(body) {
      return api(path, body);
    }
    function message(error) {
      return errors[error.code] || error.message;
    }
    function evidenceChoices(form, review) {
      const group = el('fieldset');
      group.append(el('legend', 'الأدلة التي استندت إليها'));
      const checks = review.evidence.map(evidence => {
        const check = el('input');
        check.type = 'checkbox';
        check.value = evidence.id;
        const row=el('label');
        row.append(check, document.createTextNode(' '+label(evidence.party)+' · '+evidence.reference+' · '+evidence.note));
        group.append(row);
        return check;
      });
      form.append(group);
      return () => checks.filter(check => check.checked).map(check => check.value);
    }

    function showCase(item, canWrite) {
      details.replaceChildren();
      const summary = el('section');
      summary.className = 'review-summary';
      summary.append(el('h3', item.orderNumber), el('p', item.branchName+' · محاولة الإسناد '+item.attempt));
      details.append(summary);
      const review = item.review;
      if(review){
        summary.append(el('p',label(review.category)+' · '+label(review.severity)+' · '+label(review.state)));
        if(review.decision)summary.append(el('p',label(review.decision.value)+' · '+review.decision.reason));
        const history=el('details');
        history.className='review-history';
        history.append(el('summary','الأدلة والقرارات والاعتراضات'));
        for(const evidence of review.evidence)history.append(el('p',label(evidence.party)+' · '+evidence.reference+' · '+evidence.note));
        for(const entry of review.history)history.append(el('p',(entry.decision?label(entry.decision)+' · ':'')+entry.reason));
        for(const appeal of review.appeals)history.append(el('p',(appeal.status==='OPEN'?'اعتراض مفتوح':label(appeal.resolution))+' · '+appeal.reason));
        details.append(history);
      }
      if(item.sourceChanged){summary.append(el('p','تغيّر سجل الإسناد. راجع المصدر قبل الحسم.'));return;}
      if(!canWrite) return;
      function action(title, command, fields) {
        const box=el('details');
        box.className='review-decision';
        const form=el('form');
        const values=fields(form);
        const reason=textField(form,'سبب الإجراء',true);
        const submit=el('button',title);
        form.append(submit);
        box.append(el('summary',title),form);
        details.append(box);
        form.onsubmit=async event=>{
          event.preventDefault();
          if(busy||!isCurrent()||!form.reportValidity())return;
          const data={
            action:command,orderId:item.orderId,attempt:item.attempt,incidentId:item.incidentId,
            expectedVersion:review?.version??0,reason:reason.value.trim(),...values(),
            ...(review?{caseId:review.caseId}:{}),
          };
          const fingerprint=JSON.stringify(data);
          if(!pending.has(fingerprint))pending.set(fingerprint,crypto.randomUUID());
          data.idempotencyKey=pending.get(fingerprint);
          busy=true;
          submit.disabled=true;
          status.textContent='جارٍ حفظ الإجراء…';
          try{
            await request(data);
            pending.delete(fingerprint);
            if(!isCurrent())return;
            try{
              await refreshList();
              await refreshCase(item.orderId,item.attempt,item.incidentId);
              if(isCurrent())status.textContent='تم حفظ الإجراء.';
            }catch{
              if(isCurrent())status.textContent='تم حفظ الإجراء. حدّث الحالات لعرض النتيجة.';
            }
          }catch(error){if(isCurrent())status.textContent=message(error);}
          finally{busy=false;submit.disabled=false;}
        };
      }
      if(!review){
        if(item.reviewable)action('فتح حالة جودة أو سلامة','OPEN_DRIVER_QUALITY_REVIEW',form=>{
          const category=select(form,'نوع الحالة',['ORDER_DAMAGE','MISSING_ITEMS','CONDUCT','ROAD_SAFETY','PERSONAL_SAFETY','OTHER']);
          const severity=select(form,'درجة الخطورة',['NORMAL','HIGH','URGENT']);
          return ()=>({category:category.value,severity:severity.value});
        });
        return;
      }
      action('إضافة دليل أو إفادة','ADD_DRIVER_QUALITY_EVIDENCE',form=>{
        const party=select(form,'مصدر الإفادة',['DRIVER','MERCHANT','CUSTOMER','PLATFORM','EXTERNAL','SYSTEM']);
        const reference=textField(form,'مرجع الإفادة');
        return ()=>({reportedByParty:party.value,reference:reference.value.trim()});
      });
      action('تسجيل قرار المراجعة','DECIDE_DRIVER_QUALITY_REVIEW',form=>{
        const decision=select(form,'القرار',['PENDING_REVIEW','NOT_SUBSTANTIATED','SUBSTANTIATED']);
        const evidence=evidenceChoices(form,review);
        form.append(el('p','إثبات الواقعة يتطلب أدلة من مصدرين مختلفين.'));
        return ()=>({decision:decision.value,evidenceIds:evidence(),supersedesDecisionId:review.decision?.id??null});
      });
      const appeal=review.appeals.find(entry=>entry.status==='OPEN');
      if(!appeal && review.decision && review.decision.value!=='PENDING_REVIEW'){
        action('تسجيل اعتراض مستلم','OPEN_DRIVER_QUALITY_APPEAL',form=>{
          const reference=textField(form,'مرجع الاعتراض');
          return ()=>({reference:reference.value.trim()});
        });
      }
      if(appeal)action('حسم الاعتراض','CLOSE_DRIVER_QUALITY_APPEAL',form=>{
        const resolution=select(form,'نتيجة الاعتراض',['UPHELD','REVISED']);
        const evidence=evidenceChoices(form,review);
        form.append(el('p','لتعديل القرار، سجّل القرار الجديد أولًا ثم احسم الاعتراض.'));
        return ()=>({appealId:appeal.id,resolution:resolution.value,evidenceIds:evidence()});
      });
    }
    async function refreshCase(orderId,attempt,incidentId) {
      const data=await request({action:'READ_DRIVER_QUALITY_REVIEW',orderId,attempt,incidentId});
      if(isCurrent())showCase(data.item,data.capabilities?.review===true);
    }
    async function openCase(orderId,attempt,incidentId){
      if(busy||!isCurrent())return;
      busy=true;
      details.replaceChildren();
      status.textContent='جارٍ تحميل الحالة…';
      try{await refreshCase(orderId,attempt,incidentId);if(isCurrent())status.textContent='';}
      catch(error){if(isCurrent())status.textContent=message(error);}
      finally{busy=false;}
    }
    async function refreshList() {
      const data=await request();
      if(!isCurrent())return;
      canReview=data.capabilities?.review===true;
      queue.replaceChildren(el('h3','الحالات والاعتراضات'),button('تحديث الحالات',load));
      const entries=[...data.items].sort((a,b)=>Number(b.appealOpen)-Number(a.appealOpen));
      for(const item of entries){
        const card=el('article');
        card.className='review-summary';
        card.append(el('strong',item.orderNumber),el('p',label(item.category)+' · '+label(item.state)),
          button(item.appealOpen?'مراجعة الاعتراض':'عرض الحالة',()=>openCase(item.orderId,item.attempt,item.incidentId)));
        queue.append(card);
      }
      if(!entries.length&&data.coverageComplete)queue.append(el('p','لا توجد حالات جودة أو اعتراضات مسجّلة لهذا السائق.'));
      if(!data.coverageComplete)queue.append(el('p',canReview
        ?'السجل المعروض جزئي. ابحث برقم الطلب للتحقق من محاولة إسناد محددة.'
        :'السجل المعروض جزئي.'));
      if(canReview){
        const lookup=el('details'),form=el('form');
        lookup.className='review-decision';
        const order=field(form,'رقم الطلب',el('input'));
        order.required=true;
        order.maxLength=150;
        const attempt=field(form,'محاولة الإسناد',el('input'));
        Object.assign(attempt,{type:'number',min:'1',max:'999',value:'1',required:true});
        form.append(el('button','عرض محاولة الإسناد'));
        form.onsubmit=event=>{
          event.preventDefault();
          if(!form.reportValidity())return;
          const reference=order.value.trim(),number=Number(attempt.value);
          const existing=entries.find(item=>(item.orderNumber===reference||item.orderId===reference)&&item.attempt===number);
          openCase(reference,number,existing?.incidentId||crypto.randomUUID());
        };
        lookup.append(el('summary','فتح حالة حسب رقم الطلب'),form);
        queue.append(lookup);
      }
    }
    async function load(){
      if(busy||!isCurrent())return;
      busy=true;
      status.textContent='جارٍ تحميل حالات الجودة والسلامة…';
      try{await refreshList();if(isCurrent())status.textContent='';}
      catch(error){
        if(!isCurrent())return;
        status.textContent=message(error);
        queue.replaceChildren(button('إعادة المحاولة',load));
      }finally{busy=false;}
    }
    load();
  }
  window.WizzDriverQuality=Object.freeze({render});
})();
