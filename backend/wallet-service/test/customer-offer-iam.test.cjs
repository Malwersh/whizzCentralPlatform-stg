const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const yaml=require('js-yaml');
const schema=yaml.FAILSAFE_SCHEMA.extend(['scalar','sequence','mapping'].map(kind=>new yaml.Type('!',{kind,multi:true,construct:data=>data})));
const supplemental=yaml.load(fs.readFileSync(path.join(__dirname,'../customer-offer-read-access.yaml'),'utf8'),{schema});
const existing=require('../../../../wizzuser-stg/backend/offer-journey-template.json');
const {history}=require('../../../../wizzuser-stg/backend/src/functions/shared/offer-eligibility');
async function actualHistoryFields(){let request;await history({send:async command=>{request=command.input;return {Items:[]};}},'subject','customer');return {request,fields:[...request.ProjectionExpression.split(','),'userSub','userId']};}

test('every restricted offer-history policy allows the live history projection and filter fields',async()=>{
 const {request,fields}=await actualHistoryFields();assert.equal(request.Select,'SPECIFIC_ATTRIBUTES');assert.equal(request.ConsistentRead,true);
 const rules=[...Object.values(existing.Resources).filter(r=>r.Type==='AWS::IAM::Policy').flatMap(r=>r.Properties.PolicyDocument.Statement),...supplemental.Resources.CustomerOfferReadAccess.Properties.PolicyDocument.Statement];
 const scans=rules.filter(s=>s.Action.includes('dynamodb:Scan')&&s.Condition?.['ForAllValues:StringEquals']?.['dynamodb:Attributes']);
 assert.ok(scans.length>=3);
 for(const rule of scans){const allowed=rule.Condition['ForAllValues:StringEquals']['dynamodb:Attributes'];assert.ok(fields.every(f=>allowed.includes(f)));assert.ok(!allowed.includes('deliveryAddress'));assert.ok(!allowed.includes('customerPhone'));}
});
test('supplemental listing and preview access cannot write campaigns, wallets or usage',()=>{
 const statements=supplemental.Resources.CustomerOfferReadAccess.Properties.PolicyDocument.Statement;
 for(const s of statements)for(const action of s.Action)assert.ok(['dynamodb:GetItem','dynamodb:Query','dynamodb:Scan'].includes(action));
 const historyScan=statements.find(s=>s.Action.includes('dynamodb:Scan')&&s.Resource.endsWith('/WizzOrders'));
 assert.equal(historyScan.Condition.StringEquals['dynamodb:Select'],'SPECIFIC_ATTRIBUTES');
 const journey=statements.find(s=>typeof s.Resource==='string'&&s.Resource.endsWith('/staging-WizzOfferJourney'));
 assert.deepEqual(journey.Condition['ForAllValues:StringLike']['dynamodb:LeadingKeys'],['USER#*']);
});
