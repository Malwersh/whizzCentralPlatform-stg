'use strict';
// Named multi-selection over the same authoritative region records used by Regions.
(()=>{
 let cached=null,pending=null;
 const id=r=>r.regionId||r.id;
 const active=v=>v===true||v===1||v==='true'||v==='1';
 async function regions(force=false){
  if(pending)return pending;if(cached&&!force)return cached;
  pending=(async()=>{await window.Auth.ensureSession();const [base,derived]=await Promise.all([window.AWSUtils.scanAll('WizzCentral_Regions'),window.AWSUtils.scanAll('WizzCentral_RegionsDerived_staging')]);
   const extra=new Map(derived.map(r=>[id(r),r]));const rows=base.map(r=>({...r,...extra.get(id(r))}));const lookup=new Map(rows.map(r=>[id(r),r]));
   const name=r=>r.name_ar||r.name||r.name_en||'منطقة دون اسم';
   cached=rows.filter(r=>id(r)&&Number(r.level)>=3).map(r=>{const parts=[name(r)],seen=new Set([id(r)]);let parent=lookup.get(r.parent_id);while(parent&&!seen.has(id(parent))){seen.add(id(parent));parts.unshift(name(parent));parent=lookup.get(parent.parent_id);}
    const enabled=active(r.effective_is_active??r.effective?.isActive??r.is_active)&&r.effective_config?.delivery!==false;
    return {id:id(r),name:name(r),path:parts.join(' / '),enabled};}).sort((a,b)=>a.path.localeCompare(b.path,'ar'));return cached;
  })();try{return await pending;}finally{pending=null;}
 }
 class PricingRegionPicker{
  constructor(input,selected=[]){this.input=input;this.selected=new Set(selected);this.initial=[...selected];this.rows=[];this.loaded=false;this.loading=false;
   const oldLabel=input.parentElement,group=document.createElement('div'),title=document.createElement('span');group.className='pricing-region-field';title.textContent='مناطق التوصيل';oldLabel.replaceWith(group);group.append(title,input);input.type='hidden';this.host=document.createElement('div');this.host.className='pricing-region-picker';input.after(this.host);
   this.search=document.createElement('input');this.search.type='search';this.search.placeholder='ابحث باسم المنطقة أو القضاء أو المحافظة';this.search.setAttribute('aria-label','البحث في مناطق التوصيل');
   this.status=document.createElement('p');this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
   this.selectedHost=document.createElement('div');this.selectedHost.className='pricing-region-selected';this.selectedHost.setAttribute('aria-label','مناطق التوصيل المختارة');
   this.list=document.createElement('div');this.list.className='pricing-region-list';this.list.setAttribute('role','group');this.list.setAttribute('aria-label','اختيار مناطق التوصيل');
   this.retry=document.createElement('button');this.retry.type='button';this.retry.textContent='إعادة تحميل المناطق';this.retry.onclick=()=>this.load(true);
   const help=document.createElement('small');help.textContent='اختر مناطق التوصيل المحلية بالاسم. تظهر المناطق الفعّالة فقط للاختيار الجديد. تحديد منطقة هنا لا يفعّل منطقة متوقفة ولا يغيّر حدودها.';
   this.host.append(this.search,help,this.status,this.selectedHost,this.list,this.retry);this.search.oninput=()=>this.render();this.sync();this.load();
  }
  sync(){this.input.value=[...this.selected].join(',');}
  async load(force=false){if(this.loading)return;this.loading=true;this.search.disabled=true;this.retry.disabled=true;this.status.textContent='جارٍ تحميل أسماء المناطق…';
   try{this.rows=await regions(force);this.loaded=true;if(this.host.isConnected)this.render();}
   catch(_){this.loaded=false;this.list.replaceChildren();this.status.textContent='تعذر تحميل المناطق. اختياراتك السابقة محفوظة؛ أعد المحاولة لتغييرها.';this.renderSelected();}
   finally{this.loading=false;this.search.disabled=!this.loaded;this.retry.disabled=false;}
  }
  toggle(region,checked){if(checked&&!region.enabled)return;if(checked)this.selected.add(region.id);else this.selected.delete(region.id);this.sync();this.render();}
  renderSelected(){this.selectedHost.replaceChildren();for(const selected of this.selected){const row=this.rows.find(r=>r.id===selected);const chip=document.createElement('span');chip.className='pricing-region-chip';const text=document.createElement('span');text.textContent=row?row.path+(row.enabled?'':' — غير متاحة للاختيار الجديد'):'منطقة محفوظة غير متاحة في القائمة';const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','إزالة '+(row?.name||'المنطقة المحفوظة'));remove.onclick=()=>{this.selected.delete(selected);this.sync();this.render();};chip.append(text,remove);this.selectedHost.append(chip);}}
  render(){this.sync();this.renderSelected();this.list.replaceChildren();if(!this.loaded)return;
   const q=this.search.value.trim().toLocaleLowerCase('ar');const available=this.rows.filter(r=>r.enabled||this.selected.has(r.id));const matches=available.filter(r=>r.path.toLocaleLowerCase('ar').includes(q));
   this.status.textContent='المناطق المختارة: '+new Intl.NumberFormat('ar-IQ').format(this.selected.size)+' — نتائج البحث: '+new Intl.NumberFormat('ar-IQ').format(matches.length);
   if(!matches.length){const empty=document.createElement('p');empty.textContent=q?'لا توجد مناطق تطابق البحث. اختياراتك محفوظة أعلاه.':'لا توجد مناطق فعّالة متاحة للاختيار.';this.list.append(empty);}
   for(const region of matches){const label=document.createElement('label');label.className='pricing-region-option';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=region.id;checkbox.checked=this.selected.has(region.id);const title=document.createElement('span');const name=document.createElement('strong');name.textContent=region.name;const path=document.createElement('small');path.textContent=region.path+(region.enabled?'':' — غير متاحة؛ يمكنك إزالة الاختيار السابق');title.append(name,path);checkbox.onchange=()=>this.toggle(region,checkbox.checked);label.append(checkbox,title);this.list.append(label);}
  }
  validate(){if(!this.selected.size)throw Error('اختر منطقة توصيل واحدة على الأقل من القائمة.');if(!this.loaded&&JSON.stringify([...this.selected])!==JSON.stringify(this.initial))throw Error('أعد تحميل المناطق قبل اعتماد تغيير الاختيارات.');}
 }
 window.PricingRegionPicker=PricingRegionPicker;
})();
