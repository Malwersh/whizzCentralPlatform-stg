const AWS = require('aws-sdk');
const https = require('https');
const crypto = require('crypto');

AWS.config.credentials = new AWS.SharedIniFileCredentials({ profile: 'Wizz_dev_UserApp' });
AWS.config.region = 'us-east-1';

const lambda = new AWS.Lambda();

const payload = {
  version: '1',
  region: 'us-east-1',
  userPoolId: 'us-east-1_Mnrmklxro',
  userName: 'e4c82408-d0f1-701e-94cf-ba031f42d9d4',
  callerContext: {
    awsSdkVersion: 'manual',
    clientId: '4dkt45gole08kurh0o43rvk8q7'
  },
  triggerSource: 'PostConfirmation_ConfirmSignUp',
  request: {
    userAttributes: {
      sub: 'e4c82408-d0f1-701e-94cf-ba031f42d9d4',
      email: 'moal.daash@gmail.com',
      email_verified: 'true'
    }
  },
  response: {}
};

lambda.invoke({
  FunctionName: 'dev-wizz-wallet-creation-trigger',
  InvocationType: 'RequestResponse',
  Payload: JSON.stringify(payload)
}, (err, data) => {
  if (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
  
  console.log('✅ Lambda invoked successfully');
  console.log('Status Code:', data.StatusCode);
  console.log('Response:', data.Payload);
  
  if (data.FunctionError) {
    console.error('❌ Function Error:', data.FunctionError);
  }
});
