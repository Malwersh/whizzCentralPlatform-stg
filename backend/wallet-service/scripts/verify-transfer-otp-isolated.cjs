const assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {DynamoDBClient,CreateTableCommand,DeleteTableCommand,waitUntilTableExists}=require('@aws-sdk/client-dynamodb');
const {CognitoIdentityProviderClient}=require('@aws-sdk/client-cognito-identity-provider');
const {SecretsManagerClient}=require('@aws-sdk/client-secrets-manager');
const {TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
process.env.AWS_REGION='us-east-1';process.env.AWS_PROFILE='Wizz_stg_UserApp';
const account=JSON.parse(execFileSync('aws',['sts','get-caller-identity','--profile','Wizz_stg_UserApp','--region','us-east-1','--output','json']));assert.equal(account.Account,'699561669180');
const table='staging-TransferOtpCheck-'+Date.now();process.env.IDEMPOTENCY_KEYS_TABLE=table;
const client=new DynamoDBClient({region:'us-east-1'});let created=false;
(async()=>{try{
 await client.send(new CreateTableCommand({TableName:table,BillingMode:'PAY_PER_REQUEST',AttributeDefinitions:[{AttributeName:'idempotencyKey',AttributeType:'S'},{AttributeName:'sk',AttributeType:'S'}],KeySchema:[{AttributeName:'idempotencyKey',KeyType:'HASH'},{AttributeName:'sk',KeyType:'RANGE'}]}));created=true;
 await waitUntilTableExists({client,maxWaitTime:90},{TableName:table});
 // Provider and identity are fake; no SMS, credential secret or live wallet touched.
 SecretsManagerClient.prototype.send=async()=>({SecretString:JSON.stringify({apiKey:'fake',hmacKey:'test-secret'})});
 CognitoIdentityProviderClient.prototype.send=async()=>({UserAttributes:[{Name:'sub',Value:'isolated-sender'},{Name:'phone_number',Value:'+9647800000000'},{Name:'phone_number_verified',Value:'true'}]});
 let deliveredCode;global.fetch=async(_url,req)=>{deliveredCode=JSON.parse(req.body).verificationCode;return {ok:true};};
 const {sendTransferCode,verifyTransferCode,transferVerification}=require('../dist/transferVerification');
 const {docClient}=require('../dist/db');
 const a={principalId:'isolated-sender',ownerId:'isolated-sender',walletId:'WALLET#DRIVER#isolated-sender',type:'DRIVER'},input={requestId:'00000000-0000-0000-0000-000000000001',recipientWalletId:'WALLET#CUSTOMER#isolated-recipient',amount:5000,reason:'isolated OTP verification'};
 const sent=await sendTransferCode(a,'fake',input);assert.ok(sent.challengeId);
 await assert.rejects(sendTransferCode(a,'fake',input),e=>e.name==='TransactionCanceledException');
 const wrong=deliveredCode==='000000'?'111111':'000000';await assert.rejects(verifyTransferCode(a,{...input,challengeId:sent.challengeId,code:wrong}),e=>e.code==='INVALID_VERIFICATION_CODE');
 const verified=await verifyTransferCode(a,{...input,challengeId:sent.challengeId,code:deliveredCode});
 const repeat=await verifyTransferCode(a,{...input,challengeId:sent.challengeId,code:deliveredCode});assert.equal(verified.verificationId,repeat.verificationId);
 const confirmed={...input,verificationId:verified.verificationId};await assert.rejects(transferVerification(a,{...confirmed,amount:6000},300),e=>e.code==='REAUTH_REQUIRED');
 const proof=await transferVerification(a,confirmed,300);await docClient.send(new TransactWriteCommand({TransactItems:[proof.guard]}));
 await assert.rejects(transferVerification(a,confirmed,300),e=>e.code==='REAUTH_REQUIRED');
 console.log('Isolated DynamoDB: send, cooldown, wrong code, verify, response-loss retry, changed amount and one-time consumption passed. No SMS or funds changed.');
}finally{if(created){await client.send(new DeleteTableCommand({TableName:table}));console.log('Isolated table deleted');}}})().catch(e=>{console.error(e.name,e.message);process.exitCode=1;});
