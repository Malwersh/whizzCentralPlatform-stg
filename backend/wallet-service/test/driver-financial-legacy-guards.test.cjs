const {test}=require('node:test'),assert=require('node:assert/strict');
const {mockClient}=require('aws-sdk-client-mock');
const {DynamoDBDocumentClient,GetCommand,QueryCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {HoldService}=require('../dist/holdService');
const {lifecycleDecision}=require('../dist/walletLifecycle');
const hold={orderId:'order1',sk:'HOLD',holdId:'FH:one',walletId:'WALLET#DRIVER#driver1',amount:10500,status:'ACTIVE',financialSchemaVersion:2};
test('generic hold creation, release and capture cannot mutate a financial hold',async()=>{
 const sdk=mockClient(DynamoDBDocumentClient);
 try{sdk.on(GetCommand).resolves({Item:hold});sdk.on(QueryCommand).resolves({Items:[hold]});
 const service=new HoldService();
 for(const run of [()=>service.createHold({walletId:hold.walletId,amount:hold.amount,orderId:hold.orderId}),
  ()=>service.releaseHold({holdId:hold.holdId}),()=>service.captureHold({holdId:hold.holdId,actualAmount:hold.amount})]){
  await assert.rejects(run(),/FINANCIAL_HOLD_REQUIRES_ORDER_SETTLEMENT/);
 }
 assert.equal(sdk.commandCalls(TransactWriteCommand).length,0);
 }finally{sdk.restore();}
});
test('old lifecycle capture and automatic cancellation release are blocked for schema-2 holds',()=>{
 for(const status of ['delivered','completed','canceled','reassigning','assigned'])assert.deepEqual(lifecycleDecision(hold,{status,driverId:'driver1',holdId:hold.holdId}),{action:'REVIEW',reason:'FINANCIAL_HOLD_REQUIRES_ORDER_SETTLEMENT'});
});

test('legacy fee settlement rejects schema-2 holds even if status was changed to CAPTURED',async()=>{
 const sdk=mockClient(DynamoDBDocumentClient);
 try{sdk.on(GetCommand).resolves({Item:{...hold,status:'CAPTURED'}});
 const {SettlementService}=require('../dist/settlementService');
 await assert.rejects(new SettlementService().settleOrder({orderId:'order1',driverId:'driver1',platformFeeAmount:100,settledBy:'test'}),/FINANCIAL_HOLD_REQUIRES_ORDER_SETTLEMENT/);
 assert.equal(sdk.commandCalls(TransactWriteCommand).length,0);
 }finally{sdk.restore();}
});
