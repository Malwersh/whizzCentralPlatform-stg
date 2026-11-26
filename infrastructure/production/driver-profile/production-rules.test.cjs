'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {registrationOptions,validateRegistration}=require('./registration-regions');
const vehicle=require('./driver-vehicles-308');
test('production registration only accepts an open Iraqi region in its real parent hierarchy',()=>{
 const rows=[{regionId:'iq',level:0,name:'Iraq',effective_is_active:1},{regionId:'g',level:1,parent_id:'iq',name:'Najaf',effective_is_active:1},{regionId:'d',level:2,parent_id:'g',name:'District',effective_is_active:1},{regionId:'r',level:3,parent_id:'d',name:'Region',effective_is_active:1}];
 const options=registrationOptions(rows);assert.equal(options.regions.length,1);assert.equal(validateRegistration({vehicleType:'car',work_region_id:'r',governorate_id:'g'},options).country_code,'IQ');
 assert.throws(()=>validateRegistration({vehicleType:'car',work_region_id:'r',governorate_id:'other'},options));
 rows[2].effective_is_active=0;assert.equal(registrationOptions(rows).regions.length,0);
});
test('completing profile or merely claiming approval cannot bypass vehicle/document review',()=>{
 for(const p of [{status:'PENDING_REVIEW',isVerified:true},{status:'APPROVED',isActive:true,work_region_id:'r'},{status:'ACTIVE',isVerified:true}])assert.equal(vehicle.eligibility(p).eligible,false);
});
test('document references remain private and isolated per driver',()=>{
 const bucket='wizz-production-driver-documents-746727375268-us-east-1';
 assert.equal(vehicle.owns('s3://'+bucket+'/drivers/a/driving_license/doc.png','a',bucket),true);
 for(const url of ['s3://'+bucket+'/drivers/b/doc.png','https://example.com/doc.png','s3://'+bucket+'/drivers/a/../b/doc.png'])assert.equal(vehicle.owns(url,'a',bucket),false);
});
test('production lifecycle wrapper fences writes using production account lifecycle table',async()=>{
 class TransactWriteCommand{constructor(input){this.input=input;}}class PutCommand{constructor(input){this.input=input;}}
 let captured;const box={module:{exports:{}},require:n=>n==='@aws-sdk/lib-dynamodb'?{TransactWriteCommand,PutCommand}:require(n)};
 vm.runInNewContext(fs.readFileSync(__dirname+'/driver-lifecycle.js','utf8'),box);
 const m=box.module.exports;await m.driverRequestContext.run({sub:'a'},()=>m.driverLifecycleClient({send:async c=>{captured=c;return {};}}).send(new PutCommand({TableName:'wizz-production-Drivers',Item:{driverId:'a'}})));
 assert.equal(captured.input.TransactItems[0].ConditionCheck.TableName,'wizz-production-AccountDeletion');
 assert.equal(captured.input.TransactItems[0].ConditionCheck.Key.pk,'ACCOUNT_LIFECYCLE#DRIVER#a');
});
