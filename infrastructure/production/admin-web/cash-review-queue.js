(() => {
  'use strict';
  const get=id=>document.getElementById(id);
  const list=get('cash-queue-items');
  const more=get('cash-queue-more');
  const reload=get('cash-queue-reload');
  const status=get('cash-queue-status');
  let cursor=null,busy=false;
  const labels={REVIEW_REQUIRED:'بانتظار المراجعة',AWAITING_CUSTOMER_PAYMENT:'بانتظار تحصيل الفرق',INDEX_REVIEW:'تحتاج مطابقة السجل'};
  async function load(append=false) {
    if(busy)return;
    busy=true;
    more.disabled=reload.disabled=true;
    status.textContent='جارٍ تحميل المراجعات…';
    try {
      await window.Auth.ensureSession();
      const token=window.Auth.getToken('accessToken');
      const suffix=append&&cursor?'?'+new URLSearchParams({cursor}):'';
      const response=await fetch('/staff/cash-reviews'+suffix,{headers:{Authorization:'Bearer '+token}});
      const data=await response.json();
      if(response.status===401||response.status===403) throw Error('يلزم حساب مخوّل بقراءة الشؤون المالية.');
      if(!response.ok||!Array.isArray(data.items)) throw Error('تعذّر تحميل المراجعات. حاول مرة أخرى.');
      if(!append)list.replaceChildren();
      for(const item of data.items) {
        const row=document.createElement('li');
        const text=document.createElement('span');
        text.textContent=(item.orderNumber||item.orderId)+(item.branchName?' · '+item.branchName:'');
        const open=document.createElement('button');
        open.type='button';
        open.textContent='عرض المراجعة';
        open.onclick=()=>{
          get('order').value=item.orderNumber||item.orderId;
          get('lookup').requestSubmit();
        };
        const state=document.createElement('small');
        state.textContent=labels[item.status]||'تحتاج مراجعة';
        row.append(text,state,open);
        list.append(row);
      }
      cursor=data.nextCursor||null;
      more.hidden=!cursor;
      status.textContent=list.childElementCount?'':cursor?'يمكن تحميل نتائج إضافية.':'لا توجد مراجعات نقدية مفتوحة.';
    } catch(error) {
      status.textContent=error.message;
    } finally {
      busy=false;
      more.disabled=reload.disabled=false;
    }
  }
  reload.onclick=()=>load();
  more.onclick=()=>load(true);
  load();
})();
