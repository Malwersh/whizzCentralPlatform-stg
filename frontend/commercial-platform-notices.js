'use strict';
// The protected commercial API reads durable consent audits. Two-second active-tab
// refresh; no browser permission prompt and no financial data on shared channels.
(()=>{
 const create=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 let account=null,events=[],known=new Set(),read=new Set(),started=false,stopped=false,inflight=false,timer,delay=2000;
 const box=create('div'),summary=create('button'),badge=create('span'),panel=create('section'),title=create('strong','موافقات المطاعم'),closeButton=create('button','×'),status=create('p'),list=create('div'),toast=create('div'),toastText=create('span'),toastClose=create('button','×');
 box.className='commercial-platform-notices';box.dir='rtl';box.hidden=true;
 summary.type='button';summary.className='commercial-notice-toggle';summary.setAttribute('aria-label','إشعارات موافقات المطاعم');summary.setAttribute('title','إشعارات موافقات المطاعم');summary.setAttribute('aria-expanded','false');summary.setAttribute('aria-controls','commercial-approval-panel');
 summary.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>';
 badge.className='commercial-notice-count';badge.hidden=true;summary.append(badge);box.append(summary);
 panel.className='commercial-notice-panel';panel.id='commercial-approval-panel';panel.dir='rtl';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','commercial-approval-title');title.id='commercial-approval-title';
 const header=create('div');header.className='commercial-notice-heading';closeButton.type='button';closeButton.className='commercial-notice-close';closeButton.setAttribute('aria-label','إغلاق إشعارات الموافقات');header.append(title,closeButton);list.className='commercial-notice-list';panel.append(header,status,list);
 toast.className='commercial-platform-toast';toast.dir='rtl';toast.hidden=true;toastText.setAttribute('role','status');toastText.setAttribute('aria-live','polite');toastClose.type='button';toastClose.setAttribute('aria-label','إغلاق التنبيه');toast.append(toastText,toastClose);
 const style=create('style');style.textContent=`
 .commercial-platform-notices{display:inline-flex;vertical-align:middle;margin-inline-start:14px;color:#213f6b;font:14px/1.6 sans-serif}
 .commercial-platform-notices[hidden],.commercial-notice-panel[hidden],.commercial-platform-toast[hidden],.commercial-notice-count[hidden]{display:none!important}
 .commercial-platform-notices .commercial-notice-toggle{position:relative;display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;padding:0;border:1px solid #dce4ef;border-radius:12px;background:#fff;color:#213f6b;cursor:pointer}
 .commercial-notice-toggle:focus-visible,.commercial-notice-panel button:focus-visible{outline:3px solid #e8bd35;outline-offset:3px}
 .commercial-notice-count{position:absolute;top:-7px;inset-inline-end:-7px;min-width:19px;height:19px;box-sizing:border-box;padding:0 4px;display:grid;place-items:center;border-radius:12px;background:#d33b39;color:white;font-size:11px;font-weight:700;border:2px solid white;line-height:15px}
 .commercial-notice-panel{position:fixed;z-index:10020;width:360px;max-width:calc(100vw - 24px);box-sizing:border-box;background:#fff;color:#182b49;border:1px solid #dce4ef;border-radius:16px;box-shadow:0 10px 32px #12264026;overflow:auto;font:14px/1.6 sans-serif}
 .commercial-notice-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;border-bottom:1px solid #e5eaf1}
 .commercial-notice-heading .commercial-notice-close{display:grid;place-items:center;flex-shrink:0;width:32px;height:32px;border:0;border-radius:8px;background:#f1f4f8;color:#526782;font-size:24px;cursor:pointer}
 .commercial-notice-panel p{margin:8px 16px;color:#607086;font-size:12px}
 .commercial-notice-list>button{display:block;font:inherit;border:0;border-top:1px solid #e5eaf1;background:white;color:inherit;padding:14px 16px;text-align:right;width:100%;cursor:pointer;overflow-wrap:anywhere}
 .commercial-notice-list>button:hover{background:#f6f8fc}.commercial-notice-list>button.unread{background:#f1f6ff;border-inline-start:3px solid #213f6b}
 .commercial-notice-list small{display:block;color:#607086;font-size:12px;margin-top:6px}
 .commercial-platform-toast{position:fixed;left:18px;bottom:24px;z-index:10030;max-width:calc(100vw - 36px);box-sizing:border-box;display:flex;align-items:center;gap:16px;background:#e6f5ee;color:#17613d;border:1px solid #acd6bf;border-radius:12px;padding:12px 16px;font:14px/1.6 sans-serif}
 .commercial-platform-toast>button{background:transparent;border:0;color:inherit;font-size:24px;cursor:pointer;flex-shrink:0}
 `;
 document.head.append(style);
 const anchor=document.querySelector('[data-commercial-kind="FUNDING"]>summary')||document.querySelector('[data-commercial-kind="AGREEMENT"]>summary')||document.querySelector('main .page-header,main header,main')||document.body;
 anchor.append(box);document.body.append(panel,toast);
 let toastTimer,renderSignature='';
 function positionPanel(){if(panel.hidden)return;const rect=summary.getBoundingClientRect(),width=Math.min(360,innerWidth-24),top=Math.max(12,Math.min(rect.bottom+8,innerHeight-180));panel.style.width=width+'px';panel.style.left=Math.max(12,Math.min(rect.right-width,innerWidth-width-12))+'px';panel.style.top=top+'px';panel.style.maxHeight=Math.max(120,Math.min(520,innerHeight-top-12))+'px';}
 function closePanel(restore=false){panel.hidden=true;summary.setAttribute('aria-expanded','false');if(restore&&!box.hidden)summary.focus();}
 summary.onclick=e=>{e.preventDefault();e.stopPropagation();if(!panel.hidden){closePanel();return;}panel.hidden=false;summary.setAttribute('aria-expanded','true');positionPanel();closeButton.focus();};
 closeButton.onclick=()=>closePanel(true);toastClose.onclick=()=>{clearTimeout(toastTimer);toast.hidden=true;};
 document.addEventListener('click',e=>{if(!panel.hidden&&!panel.contains(e.target)&&!box.contains(e.target))closePanel();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){e.preventDefault();closePanel(true);}});
 window.addEventListener('resize',positionPanel);window.addEventListener('scroll',positionPanel,true);
 const subject=()=>{try{const t=window.Auth?.getToken('accessToken');if(!t)return null;return JSON.parse(atob(t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).sub||null;}catch{return null;}};
 const storageKey=()=> 'commercial-approval-read-v1:'+account;
 function reset(sub){account=sub;events=[];known.clear();read=new Set();started=false;stopped=false;box.hidden=true;closePanel();renderSignature='';list.replaceChildren();clearTimeout(toastTimer);toast.hidden=true;try{const ids=JSON.parse(localStorage.getItem(storageKey())||'[]');if(Array.isArray(ids))read=new Set(ids.filter(x=>typeof x==='string').slice(-300));}catch{}}
 function text(item){return 'وافق '+(item.acceptedBy.role==='MANAGER'?'مدير الفرع':'مالك المتجر')+' '+item.acceptedBy.name+' على '+item.label+' — '+item.businessName;}
 function draw(){const unread=events.filter(x=>!read.has(x.eventId)).length;badge.textContent=unread>99?'99+':String(unread);badge.hidden=!unread;summary.setAttribute('aria-label','إشعارات موافقات المطاعم'+(unread?'، '+unread+' غير مقروءة':''));
  const signature=JSON.stringify({events,read:[...read]});if(signature===renderSignature)return;renderSignature=signature;list.replaceChildren();if(!events.length)list.append(create('p','لا توجد موافقات خلال الأيام السبعة الأخيرة.'));
  for(const item of events){const b=create('button',text(item));b.type='button';b.className=read.has(item.eventId)?'':'unread';const date=new Date(item.acceptedAt);if(Number.isFinite(date.getTime()))b.append(create('small',new Intl.DateTimeFormat('ar-IQ',{timeZone:'UTC',dateStyle:'short',timeStyle:'short'}).format(date)+' UTC'));b.onclick=()=>{read.add(item.eventId);try{localStorage.setItem(storageKey(),JSON.stringify([...read].slice(-300)));}catch{}draw();closePanel(true);const kind=document.querySelector('[data-commercial-kind]')?.dataset.commercialKind;if(window.commercialForBranch&&kind===item.kind){window.dispatchEvent(new CustomEvent('commercial-approval-open',{detail:item}));}else{const url=new URL(item.kind==='FUNDING'?'promotions.html':'merchants.html',window.location.href);url.searchParams.set('commercialBusinessId',item.businessId);if(item.sharingId)url.searchParams.set('commercialSharingId',item.sharingId);window.location.assign(url.href);}};list.append(b);}}
 async function poll(){
  if(inflight)return;clearTimeout(timer);let next=delay;
  try{
   const sub=subject();if(sub!==account)reset(sub);if(!sub||document.hidden||stopped||!window.WIZZCENTRAL_CONFIG?.STAFF_API_BASE_URL)return;
   inflight=true;await window.Auth.ensureSession();if(subject()!==sub)return;
   const response=await fetch(window.WIZZCENTRAL_CONFIG.STAFF_API_BASE_URL+'/staff/commercial?view=platform-events',{headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken')},signal:AbortSignal.timeout(10000)});
   if(subject()!==sub)return;
   if(response.status===401||response.status===403){stopped=true;box.hidden=true;closePanel();events=[];list.replaceChildren();toast.hidden=true;return;}
   if(!response.ok)throw Error('UNAVAILABLE');const data=await response.json();if(subject()!==sub)return;
   if(!Array.isArray(data.items))throw Error('INVALID_RESPONSE');
   const valid=data.items.filter(x=>typeof x.eventId==='string'&&typeof x.businessId==='string'&&typeof x.label==='string'&&typeof x.businessName==='string'&&['AGREEMENT','FUNDING'].includes(x.kind)&&['OWNER','MANAGER'].includes(x.acceptedBy?.role)&&typeof x.acceptedBy?.name==='string');
   const added=started?valid.filter(x=>!known.has(x.eventId)):[];events=valid;known=new Set(valid.map(x=>x.eventId));started=true;box.hidden=false;status.textContent='تحديث تلقائي كل ثانيتين أثناء فتح المنصة.';draw();delay=2000;next=delay;
   if(added.length){toastText.textContent=added.length===1?text(added[0]):'وصلت '+added.length+' موافقات جديدة من المطاعم.';clearTimeout(toastTimer);toast.hidden=false;toastTimer=setTimeout(()=>{toast.hidden=true;},6000);}
   window.dispatchEvent(new CustomEvent('commercial-approval-events',{detail:{items:valid,account:sub}}));
  }catch{status.textContent='تعذر تحديث الموافقات؛ ستتم إعادة المحاولة تلقائيًا.';delay=Math.min(30000,delay*2);next=delay;}
  finally{inflight=false;timer=setTimeout(poll,next);}
 }
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){stopped=false;poll();}});window.addEventListener('focus',()=>{stopped=false;poll();});window.addEventListener('pagehide',()=>{clearTimeout(timer);});
 window.CommercialPlatformNotices={refresh:poll};poll();
})();
