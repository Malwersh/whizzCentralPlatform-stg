'use strict';
// Repository-only handoff audit. Builds dependency graphs in memory; never loads
// runtime bundles, contacts AWS, edits historical bundles, or changes flags.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const esbuild=require('../backend/wallet-service/node_modules/esbuild');
const root=path.resolve(__dirname,'..'),sourceDir=path.join(root,'backend/wallet-service/src');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const sourceNames=['deliveryFundedAllocation','deliveryCampaignBudget','deliveryFundingComposition','fullCashCompletion','codCompletion','fullCashRelease','financialRelease','deliveryFundingRetention','exceptionFinancials'];
const originalFive=new Set(['deliveryAgreementCompositionRuntime','deliveryQuoteRuntime','customerCashRuntime266','driverFinancialRuntime','merchantResponseRuntime']);
const sourceConsumers=[];
for(const entry of fs.readdirSync(sourceDir).filter(n=>/Runtime\d*\.ts$/.test(n)).sort()){
 const built=esbuild.buildSync({absWorkingDir:root,entryPoints:['backend/wallet-service/src/'+entry],bundle:true,platform:'node',target:'node20',packages:'external',write:false,metafile:true,logLevel:'silent'});
 const inputs=new Set(Object.values(built.metafile.outputs).flatMap(o=>Object.entries(o.inputs).filter(([,v])=>v.bytesInOutput>0).map(([n])=>n.replaceAll('\\','/'))));
 const components=sourceNames.filter(n=>inputs.has('backend/wallet-service/src/'+n+'.ts'));
 if(!components.some(n=>['deliveryFundedAllocation','deliveryCampaignBudget'].includes(n)))continue;
 if(!components.includes('deliveryFundingComposition'))throw Error('COMPOSITION_DEPENDENCY_MISSING:'+entry);
 sourceConsumers.push({entry:'backend/wallet-service/src/'+entry,inOriginalFiveArtifactBuilder:originalFive.has(entry.replace(/\.ts$/,'')),components});
}
const historicalSnapshots=[];
const snapshots=execFileSync('git',['ls-files','backend/shared'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(n=>n.endsWith('.js'));
for(const file of snapshots){
 const bytes=fs.readFileSync(path.join(root,file)),s=bytes.toString();
 if(!s.includes('createStagingDeliveryCampaignBudget')&&!s.includes('allocateDeliveryFundedOrder'))continue;
 historicalSnapshots.push({file,sha256:hash(bytes),containsEmbeddedBudgetBridge:s.includes('createStagingDeliveryCampaignBudget'),containsEmbeddedAllocationReader:s.includes('allocateDeliveryFundedOrder'),containsCompositionValidatorMarker:s.includes('INVALID_DELIVERY_FUNDING_COMPOSITION'),requiresHostAndOverlayReview:true});
}
const report={schemaVersion:1,scope:'LOCAL_REPOSITORY_ONLY',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),awsCalled:false,awsConfigurationChanged:false,deploymentPerformed:false,historicalBundlesModified:false,sourceConsumers,historicalSnapshots,summary:{sourceConsumers:sourceConsumers.length,sourceEntriesOutsideOriginalFive:sourceConsumers.filter(n=>!n.inOriginalFiveArtifactBuilder).map(n=>n.entry),historicalSnapshotsWithoutValidatorMarker:historicalSnapshots.filter(n=>!n.containsCompositionValidatorMarker).map(n=>n.file)},interpretation:['Fresh source graphs contain the composition verifier wherever they include funding allocation or budget settlement.','The original five offline bundles do not cover every possible host or runtime entry.','Missing marker identifies an older embedded implementation needing review, not proof that a deployed route currently calls it.','A marker alone does not prove complete host compatibility; inspect exports, wrappers, module bindings and original atomic transactions.','Actual Lambda package versions, active routes and feature gates were not queried. Coordinated deployment and staging acceptance remain with the colleague.']};
process.stdout.write(JSON.stringify(report,null,2)+'\n');
