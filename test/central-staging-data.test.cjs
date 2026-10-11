const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function utilsContext() {
 const context = vm.createContext({ window: {}, console: {log(){}}, AWS: {} });
 vm.runInContext(fs.readFileSync('frontend/assets/js/aws-utils.js','utf8'), context);
 return { context, utils: context.window.AWSUtils };
}
test('scan includes later pages even when an intermediate page is empty', async () => {
 const {utils} = utilsContext(); const requests=[];
 const pages=[{Items:[{id:1}],LastEvaluatedKey:{id:1}},{Items:[],LastEvaluatedKey:{id:2}},{Items:[{id:3}]}];
 utils.getDynamoDBClient=async()=>({scan(args){requests.push(args);return {promise:async()=>pages.shift()};}});
 assert.deepEqual(JSON.parse(JSON.stringify(await utils.scanAll('WhizzDrivers_staging'))),[{id:1},{id:3}]);
 assert.equal(requests.length,3); assert.equal(requests[2].ExclusiveStartKey.id,2);
});
test('driver documents use a short lived signed URL for the private bucket', async()=>{
 const {utils,context}=utilsContext();let input;
 context.AWS.S3=function(){this.getSignedUrlPromise=async(op,args)=>{input={op,args};return 'https://signed.example/document';};};
 utils.getDynamoDBClient=async()=>({});
 assert.equal(await utils.resolveDriverDocument('s3://whizzdrivers-documents-staging-699561669180/drivers/driver/document.jpg'),'https://signed.example/document');
 assert.equal(input.args.Expires,300); assert.equal(input.op,'getObject');
 await assert.rejects(()=>utils.resolveDriverDocument('s3://whizzdrivers-documents-staging-699561669180/other/file.jpg'));
 assert.equal(await utils.resolveDriverDocument('javascript:alert(1)'),null);
});
test('customer page uses staging table and region page loads the AWS SDK',()=>{
 assert.doesNotMatch(fs.readFileSync('frontend/customers.js','utf8'),/WizzUser_users_dev/);
 assert.match(fs.readFileSync('frontend/pages/regions.html','utf8'),/aws-sdk-2/);
});
test('IAM data permissions belong to a separate admin role with group mapping',()=>{
 const yaml=fs.readFileSync('cloudformation/centralplatform-frontend-hosting.yaml','utf8');
 const basic=yaml.split('  CentralAuthRole:')[1].split('  CentralAdminDataRole:')[0];
 assert.doesNotMatch(basic,/dynamodb|s3:GetObject/);
 assert.match(yaml,/Value: admins\s+RoleARN: !GetAtt CentralAdminDataRole.Arn/);
 assert.match(yaml,/AmbiguousRoleResolution: Deny/);
 assert.match(yaml,/AllowAdminCreateUserOnly: true/);
});
