'use strict';
// Generate exact, locally reviewable IAM documents; never calls AWS.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const yaml=require('../backend/wallet-service/node_modules/js-yaml');
const schema=yaml.FAILSAFE_SCHEMA.extend(['scalar','sequence','mapping'].map(kind=>new yaml.Type('!',{kind,multi:true,construct:data=>data})));
const root=path.resolve(__dirname,'..'),backup=process.argv[2],out=process.argv[3];
if(!backup||!out||!path.isAbsolute(backup)||!path.isAbsolute(out)||fs.existsSync(out))throw Error('Provide backup directory and a fresh absolute output directory');
const manifest=JSON.parse(fs.readFileSync(path.join(backup,'manifest.json')));
if(!manifest.complete||manifest.account!=='699561669180')throw Error('Completed staging backup required');
fs.mkdirSync(out,{mode:0o700});
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const changes=[];
function add(fn,name,doc,existing){
 const record=manifest.backups.find(r=>r.function===fn);if(!record)throw Error('Missing deployed role: '+fn);
 const policies=JSON.parse(fs.readFileSync(record.iamPolicies));
 const found=policies.inline.find(p=>p.PolicyName===name);
 if(existing?!found:!!found)throw Error('Unexpected existing-policy state: '+name);
 const destination=path.join(out,name+'.json');fs.writeFileSync(destination,JSON.stringify(doc,null,2)+'\n');
 changes.push({function:fn,roleName:record.roleName,policyName:name,operation:existing?'UPDATE_EXISTING_INLINE_POLICY':'ADD_INLINE_POLICY',document:destination,documentSha256:hash(doc),beforeDocumentSha256:found?hash(found.PolicyDocument):null,
 rollback:found?{operation:'RESTORE_BACKED_UP_INLINE_POLICY',backupFile:record.iamPolicies,policyName:name}:{operation:'DELETE_ADDED_INLINE_POLICY',roleName:record.roleName,policyName:name}});
}
function document(file){
 const parsed=yaml.load(fs.readFileSync(path.join(root,'backend/wallet-service',file),'utf8'),{schema});
 const doc=Object.values(parsed.Resources)[0].Properties.PolicyDocument;
 return JSON.parse(JSON.stringify(doc).replaceAll('${AWS::Partition}','aws').replaceAll('${AWS::Region}','us-east-1').replaceAll('${AWS::AccountId}','699561669180'));
}
add('order-receiver-regional-staging-discount-management-v1-sam','WizzBranchCatalogRead250',document('branch-product-pricing-access.yaml'),false);
add('staging-merchant-response-99','WizzOfferUsageRelease250',document('offer-usage-release-access.yaml'),false);
add('WizzUser-CancelOrder-staging','WizzFinancialCustomerCancel250',document('financial-customer-cancellation-access.yaml'),false);
const record=manifest.backups.find(r=>r.function==='WizzUser-ValidatePromoCode-staging');
const policies=JSON.parse(fs.readFileSync(record.iamPolicies));
const policy=policies.inline.find(p=>p.PolicyDocument.Statement.some(s=>s.Condition?.['ForAllValues:StringEquals']?.['dynamodb:Attributes']));
if(!policy)throw Error('Missing existing restricted-history policy');
const updated=JSON.parse(JSON.stringify(policy.PolicyDocument));
for(const s of updated.Statement){const attributes=s.Condition?.['ForAllValues:StringEquals']?.['dynamodb:Attributes'];if(attributes)for(const field of ['offerSnapshot','offerUsageRelease'])if(!attributes.includes(field))attributes.push(field);}
add(record.function,policy.PolicyName,updated,true);
const plan={createdAt:new Date().toISOString(),account:manifest.account,region:'us-east-1',applied:false,financialCancellationFlagChanged:false,
 requiresBeforeApply:['Confirm approval for these exact role-policy documents','Recheck current role policies against backed-up state','Verify no policy-name collisions or intervening edits'],changes};
fs.writeFileSync(path.join(out,'plan.json'),JSON.stringify(plan,null,2)+'\n');
console.log(JSON.stringify({plan:path.join(out,'plan.json'),changes:changes.length,applied:false}));
