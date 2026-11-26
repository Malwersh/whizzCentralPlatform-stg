'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),ts=require('../backend/wallet-service/node_modules/typescript');
const p=path.resolve(__dirname,'../backend/.tmp/driver-vehicles-308'),sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb'),core=require('../backend/shared/driver-vehicles-308');
const actor={employeeId:'reviewer',status:'ACTIVE',roles:['driver_reviewer'],scope:{allRegions:true,regionIds:[]}};
const profile={driverId:'d',status:'APPROVED',registrationStatus:'APPROVED',vehicleType:'car',vehiclePlate:'123',work_region_id:'r',registrationPaperUrl:'s3://bucket/drivers/d/old',drivingLicenseUrl:'s3://bucket/drivers/d/license',nationalIdUrl:'s3://bucket/drivers/d/id'};
const file=path.join(p,'staging-wizz-staff-service/files/_discount_review/central-staff/index.js'),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,99,true);let declaration;
function visit(n){if(ts.isFunctionDeclaration(n)&&n.body?.getText(ast).includes('VEHICLE_STAFF_COMMAND_INVALID'))declaration=n;ts.forEachChild(n,visit);}visit(ast);assert(declaration);
const foreign={GetCommand:class GetCommand{constructor(input){this.input=input;}},TransactWriteCommand:class TransactWriteCommand{constructor(input){this.input=input;}}};
const testModule={exports:{}};const modctx={module:testModule,exports:testModule.exports,process:{env:{DRIVER_DOCUMENTS_BUCKET:'bucket'}},require:name=>name==='@aws-sdk/lib-dynamodb'?foreign:name==='./catalog'?require('../backend/staff-service/catalog'):core};
vm.runInNewContext(fs.readFileSync(path.join(p,'staging-wizz-staff-service/files/driver-vehicles.js'),'utf8'),modctx);
const body=declaration.body.getText(ast),get=body.match(/GetCommand:(GetCommand\d*)/)[1],tx=body.match(/TransactWriteCommand:(TransactWriteCommand\d*)/)[1];
const scope={require:name=>name.includes('driver-vehicles-core')?core:testModule.exports};scope[get]=sdk.GetCommand;scope[tx]=sdk.TransactWriteCommand;
vm.runInNewContext(declaration.getText(ast)+';this.factory='+declaration.name.text,scope);
(async()=>{let transaction,reads=0;const ctx={driversTable:'drivers',guard:()=>({ConditionCheck:{TableName:'staff',Key:{pk:'EMPLOYEE',sk:'PROFILE'}}}),audit:()=>({Put:{TableName:'staff',Item:{pk:'AUDIT',sk:'id'}}}),id:()=> 'event',db:{send:async command=>{
 if(command instanceof sdk.GetCommand){reads++;return {Item:structuredClone(profile)};}
 assert(command instanceof sdk.TransactWriteCommand,'foreign command reached host client');transaction=command.input;return {};
}}};
const view=await scope.factory(ctx,actor,'GET','/staff/drivers/d/vehicles');assert.equal(view.vehicles[0].effectiveStatus,'PENDING_REVIEW');
await scope.factory(ctx,actor,'POST','/staff/drivers/d/vehicles',{action:'INITIALIZE',expectedVersion:0});assert(transaction.TransactItems.some(x=>x.Update?.TableName==='drivers'));assert(transaction.TransactItems.some(x=>x.ConditionCheck?.TableName==='staging-AccountDeletion'));assert(transaction.TransactItems.some(x=>x.Put?.TableName==='staff'));
const count=reads;await assert.rejects(scope.factory(ctx,{...actor,roles:['driver_manager']},'POST','/staff/drivers/d/vehicles',{action:'INITIALIZE',expectedVersion:0}),/PERMISSION_REQUIRED/);assert.equal(reads,count);
assert(source.includes("if(method==='POST'&&/^\\/staff\\/drivers\\/[^/]+\\/vehicles$/"));
console.log('PASS actual active staff handler route, scoped role denial, host SDK conversion, atomic deletion/staff/profile guards and audit');
})().catch(e=>{console.error(e);process.exitCode=1;});
