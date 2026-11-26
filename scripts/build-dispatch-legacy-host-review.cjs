'use strict';
// Offline overlay + additional IAM proposal only, never deploys or grants.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=process.argv[2];if(!out||!path.isAbsolute(out))throw Error('ABSOLUTE_OUTPUT_REQUIRED');
execFileSync(process.execPath,[path.join(root,'scripts/build-dispatch-coordinator-runtime.cjs'),out],{stdio:'pipe'});
const files=['lambda/WaveSystem_CreateDispatchJob/index.js','lambda/WaveSystem_StartWave/index.js','lambda/WaveSystem_HandleWaveTimeout/index.js'],hashes={};for(const f of files){const b=fs.readFileSync(path.join(root,f));const dest=path.join(out,path.relative('lambda',f));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,b);hashes[f]=crypto.createHash('sha256').update(b).digest('hex');}
const arn=t=>'arn:aws:dynamodb:us-east-1:699561669180:table/'+t;
const policy={Version:'2012-10-17',Statement:[
 {Effect:'Allow',Action:['dynamodb:GetItem','dynamodb:ConditionCheckItem'],Resource:['WizzOrders','WizzDispatchJobs_staging','WhizzMerchants_Businesses','WhizzDrivers_staging','WizzDriverLiveState_staging','staging-AccountDeletion'].map(arn)},
 {Effect:'Allow',Action:['dynamodb:GetItem','dynamodb:ConditionCheckItem'],Resource:arn('staging-PlatformStaff'),Condition:{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['DISPATCH_REVIEW#*']}}},
 {Effect:'Allow',Action:['dynamodb:Query'],Resource:[arn('WizzDispatchJobs_staging'),arn('WizzDriverLiveState_staging')+'/index/RegionStatusIndex']},
 {Effect:'Allow',Action:['dynamodb:Scan'],Resource:arn('WizzDriverLiveState_staging')},
 {Effect:'Allow',Action:['dynamodb:Scan'],Resource:arn('WizzDispatchJobs_staging'),Condition:{StringEquals:{'dynamodb:Select':'SPECIFIC_ATTRIBUTES'},'ForAllValues:StringEquals':{'dynamodb:Attributes':['orderId','SK','kind','state','status','dispatchCycle']}}},
 {Effect:'Allow',Action:['dynamodb:PutItem','dynamodb:UpdateItem'],Resource:arn('WizzDispatchJobs_staging')},
 {Effect:'Allow',Action:['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:ConditionCheckItem'],Resource:arn('WaveOffers_staging')},
 {Effect:'Allow',Action:['dynamodb:UpdateItem'],Resource:arn('WizzOrders')},
 {Effect:'Allow',Action:['lambda:InvokeFunction'],Resource:'arn:aws:lambda:us-east-1:699561669180:function:WaveSystem_StartWave'}]};
fs.writeFileSync(path.join(out,'host-iam-proposal.json'),JSON.stringify(policy,null,2)+'\n');
const manifest={schemaVersion:1,stage:'staging',mode:'OFF',publicationReady:false,overlayOnly:true,newSchedule:false,existingSchedule:'WaveSystem_HandleWaveTimeout periodic EventBridge rule; ARN must be verified before activation',cycleModeRequired:'LEGACY_RESPONSES',scope:'Captured Legacy only; FINANCIAL remains excluded',sourceSha256:hashes,checkpoint:'WizzDispatchJobs_staging / SYSTEM#DISPATCH_HOST / CURSOR#LEGACY',scanLimit:25,requiredStagingTimeoutSeconds:60,invokeBudgetFloorMs:35000,coordinatorBundle:JSON.parse(fs.readFileSync(path.join(out,'manifest.json'))).sha256,blockers:['Fresh live-package comparison and precise overlay application','Role-specific IAM verification/grants and existing EventBridge rule binding','Coordinated StartWave, Timeout, Accept/Reject, push and source gates','Backlog/latency and actual provider/device verification before any activation']};
fs.writeFileSync(path.join(out,'host-manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
