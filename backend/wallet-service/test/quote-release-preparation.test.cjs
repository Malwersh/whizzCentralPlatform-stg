'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const {sha256,replaceOnce,patchLiveOrder}=require('../../../scripts/prepare-delivery-quote-order.cjs');
const {readTemplate,prepare}=require('../../../scripts/prepare-delivery-quote-release.cjs');
const central=path.resolve(__dirname,'../../..');
const customer=path.resolve(central,'../wizzuser-stg');
const local=fs.readFileSync(path.join(customer,'backend/src/functions/create-order/index.js'),'utf8');
function fakeLive(){return `const { v4: uuidv4 } = require('uuid');
        // If an auth token exists,
        let userSub = null;
        // Validate items array
        // CRITICAL BUSINESS RULE:
        const orderId = uuidv4();
        const deliveryFee = Math.round((body.deliveryFee || 10) * 1000);
        const unchangedDiscount = 'discount engine and counters preserved';
        console.log('Order to be created:', order);
            await dynamoDb.send(new TransactWriteCommand({TransactItems: [
                {Put: {TableName: TABLE_NAME, Item: order}}
            ]}));
        console.error('Error creating order:', error);
            statusCode: 500,
                errorName: error.name,
`;}
test('historical quote-only patch cannot bypass the adopted live audience and redemption contract',()=>{
 const source=fakeLive();assert.throws(()=>patchLiveOrder(source,local,sha256(source)),/LEGACY_QUOTE_PATCH_RETIRED/);
});
test('source drift and ambiguous anchors block preparation instead of guessing a patch',()=>{
 const source=fakeLive();assert.throws(()=>patchLiveOrder(source+'drift',local,sha256(source)),/LIVE_SOURCE_DIGEST_CHANGED/);
 const changed=source.replace('const orderId = uuidv4();','const orderId = changed();');
 assert.throws(()=>patchLiveOrder(changed,local,sha256(changed)),/LEGACY_QUOTE_PATCH_RETIRED/);
 assert.throws(()=>replaceOnce('a a','a','b'),/LIVE_SOURCE_ANCHOR_CHANGED/);
});
test('template rejects duplicate YAML keys and keeps the effective preexisting favorites schema',()=>{
 const app=readTemplate(path.join(customer,'backend/template.yaml'));
 const source=fs.readFileSync(path.join(customer,'backend/template.yaml'),'utf8');
 assert.equal((source.match(/^  FavoritesTable:/gm)||[]).length,1);
 assert.deepEqual(app.Resources.FavoritesTable.Properties.GlobalSecondaryIndexes.map(x=>x.IndexName),['userId-createdAt-index','userId-businessId-index']);
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'quote-yaml-'));
 try{const f=path.join(folder,'dup.yaml');fs.writeFileSync(f,'Resources:\n  Same: 1\n  Same: 2\n');assert.throws(()=>readTemplate(f),/duplicated/);}finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('new consumer policy cannot delete/create quotes or mutate pricing references, wallets or ledger',()=>{
 const app=readTemplate(path.join(customer,'backend/template.yaml'));
 const statements=app.Resources.CreateOrderFunction.Properties.Policies.find(p=>p['Fn::If']?.[0]==='IsQuoteStaging')['Fn::If'][1].Statement;
 const quote=statements.find(s=>s.Sid==='ConsumeDeliveryQuote');
 assert.deepEqual(quote.Action,['dynamodb:GetItem','dynamodb:UpdateItem','dynamodb:ConditionCheckItem']);
 assert.deepEqual(quote.Condition['ForAllValues:StringLike']['dynamodb:LeadingKeys'],['CUSTOMER#*']);
 assert.ok(statements.every(s=>!JSON.stringify(s.Resource).includes('Ledger')&&!JSON.stringify(s.Resource).includes('Wallet')));
 assert.deepEqual(statements.find(s=>s.Sid==='DeliveryQuoteReferenceFences').Action,['dynamodb:ConditionCheckItem']);
 const cleanup=readTemplate(path.join(central,'backend/account-deletion/template.yaml'));
 assert.equal(cleanup.Parameters.DeliveryQuotesEnabled.Default,'false');
 assert.deepEqual(cleanup.Resources.Worker.Properties.Policies[0].Statement[0].Action,['dynamodb:Query','dynamodb:DeleteItem']);
 assert.equal(app.Resources.CreateOrderFunction.Properties.Environment.Variables.DELIVERY_QUOTE_MODE,'OFF');
 const dedicated=readTemplate(path.join(central,'backend/wallet-service/delivery-quotes.staging.json'));
 assert.equal(app.Resources.DeliveryQuotesFunction,undefined);
 assert.equal(dedicated.Resources.DeliveryQuotesFunction.Properties.Environment.Variables.DELIVERY_QUOTES_ENABLED,'false');
 assert.equal(dedicated.Resources.DeliveryQuotesFunction.Properties.Environment.Variables.DELIVERY_QUOTE_MAX_PER_MINUTE,'5');
 const quotaPolicy=dedicated.Resources.DeliveryQuoteRole.Properties.Policies[0].PolicyDocument.Statement.find(s=>s.Resource?.['Fn::GetAtt']?.[0]==='DeliveryQuotes');
 assert.ok(quotaPolicy.Action.includes('dynamodb:PutItem'));assert.ok(!quotaPolicy.Action.includes('dynamodb:DeleteItem'));
 assert.deepEqual(quotaPolicy.Condition['ForAllValues:StringLike']['dynamodb:LeadingKeys'],['CUSTOMER#*']);
});
test('preparation refuses foreign account evidence before writing an output directory',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'quote-evidence-'));
 try{const f=path.join(folder,'inspection.json');fs.writeFileSync(f,JSON.stringify({accountId:'031857856164',region:'us-east-1',readOnly:true}));
  const output=path.join(folder,'result');assert.throws(()=>prepare({inspectionFile:f,liveDirectory:folder,outputDirectory:output}),/STAGING_EVIDENCE_REQUIRED/);assert.equal(fs.existsSync(output),false);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
function archive(request){return JSON.parse(cp.execFileSync('python3',[path.join(central,'scripts/quote-release-archive.py')],{input:JSON.stringify(request),encoding:'utf8'}));}
test('archive candidate preserves every unmodified binary file and never overwrites the live package',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'quote-archive-'));
 try{
  const original=path.join(folder,'live.zip'),replacement=path.join(folder,'next.js');fs.writeFileSync(replacement,'new handler');
  cp.execFileSync('python3',['-c',"import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],'w');z.writestr('handler.js','old handler');z.writestr('keep.bin',bytes([0,255,1,0]));z.close()",original]);
  const expected=require('node:crypto').createHash('sha256').update(fs.readFileSync(original)).digest('base64');
  const r=archive({mode:'patch',source:original,destination:path.join(folder,'candidate.zip'),expectedCodeSha256:expected,replacements:{'handler.js':replacement},additions:{'extra.js':replacement}});
  assert.equal(r.preservedFiles,1);assert.deepEqual(r.replacedFiles,['handler.js']);assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(original)).digest('base64'),expected);
  assert.throws(()=>archive({mode:'patch',source:original,destination:original,expectedCodeSha256:expected,replacements:{},additions:{}}));
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('tampered package checksum and traversal names are rejected before candidate creation',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'quote-unsafe-'));
 try{
  const original=path.join(folder,'bad.zip'),out=path.join(folder,'result.zip');
  cp.execFileSync('python3',['-c',"import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],'w');z.writestr('../unsafe','x');z.close()",original]);
  const expected=require('node:crypto').createHash('sha256').update(fs.readFileSync(original)).digest('base64');
  for(const hash of ['tampered',expected])assert.throws(()=>archive({mode:'patch',source:original,destination:out,expectedCodeSha256:hash,replacements:{},additions:{}}));
  assert.equal(fs.existsSync(out),false);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});

