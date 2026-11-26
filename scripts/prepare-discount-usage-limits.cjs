'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),ts=require('../backend/wallet-service/node_modules/typescript');
const root=path.resolve(__dirname,'..'),dir='/private/tmp/usage-limits-release',merchant=path.resolve(root,'../whizzMerchants-stg');
const prior=fs.readFileSync(path.join(root,'scripts/prepare-shared-discount-lock.cjs'),'utf8');
const factory=new Function('path','ts','assert',prior.slice(prior.indexOf('function factory('),prior.indexOf('const changes='))+'return factory;')(path,ts,assert);
const read=(k,n)=>cp.execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',dir+'/'+k+'.zip',n],{encoding:'utf8',maxBuffer:20000000});
const changes={staff:{},owner:{},auth:{}};
let staff=read('staff','_discount_review/central-staff/index.js');
for(const name of ['commercial-management.js','commercial-options.js','promotions.js']){
 const source=fs.readFileSync(path.join(root,'backend/staff-service',name),'utf8');staff=factory(staff,'backend/staff-service/'+name,source);changes.staff[name]=source;
}
changes.staff['_discount_review/central-staff/index.js']=staff;changes.staff['funding-campaign-limits.js']=fs.readFileSync(path.join(root,'backend/staff-service/funding-campaign-limits.js'),'utf8');
let owner=read('owner','_discount_review/merchant-discounts/index.js');const tag='// ../whizzMerchants-stg/backend/functions/discounts/discount_management_handler.js\n';assert.equal(owner.split(tag).length,2);
let source=fs.readFileSync(path.join(merchant,'backend/functions/discounts/discount_management_handler.js'),'utf8');
const mapping={'../shared/discount-engine':'require_discount_engine()','../shared/discount-contract':'require_discount_contract()'};
source=source.replace(/require\(['"]([^'"]+)['"]\)/g,(original,p)=>mapping[p]||(p.startsWith('../shared/')?'require(process.env.LAMBDA_TASK_ROOT+'+JSON.stringify('/shared/'+path.posix.basename(p)+'.js')+')':original));
changes.owner['_discount_review/merchant-discounts/index.js']=owner.split(tag)[0]+tag+source;
changes.auth['branch_device_discounts.js']=fs.readFileSync(path.join(merchant,'backend/functions/auth/branch_device_discounts.js'),'utf8').replaceAll("require('../shared/","require('./shared/");
for(const [k,entries]of Object.entries(changes))for(const [name,content]of Object.entries(entries)){const dest=path.join(dir,k+'.changes',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,content);cp.execFileSync(process.execPath,['--check',dest]);}
fs.writeFileSync(dir+'/changes.json',JSON.stringify(Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,Object.keys(v)])),null,2));console.log(JSON.stringify({prepared:true,entries:Object.fromEntries(Object.entries(changes).map(([k,v])=>[k,Object.keys(v)]))}));
