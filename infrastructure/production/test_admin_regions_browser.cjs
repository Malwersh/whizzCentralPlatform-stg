'use strict';
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=process.env.WIZZ_ADMIN_WEB_BUILD;if(!root)throw Error('WIZZ_ADMIN_WEB_BUILD required');
const server=http.createServer((req,res)=>{const f=path.join(root,req.url.split('?')[0]);if(!fs.existsSync(f)){res.writeHead(404);return res.end();}res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(f));});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'chrome'});let checks=0;try{
for(const width of [390,1280])for(const editable of [false,true]){
let tileRequests=0;const p=await browser.newPage({viewport:{width,height:844}}),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));
await p.route('**/assets/js/auth-utils.js',r=>r.fulfill({contentType:'application/javascript',body:'window.Auth={ensureSession:async()=>{},getToken:()=>"test"}'}));
await p.route('**/staff/regions/manage',r=>{if(r.request().method()!=='GET')writes.push(r.request().method());return r.fulfill({json:{regions:[],drafts:[],jobs:[],digest:'empty',permissions:{edit:editable,publish:editable,history:true}}});});
await p.route('https://tile.openstreetmap.org/**',async r=>{const headers=await r.request().allHeaders();assert.equal(headers.referer,'http://127.0.0.1:'+server.address().port+'/');tileRequests++;return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});});
await p.goto('http://127.0.0.1:'+server.address().port+'/pages/regions.html');
await p.getByText('لا توجد مناطق تطابق البحث.',{exact:true}).waitFor();
assert.equal(await p.getByRole('button',{name:'إضافة منطقة',exact:true}).isEnabled(),editable);checks++;
if(editable){await p.getByRole('button',{name:'إضافة منطقة',exact:true}).click();await p.getByRole('heading',{name:'إضافة منطقة جديدة',exact:true}).waitFor();await p.locator('#region-editor-map').waitFor();assert(await p.locator('#region-editor-map').evaluate(e=>e.clientHeight>100));await p.waitForFunction(()=>document.querySelector('#region-editor-map .leaflet-pane'));assert(await p.locator('.leaflet-draw-draw-polygon').evaluate(e=>getComputedStyle(e).backgroundImage.includes('spritesheet')));assert.equal(await p.locator('.region-field-section details[open]').count(),0);assert.equal(await p.getByText('استلام من المتجر',{exact:true}).count(),0);checks++;await p.getByRole('button',{name:'إغلاق',exact:true}).click();}
assert.equal(await p.locator('#region-overview-map .leaflet-pane').count()>0,true);checks++;
assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
await p.waitForFunction(()=>document.querySelectorAll('.leaflet-tile-loaded').length>0);assert(tileRequests>0);checks++;assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);checks++;await p.close();
}
console.log(JSON.stringify({regionBrowserChecksPassed:checks,productionWritesPerformed:false}));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
