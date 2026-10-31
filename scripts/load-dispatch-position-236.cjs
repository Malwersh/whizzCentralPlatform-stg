'use strict';
// Offline test hook only. Never included in deployment archives.
const fs=require('fs'),Module=require('module'),path=require('path');
const file=process.env.DISPATCH_CANDIDATE_236;if(!file)throw Error('candidate required');
const names=['createStagingDriverOfferStore','createStagingDriverFinancialWave',...(file.includes('financial-accept')?[]:['createStagingDispatchCoordinator'])];
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.resolve(__dirname,'../backend/wallet-service'));
m._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.__offline236={'+names.join(',')+'};',file);
const sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
for(const [name,factory]of Object.entries(m.exports.__offline236)){
 const target={createStagingDriverOfferStore:'driverOfferStore',createStagingDriverFinancialWave:'driverFinancialWave',createStagingDispatchCoordinator:'dispatchCoordinator'}[name];
 const wrapped=options=>factory({...options,db:{send:command=>{const type=command.constructor.name.replace(/\d+$/,'');if(!sdk[type])throw Error('UNEXPECTED_COMMAND '+type);return options.db.send(command instanceof sdk[type]?command:new sdk[type](command.input));}}});
 const id=require.resolve('../backend/wallet-service/dist/'+target);require(id);require.cache[id].exports={[name]:wrapped};
}
