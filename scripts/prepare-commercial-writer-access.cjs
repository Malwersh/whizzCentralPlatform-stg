'use strict';
// Review-only extraction from the existing owner SAM template; no second hand-maintained grant list.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readTemplate}=require('./prepare-delivery-quote-release.cjs');
function prepare(){
 const file=path.resolve(__dirname,'../../wizzuser-stg/backend/template.yaml'),template=readTemplate(file);
 const policies=template.Resources.CreateOrderFunction.Properties.Policies;
 const names=['IsCommercialStaging','IsQuoteStaging'];
 const statements=names.flatMap(name=>{const matches=policies.filter(x=>x['Fn::If']?.[0]===name);if(matches.length!==1)throw Error('AMBIGUOUS_WRITER_POLICY');return matches[0]['Fn::If'][1].Statement;});
 if(statements.length!==10||new Set(statements.map(s=>s.Sid)).size!==10)throw Error('WRITER_POLICY_DRIFT');
 for(const s of statements){if(s.Effect!=='Allow'||!Array.isArray(s.Action)||s.Action.some(a=>!['dynamodb:GetItem','dynamodb:UpdateItem','dynamodb:PutItem','dynamodb:ConditionCheckItem'].includes(a)))throw Error('UNREVIEWED_WRITER_ACTION');const resources=Array.isArray(s.Resource)?s.Resource:[s.Resource];if(resources.some(r=>typeof r!=='string'||!r.startsWith('arn:aws:dynamodb:us-east-1:699561669180:table/')||r.includes('*')))throw Error('UNREVIEWED_WRITER_RESOURCE');}
 return {schemaVersion:1,account:'699561669180',region:'us-east-1',status:'REVIEW_ONLY_NOT_ATTACHED',sourceTemplate:'wizzuser-stg/backend/template.yaml',sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),financialActivation:'OFF',document:{Version:'2012-10-17',Statement:statements}};
}
module.exports={prepare};if(require.main===module)process.stdout.write(JSON.stringify(prepare(),null,2)+'\n');
