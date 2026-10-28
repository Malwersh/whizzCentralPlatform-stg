/* Readability for dynamic controls. Uses rendered fills; no business data or network calls. */
(function(root){
 'use strict';
 if(root.WizzControlContrast)return;
 const selector='button,[role="button"],[role="tab"],.btn,.badge,.status-badge,.status-chip,.tab-button';
 const parse=value=>{
  if(!value)return null;
  const hex=/^#([0-9a-f]{6})$/i.exec(value);if(hex)return [0,2,4].map(i=>parseInt(hex[1].slice(i,i+2),16)).concat(1);
  const m=/^rgba?\(([^)]+)\)$/i.exec(value);if(!m)return null;
  const n=m[1].trim().split(/[\s,/]+/).map(Number);return n.length>=3&&n.every(Number.isFinite)?[n[0],n[1],n[2],n[3]??1]:null;
 };
 const blend=(front,back)=>front.slice(0,3).map((v,i)=>v*front[3]+back[i]*(1-front[3])).concat(1);
 const luminance=c=>c.slice(0,3).reduce((sum,v,i)=>{const n=v/255;return sum+[.2126,.7152,.0722][i]*(n<=.04045?n/12.92:((n+.055)/1.055)**2.4);},0);
 const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 function backgrounds(el){
  const layers=[];let node=el;
  while(node&&node.nodeType===1){
   const css=getComputedStyle(node);
   if(css.backgroundImage&&css.backgroundImage!=='none'){
    if(!css.backgroundImage.startsWith('linear-gradient('))return null;
    const colors=(css.backgroundImage.match(/rgba?\([^)]+\)/g)||[]).map(parse).filter(Boolean);
    if(!colors.length||colors.some(c=>c[3]<1))return null;
    if(!layers.length)return colors;
    return colors.map(c=>layers.reduceRight((b,f)=>blend(f,b),c));
   }
   const color=parse(css.backgroundColor);if(color&&color[3]>0){layers.push(color);if(color[3]===1)break;}
   node=node.parentElement;
  }
  return [layers.reduceRight((b,f)=>blend(f,b),[255,255,255,1])];
 }
 const colors=[[0,41,107,1],[255,255,255,1],[0,0,0,1]];
 function repair(el){
  const css=getComputedStyle(el);if(css.display==='none'||css.visibility==='hidden')return;
  const fills=backgrounds(el),fore=parse(css.color);if(!fills||!fore)return;
  const minimum=el.disabled?3:4.5;
  const score=c=>Math.min(...fills.map(b=>ratio(blend(c,b),b)));
  if(score(fore)>=minimum)return;
  const chosen=colors.find(c=>score(c)>=minimum)||colors.reduce((a,b)=>score(a)>score(b)?a:b);
  if(score(chosen)<minimum)return; // Images or mixed light/dark gradients need an explicit surface design.
  el.style.setProperty('color',`rgb(${chosen.slice(0,3).join(',')})`,'important');
 }
 function scan(scope){
  const controls=[...(scope.nodeType===1&&scope.matches(selector)?[scope]:[]),...(scope.querySelectorAll?.(selector)||[])];
  for(const control of controls){
   repair(control);
   for(const child of control.querySelectorAll('span,i,svg,label,small'))repair(child);
  }
 }
 let observer,frame;const pending=new Set();
 function enqueue(node){pending.add(node);if(frame)return;frame=requestAnimationFrame(()=>{frame=null;const scopes=[...pending];pending.clear();for(const scope of scopes)if(scope.isConnected)scan(scope);});}
 function start(){
  scan(document);
  for(const event of ['pointerover','pointerout','focusin','focusout'])document.addEventListener(event,e=>{const control=e.target.closest?.(selector);if(control)enqueue(control);},true);
  observer=new MutationObserver(records=>{for(const record of records){if(record.type==='attributes')enqueue(record.target);else for(const n of record.addedNodes)if(n.nodeType===1)enqueue(n);}});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','disabled','aria-selected']});
 }
 root.WizzControlContrast={scan,ratio,parse};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
