'use strict';
const fs=require('fs'),Module=require('module'),path=require('path'),sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const p=path.resolve('backend/.tmp/order-exceptions-work/return-240');
function load(file){const id=path.join(p,file),m=new Module(id,module);m.filename=id;m.paths=Module._nodeModulePaths(path.resolve('backend/wallet-service'));m._compile(fs.readFileSync(id,'utf8'),id);return m.exports;}
const api=load('order-exception-runtime-229.js');
function wrap(factory){return options=>factory({...options,db:{send:c=>{const type=c.constructor.name.replace(/\d+$/,'');if(!sdk[type])throw Error('UNEXPECTED_COMMAND '+type);return options.db.send(c instanceof sdk[type]?c:new sdk[type](c.input));}}});}
for(const [file,names]of [['codReturn',['createStagingCodReturn']],['returnOperations',['createReturnOperations','createReturnRoadRouter']],['returnDisposition',['createReturnDisposition']],['exceptionCaseAdministration',['createExceptionCaseAdministration']]]){const id=require.resolve('../backend/wallet-service/dist/'+file);require(id);for(const name of names)require.cache[id].exports[name]=name==='createReturnRoadRouter'?api[name]:wrap(api[name]);}
const sla=load('sla-candidate.js'),id=require.resolve('../backend/wallet-service/dist/exceptionCaseSlaWorker');require(id);require.cache[id].exports={...require.cache[id].exports,createExceptionCaseSlaWorker:wrap(sla.createExceptionCaseSlaWorker)};
