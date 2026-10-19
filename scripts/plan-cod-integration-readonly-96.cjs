// Read-only diagnostic. All transaction writes are intercepted before any AWS send.
const fs=require('fs'),Module=require('module'),path=require('path');
const root=process.cwd(),base=path.join(root,'backend/wallet-service/dist/codIntegration.js');
let source=fs.readFileSync(base,'utf8');const needle='catch (error) {';const i=source.indexOf(needle);if(i<0)throw Error('DIAGNOSTIC_SOURCE_DRIFT');source=source.slice(0,i)+source.slice(i).replace(needle,needle+" console.error('READ_ONLY_CAUSE',error.code??error.name); ");
const mod=new Module(base,module);mod.filename=base;mod.paths=Module._nodeModulePaths(path.dirname(base));mod._compile(source,base);
const {DynamoDBClient}=require('../backend/wallet-service/node_modules/@aws-sdk/client-dynamodb'),{DynamoDBDocumentClient,TransactWriteCommand}=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const actual=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'})),plans=[];
const readOnly={send:async command=>{if(command instanceof TransactWriteCommand){plans.push(command.input);throw Object.assign(Error('WRITE_INTERCEPTED'),{code:'READ_ONLY_WRITE_INTERCEPTED'});}return actual.send(command);}};
const db=require('../backend/wallet-service/dist/financeRollout').createFinanceRollout({db:readOnly}).db;
const event=JSON.parse(fs.readFileSync('/private/tmp/finance96/acceptance-event.private.json'));
mod.exports.createStagingCodIntegration({db,now:()=>Math.max(Date.now(),Number(event.nextAttemptAt)*1000+1),notificationDelivery:'HELD'}).processEvent(event.operationId)
.then(result=>{fs.writeFileSync('/private/tmp/finance96/integration-plans.private.json',JSON.stringify(plans),{mode:0o600});console.log(JSON.stringify({readOnly:true,awsWrites:0,capturedTransactions:plans.length,result}));})
.catch(e=>{fs.writeFileSync('/private/tmp/finance96/integration-plans.private.json',JSON.stringify(plans),{mode:0o600});console.log(JSON.stringify({readOnly:true,awsWrites:0,capturedTransactions:plans.length,error:e.code??e.name}));});
