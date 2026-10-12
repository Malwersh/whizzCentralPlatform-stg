const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('frontend/finance.js','utf8');
async function run(status){
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{hidden:id==='content',value:'PENDING',textContent:'',replaceChildren(){}});return elements.get(id);};
 element('content');
 let navigation=false;
 const context={document:{getElementById:element},window:{Auth:{getToken:()=> 'fixture',requireAuthentication:()=>true},navigationManager:{init:async()=>{navigation=true;}}},sessionStorage:{getItem:()=>null},localStorage:{getItem:()=>null},fetch:async url=>({status,ok:status===200,json:async()=>url.includes('/funding/config')?{manual:{phone:'07800868280',name:'Fixture',enabled:true}}:{requests:[],message:'Unauthorized'}}),URL};
 vm.runInNewContext(source,context);await new Promise(resolve=>setImmediate(resolve));return {elements,navigation};
}
test('finance page initializes shared navigation and shows authorized data',async()=>{const r=await run(200);assert.equal(r.navigation,true);assert.equal(r.elements.get('content').hidden,false);});
test('expired sessions and missing finance role show actionable Arabic messages without exposing controls',async()=>{for(const status of [401,403]){const r=await run(status);assert.equal(r.elements.get('content').hidden,true);assert.match(r.elements.get('message').textContent,/الدخول/);assert.equal(r.elements.get('retry').hidden,false);}});
test('finance page uses platform layout and active navigation',()=>{const html=fs.readFileSync('frontend/pages/finance.html','utf8');for(const text of ['sidebar-placeholder','id="mainContent"','material-3-design-system.css','data-page="finance"','navigation.js'])assert.ok(html.includes(text));});
