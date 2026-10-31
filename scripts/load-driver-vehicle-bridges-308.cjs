'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('../backend/wallet-service/node_modules/typescript');
const sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb'),cognito=require('../backend/wallet-service/node_modules/@aws-sdk/client-cognito-identity-provider');
const p=path.resolve(__dirname,'../backend/.tmp/driver-vehicles-308'),runtime=require(p+'/driver-vehicles-runtime-308'),wrappers=new Map();
for(const row of JSON.parse(fs.readFileSync(p+'/packages.json'))){for(const file of row.changedFiles){if(file==='driver-vehicles-runtime-308.js')continue;const filename=path.join(p,row.name,'files',file),s=fs.readFileSync(filename,'utf8'),a=ts.createSourceFile(file,s,99,true);
 function visit(n){if(ts.isFunctionDeclaration(n)&&n.name&&n.body){const name=Object.keys(runtime).find(k=>new RegExp('^'+k+'[0-9]*$').test(n.name.text)),body=n.body.getText(a);if(name&&body.includes('driver-vehicles-runtime-308.js')&&!wrappers.has(name)){
  const context={require:mod=>mod==='@aws-sdk/lib-dynamodb'?sdk:mod==='@aws-sdk/client-cognito-identity-provider'?cognito:runtime};
  for(const match of body.matchAll(/\bsdk\s*=\s*([$\w]+)(?:;|,)/g))context[match[1]]=/cognito/i.test(match[1])?cognito:sdk;
  vm.runInNewContext(n.getText(a)+';this.factory='+n.name.text,context);wrappers.set(name,context.factory);return;
 }}ts.forEachChild(n,visit);}visit(a);
}}
for(const mod of ['driverOfferContext','driverOfferStore','driverOfferAcceptance','dispatchCandidates','dispatchLegacy']){const key=require.resolve('../backend/wallet-service/dist/'+mod),exports=require(key),next={...exports};for(const n of Object.keys(exports))if(wrappers.has(n))next[n]=wrappers.get(n);require.cache[key].exports=next;}
if(wrappers.size!==6)throw Error('Missing actual vehicle delegate');
