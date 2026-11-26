// Shared branch catalog contract. Prices are IQD; customer selections contain IDs only.
type Row=Record<string,any>;
const invalid=():never=>{throw Object.assign(Error('INVALID_BRANCH_PRODUCT_OPTIONS'),{statusCode:400});};
function exact(v:any,fields:string[]):void {
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!fields.includes(k))||fields.some(k=>!Object.prototype.hasOwnProperty.call(v,k)))invalid();
}
const id=(v:any)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const label=(v:any)=>typeof v==='string'&&v.trim().length>0&&v.length<=150;
export function readBranchProductOptions(value:any):Row[]{
 if(!Array.isArray(value)||value.length>20)invalid();
 const groups=new Set();
 for(const group of value){
  exact(group,['id','title','required','maxSelections','options']);
  if(!id(group.id)||groups.has(group.id)||!label(group.title)||typeof group.required!=='boolean'||!Number.isSafeInteger(group.maxSelections)||group.maxSelections<1||!Array.isArray(group.options)||!group.options.length||group.options.length>40||group.maxSelections>group.options.length)invalid();
  groups.add(group.id);const choices=new Set();
  for(const option of group.options){
   exact(option,['id','name','extraPrice','isAvailable']);
   if(!id(option.id)||choices.has(option.id)||!label(option.name)||typeof option.isAvailable!=='boolean'||typeof option.extraPrice!=='number'||!Number.isFinite(option.extraPrice)||option.extraPrice<0||option.extraPrice>1e9||!/^\d+(?:\.\d{1,3})?$/.test(String(option.extraPrice)))invalid();
   choices.add(option.id);
  }
 }
 if(Buffer.byteLength(JSON.stringify(value))>50000)invalid();
 return JSON.parse(JSON.stringify(value));
}
export function readBranchOptionSelection(value:any):Record<string,string[]>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>20)invalid();
 const detached:Record<string,string[]>={};
 for(const [group,choices] of Object.entries(value)){
  if(!id(group)||!Array.isArray(choices)||choices.length>40||choices.some(v=>!id(v))||new Set(choices).size!==choices.length)invalid();
  Object.defineProperty(detached,group,{value:[...(choices as string[])].sort(),enumerable:true});
 }
 return detached;
}
