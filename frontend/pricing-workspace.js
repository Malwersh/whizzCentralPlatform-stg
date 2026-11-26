'use strict';
// Navigation only: reuse the existing loaded policies, editor and save handlers.
(()=>{
 const $=id=>document.getElementById(id);
 const views=['home','delivery','driver','cash-rounding','simulator','pricing-versions'];
 let active='home',editorKind=null;
 const panel=v=>$(v==='home'?'pricing-home':v);
 const editingView=()=>active==='delivery'||active==='driver';
 const shared=[$('pricing-scope-panel'),$('pricing-edit-actions'),$('pricing-approve-actions'),$('pricing-rule-editor')];
 function select(view,{focus=true}={}){
  if(!views.includes(view))view='home';active=view;
  for(const v of views)panel(v).hidden=v!==active;
  $('pricing-scope-panel').hidden=!editingView();
  // Use CSS presentation gating, never override permissions or loading flags.
  for(const p of shared.slice(1))p.classList.toggle('pricing-workspace-concealed',!editingView()||(p.id==='pricing-rule-editor'&&editorKind!==active));
  const target=panel(active);
  if(editingView()){
   target.before($('pricing-scope-panel'));
   target.after($('pricing-rule-editor'));
   $('pricing-rule-editor').after($('pricing-edit-actions'));
   $('pricing-edit-actions').after($('pricing-approve-actions'));
  }
  document.querySelectorAll('.pricing-workspace-nav [data-pricing-view]').forEach(b=>{const current=b.dataset.pricingView===active;b.setAttribute('aria-current',current?'page':'false');});
  if(location.hash!=='#'+active)history.replaceState(null,'','#'+active);
  if(focus){const heading=target.querySelector('h2');heading.tabIndex=-1;heading.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'smooth'});}
 }
 document.addEventListener('click',e=>{
  const button=e.target.closest('[data-pricing-view]');if(button){select(button.dataset.pricingView);return;}
  const link=e.target.closest('a[href^="#"]');if(link&&views.includes(link.hash.slice(1))){e.preventDefault();select(link.hash.slice(1));}
 });
 window.addEventListener('hashchange',()=>select(location.hash.slice(1)));
 window.addEventListener('pricing-editor-open',e=>{editorKind=e.detail.kind;if(active!==editorKind)select(editorKind,{focus:false});$('pricing-rule-editor').classList.remove('pricing-workspace-concealed');});
 function status(kind){
  const host=$('pricing-'+kind+'-list'),overview=$('pricing-'+kind+'-overview');
  const exists=[...host.querySelectorAll('.pricing-rule-card .pricing-rule-badge')].some(n=>n.textContent==='قاعدة عامة');
  overview.textContent=exists?'توجد إعدادات عامة محفوظة. افتح القسم لمراجعتها.':'لا توجد قاعدة عامة في البيانات المحمّلة. افتح القسم لإعدادها.';
  overview.className=exists?'pricing-overview-ok':'pricing-overview-missing';
 }
 for(const kind of ['delivery','driver'])new MutationObserver(()=>status(kind)).observe($('pricing-'+kind+'-list'),{childList:true,subtree:true});
 select(location.hash.slice(1),{focus:false});
})();
