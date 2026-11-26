const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');

test('default employee IAM role cannot administer Cognito identity or sync settings',()=>{
 const template=fs.readFileSync('cloudformation/centralplatform-frontend-hosting.yaml','utf8');
 const role=template.split('  CentralAuthRole:')[1].split('  CentralAdminDataRole:')[0];
 assert(!role.includes('cognito-identity:*'));
 assert(!role.includes('cognito-sync:*'));
 assert(!role.includes('dynamodb:'));
});
