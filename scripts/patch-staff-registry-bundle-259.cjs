'use strict';
const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('../whizzMerchants-stg/backend/merchant-platform/staff-capabilities.js','utf8'),canonical=require('../../whizzMerchants-stg/backend/merchant-platform/staff-capabilities');
const file=process.argv[2],out=process.argv[3],raw=fs.readFileSync(file,'utf8');let count=0;
const result=raw.replace(/(^\/\/ [^\n]*staff-capabilities\.js\n)(var (\w+) = __commonJS\(\{\n  "[^"]+"\((exports\w*), (module\w*)\) \{\n)[\s\S]*?\n  \}\n\}\);/gm,(full,marker,header,name,ex,mod)=>{
 const block=marker+header+source.replaceAll('module.exports',mod+'.exports').split('\n').map(l=>'    '+l).join('\n')+'\n  }\n});';
 const sandbox={__commonJS:cb=>{let m;return()=>{if(!m){m={exports:{}};Object.values(cb)[0](m.exports,m);}return m.exports;}}};vm.runInNewContext(block,sandbox);if(JSON.stringify(sandbox[name]().REGISTRY)!==JSON.stringify(canonical.REGISTRY)||JSON.stringify(sandbox[name]().rolePresets())!==JSON.stringify(canonical.rolePresets()))throw Error('REGISTRY_PATCH_MISMATCH');count++;return block;
});if(!count)throw Error('NO_CANONICAL_REGISTRY_MODULE');new vm.Script(result);fs.writeFileSync(out,result);console.log(count);
