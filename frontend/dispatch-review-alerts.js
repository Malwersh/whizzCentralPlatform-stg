(function(){'use strict';
 if(window.__dispatchAlerts340)return;window.__dispatchAlerts340=true;
 let cursor=null,working=false,timer,known=new Map(),pending=new Map(),identity=null;
 const node=document.createElement('aside');node.id='dispatch-review-alert';node.dir='rtl';node.hidden=true;node.setAttribute('aria-live','polite');node.style.cssText='position:fixed;bottom:20px;left:20px;z-index:1100;max-width:min(420px,90vw);padding:14px 18px;background:#fff;border:1px solid #b9c8df;border-radius:14px;box-shadow:0 4px 18px #00296b22;color:#00296b';
 const link=document.createElement('a');link.style.cssText='color:#00296b;text-decoration:none;font-weight:600';node.append(link);
 function clear(){identity=null;cursor=null;known.clear();pending.clear();node.hidden=true;}
 async function tick(){
  if(working||document.hidden)return schedule(60000);working=true;
  try{
   const token=window.Auth?.getToken?.('accessToken'),base=window.WIZZCENTRAL_CONFIG?.STAFF_API_BASE_URL;
   if(!token||!base){clear();return;}
   if(identity!==token){clear();identity=token;}
   const r=await fetch(base+'/staff/dispatch-reviews/alerts'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{headers:{Authorization:'Bearer '+token}});
   if(window.Auth?.getToken?.('accessToken')!==token){clear();return;}
   if(r.status===403||r.status===401){clear();return;}
   if(!r.ok)throw Error('alerts unavailable');const data=await r.json();
   for(const item of data.items||[])pending.set(item.caseId,item);
   cursor=data.nextCursor??null;
   // Preserve the last complete result until the resumable scan actually ends.
   if(!cursor){known=pending;pending=new Map();}
   const visible=new Map([...known,...pending]),values=[...visible.values()].sort((a,b)=>Number(b.followup.escalated)-Number(a.followup.escalated)||Date.parse(a.followup.reviewDueAt)-Date.parse(b.followup.reviewDueAt));
   node.hidden=!values.length;
   if(values.length){const first=values[0],late=values.filter(i=>i.followup.overdue).length;link.textContent='طلبات متعثرة تحتاج متابعة: '+values.length+(late?' • متأخرة: '+late:'')+(cursor?' • جارٍ استكمال التحديث':'');link.href=new URL('pages/orders.html?dispatchReviewOrder='+encodeURIComponent(first.orderId),new URL('.',document.currentScript?.src||baseScript)).href;}
  }catch{if(!node.hidden)link.textContent='تعذر تحديث تنبيهات التوزيع — افتح الطلبات للمراجعة';}
  finally{working=false;schedule(cursor?1500:60000);}
 }
 const baseScript=document.currentScript.src;
 function schedule(ms){clearTimeout(timer);timer=setTimeout(tick,ms);}
 function start(){document.body.append(node);schedule(4000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(1000);});}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
 window.addEventListener('pagehide',()=>{clearTimeout(timer);clear();});
})();
