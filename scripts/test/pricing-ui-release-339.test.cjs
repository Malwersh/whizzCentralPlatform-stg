'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');const {verify}=require('../verify-pricing-ui.cjs');
const files=['pages/delivery-pricing.html','delivery-pricing.js','pricing-workspace.js','pricing-region-picker.js','pricing-field-help.js','cash-rounding.js','styles/pricing-layout.css'];
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pricing-ui-'));for(const f of files){fs.mkdirSync(path.dirname(path.join(dir,f)),{recursive:true});fs.copyFileSync(path.join(__dirname,'../../frontend',f),path.join(dir,f));}t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('complete reviewed bundle passes',t=>assert.equal(verify(fixture(t)),true));
test('missing field helper blocks packaging',t=>{const dir=fixture(t);fs.unlinkSync(path.join(dir,'pricing-field-help.js'));assert.throws(()=>verify(dir));});
test('old rule renderer blocks packaging',t=>{const dir=fixture(t);fs.writeFileSync(path.join(dir,'delivery-pricing.js'),'old pricing renderer');assert.throws(()=>verify(dir),/Stale or incomplete/);});
test('old page blocks packaging',t=>{const dir=fixture(t),f=path.join(dir,'pages/delivery-pricing.html');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('data-pricing-ui="340"',''));assert.throws(()=>verify(dir),/older than/);});
