const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('../backend/wallet-service/node_modules/typescript');
const source=fs.readFileSync('backend/wallet-service/src/dispatchLegacy.ts','utf8'),ast=ts.createSourceFile('legacy.ts',source,99,true);let code;
function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='driverReferences')code=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);assert(code);
const script=ts.transpile(code+';this.run=driverReferences;', {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS});let checked=0;
const scope={T:{drivers:'drivers',live:'live'},GetCommand:class{},strongGet:async(_,table)=>table==='drivers'?{cognitoSub:'driver',status:'APPROVED'}:{status:'available',isSearching:true,isActive:true},quoteEntityIdValid:x=>typeof x==='string',isDriverApproved:()=>true,vehicleRegistry:{enforce:()=>false},workRegions:{enforced:()=>true,create:()=>({check:async(_,__,target)=>{checked++;assert.equal(target,undefined);return {allowed:false};}})},bad:code=>{throw Error(code);}};
vm.runInNewContext(script,scope);
(async()=>{await assert.rejects(scope.run({},'driver','driver',null,0,undefined,1),/LEGACY_DRIVER_REGION_UNAVAILABLE/);assert.equal(checked,1);console.log('PASS actual legacy references deny missing target region before collateral/acceptance');})().catch(e=>{console.error(e);process.exitCode=1;});
