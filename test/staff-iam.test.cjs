const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');

test('default employee IAM role cannot administer Cognito identity or sync settings',()=>{
 const template=fs.readFileSync('cloudformation/centralplatform-frontend-hosting.yaml','utf8');
 const role=template.split('  CentralAuthRole:')[1].split('  CentralAdminDataRole:')[0];
 assert(!role.includes('cognito-identity:*'));
 assert(!role.includes('cognito-sync:*'));
 assert(!role.includes('dynamodb:'));
});


test('merchant discount listing grants the administrator role only a scan of its source table',()=>{
 const template=fs.readFileSync('cloudformation/centralplatform-frontend-hosting.yaml','utf8');
 const role=template.split('  CentralAdminDataRole:')[1].split('  IdentityPoolRoleAttachment:')[0];
 const policy=role.split('        - PolicyName: MerchantDiscountListing')[1].split('        - PolicyName: StagingAdministration')[0];
 assert(policy.includes('Action: [dynamodb:Scan]'));
 assert(policy.includes('table/WhizzMerchants_Discounts'));
 assert(!/dynamodb:(PutItem|UpdateItem|DeleteItem|\*)/.test(policy));
 const auth=template.split('  CentralAuthRole:')[1].split('  CentralAdminDataRole:')[0];
 assert(!auth.includes('MerchantDiscountListing'));
});
