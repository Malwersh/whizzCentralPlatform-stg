'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const {replaceOnce}=require('./prepare-delivery-quote-order.cjs');
const root=path.resolve(__dirname,'..'),[audit,out]=process.argv.slice(2);
if(!path.isAbsolute(audit||'')||!path.isAbsolute(out||'')||fs.existsSync(out))throw Error('NEW_ABSOLUTE_OUTPUT_REQUIRED');fs.mkdirSync(out,{mode:0o700});
const archive=r=>JSON.parse(cp.execFileSync('python3',[path.join(__dirname,'quote-release-archive.py')],{input:JSON.stringify(r),encoding:'utf8',maxBuffer:12*1024*1024}));
const save=(n,bytes)=>{const f=path.join(out,n);fs.writeFileSync(f,bytes,{mode:0o600});return f;};
cp.execFileSync(process.execPath,[path.join(__dirname,'build-driver-financial-runtime.cjs'),path.join(out,'runtime')]);
const runtime=path.join(out,'runtime/financial-runtime.js'),quote=save('quote-index.js',esbuild.buildSync({entryPoints:[path.join(root,'../wizzuser-stg/backend/src/functions/delivery-quotes/index.js')],bundle:true,platform:'node',target:'node22',keepNames:true,write:false,logLevel:'silent'}).outputFiles[0].contents),functions=[];
for(const name of ['staging-wizz-staff-service','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept','WizzUser-DeliveryQuotes-staging']){
 const c=JSON.parse(fs.readFileSync(path.join(audit,name+'.private.json'))),source=path.join(audit,name+'.zip'),read=file=>Buffer.from(archive({mode:'read',source,expectedCodeSha256:c.CodeSha256,name:file}).base64,'base64').toString();let replacements={},additions={};
 if(name==='staging-wizz-staff-service'){
  const line=fs.readFileSync(path.join(root,'backend/staff-service/index.js'),'utf8').split('\n').find(x=>x.includes("if(path==='/staff/settings/delivery-operations'"));
  if(!line)throw Error('MISSING_ROUTE');const before=read('index.js'),anchor="  if(path.startsWith('/staff/settings/'))";if(before.includes("'/staff/settings/delivery-operations'"))throw Error('ROUTE_ALREADY_PRESENT');
  replacements['index.js']=save('staff-index.js',replaceOnce(before,anchor,line+'\n'+anchor));
  if(read('operational-settings.js')!==fs.readFileSync(path.join(root,'backend/staff-service/operational-settings.js'),'utf8'))throw Error('SETTINGS_WORKFLOW_DRIFT');
  additions={'dispatch-settings.js':path.join(root,'backend/staff-service/dispatch-settings.js'),'dispatch-settings-contract.js':path.join(root,'backend/staff-service/dispatch-settings-contract.js')};
 }else if(name.startsWith('WaveSystem_')){if(read('index.js')!==fs.readFileSync(path.join(root,'lambda',name,'index.js'),'utf8'))throw Error('WAVE_HANDLER_DRIFT');replacements={'financial-runtime.js':runtime};}
 else replacements={'index.js':name.includes('DeliveryQuotes')?quote:runtime};
 const changed=archive({mode:'patch',source,expectedCodeSha256:c.CodeSha256,destination:path.join(out,name+'.zip'),replacements,additions});functions.push({name,baseCodeSha256:c.CodeSha256,baseRevisionId:c.RevisionId,handler:c.Handler,...changed});
}
const source=path.join(audit,'frontend.live.zip'),digest=require('crypto').createHash('sha256').update(fs.readFileSync(source)).digest('base64');
const old=Buffer.from(archive({mode:'read',source,expectedCodeSha256:digest,name:'pages/settings.html'}).base64,'base64').toString();
const page=fs.readFileSync(path.join(root,'frontend/pages/settings.html'),'utf8'),section=page.slice(page.indexOf('<section id="delivery-operations">'),page.indexOf('</main>'));
const candidate=replaceOnce(old,'</main>',section+'</main>').replace('</body>','<script src="../settings-delivery-operations.js?v=20261016-ops32"></script></body>');if(candidate!==page)throw Error('SETTINGS_PAGE_DRIFT');
const frontend=archive({mode:'patch',source,expectedCodeSha256:digest,destination:path.join(out,'frontend.zip'),replacements:{'pages/settings.html':save('settings.html',candidate)},additions:{'settings-delivery-operations.js':path.join(root,'frontend/settings-delivery-operations.js')}});
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({stage:'staging',financialActivation:'OFF',functions,frontend},null,2)+'\n');console.log(JSON.stringify({functions:functions.length,frontend,activation:'OFF'}));
