'use strict';
// Offline capture test hook, never included in Lambda ZIPs.
const fs=require('fs'),Module=require('module'),path=require('path');
const p=path.resolve('backend/.tmp/order-exceptions-work/review-237'),sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
function factory(file,name){const id=path.join(p,file),m=new Module(id,module);m.filename=id;m.paths=Module._nodeModulePaths(path.resolve('backend/wallet-service'));m._compile(fs.readFileSync(id,'utf8')+'\nmodule.exports.__offlineFactory238='+name+';',id);return options=>m.exports.__offlineFactory238({...options,db:{send:c=>{const type=c.constructor.name.replace(/\d+$/,'');if(!sdk[type])throw Error('UNKNOWN_COMMAND '+type);return options.db.send(c instanceof sdk[type]?c:new sdk[type](c.input));}}});}
for(const [moduleName,name,file]of [['dispatchReviewHost','createStagingDispatchReviewHost','dispatch-review-host-238.js'],['dispatchLegacyHost','createStagingDispatchFinancialHost','timeout-candidate.js']]){const id=require.resolve('../backend/wallet-service/dist/'+moduleName);require(id);require.cache[id].exports={...require.cache[id].exports,[name]:factory(file,name)};}