test('legacy Quote-only release tool cannot silently publish a partial commercial writer',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'commercial-release-'));
 try{const file=path.join(folder,'inspection.json');fs.writeFileSync(file,JSON.stringify({accountId:'699561669180',region:'us-east-1',readOnly:true,apiId:'4jut6787c8'}));
 const out=path.join(folder,'out');assert.throws(()=>prepare({inspectionFile:file,liveDirectory:folder,outputDirectory:out}),/COMMERCIAL_RELEASE_REVIEW_REQUIRED/);assert.equal(fs.existsSync(out),false);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
test('commercial writer is opt-in with a separate authenticated preview and restricted platform funding permissions',()=>{
 const app=readTemplate(path.join(customer,'backend/template.yaml'));
 assert.equal(app.Parameters.EnableCommercialPricing.Default,'false');
 const props=app.Resources.CreateOrderFunction.Properties;
 assert.deepEqual(props.Environment.Variables.COMMERCIAL_PRICING_MODE['Fn::If'],['IsCommercialStaging','REQUIRED','OFF']);
 const statements=props.Policies.find(p=>p['Fn::If']?.[0]==='IsCommercialStaging')['Fn::If'][1].Statement;
 const wallet=statements.find(p=>p.Sid==='ReservePlatformPromotionFunds');
 assert.deepEqual(wallet.Action,['dynamodb:GetItem','dynamodb:UpdateItem']);
 assert.deepEqual(wallet.Condition['ForAllValues:StringEquals']['dynamodb:LeadingKeys'],['WALLET#PLATFORM']);
 assert.ok(statements.every(p=>!p.Action.includes('dynamodb:DeleteItem')));
 const dedicated=readTemplate(path.join(central,'backend/wallet-service/delivery-quotes.staging.json'));
 assert.equal(app.Resources.WizzUserFoodAppApi.Properties.Mode,'merge');
 assert.equal(app.Resources.WizzUserFoodAppApi.Properties.DefinitionBody.paths['/orders/commercial-preview'],undefined);
 const preview=dedicated.Resources.PreviewPostMethod.Properties;
 assert.equal(preview.AuthorizationType,'COGNITO_USER_POOLS');
 assert.deepEqual(preview.AuthorizationScopes,['aws.cognito.signin.user.admin']);
 assert.ok(JSON.stringify(preview.Integration.Uri).includes('WizzUser-CreateOrder-staging'));
});
