const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),ts=require('../backend/wallet-service/node_modules/typescript');
const source=fs.readFileSync('../whizzDrivers-stg/backend/lambda_driver_api_v2.js','utf8'),ast=ts.createSourceFile('api',source,99,true);let code;
function find(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='updateLocation')code=n.getText(ast);ts.forEachChild(n,find);}find(ast);assert(code);
class GetCommand{constructor(input){this.input=input;}}class TransactWriteCommand{constructor(input){this.input=input;}}
async function run({busy=false,allowed=true,race=false,unknown=false}={}){
 const live={driverId:'d',status:busy?'busy':'available',isActive:true,isSearching:!busy,currentOrderId:busy?'order':null,activeOrdersCount:busy?1:0,current_work_region_id:'work'};
 let writes=0,saved,permissionCalls=0;
 const ctx={GetCommand,TransactWriteCommand,DRIVER_LIVE_STATE_TABLE:'live',DRIVERS_TABLE:'drivers',require:()=>require('../backend/shared/driver-vehicles-308'),
  dynamodb:{send:async c=>{if(c instanceof GetCommand)return {Item:structuredClone(c.input.TableName==='live'?live:{driverId:'d',work_region_id:'work'})};writes++;saved=c.input.TransactItems;
   if(race)throw Object.assign(Error('race'),{name:'TransactionCanceledException'});return {}; }},
  determineRegionFromCoordinates:async()=>unknown?null:{region_id:'other',region_name:'Other'},
  checkDriverRegionPermission:async()=>{permissionCalls++;return {allowed,guards:[],code:'DRIVER_WORK_REGION_NOT_ALLOWED'};}};
 vm.runInNewContext(code+';this.run=updateLocation',ctx);const response=await ctx.run('d',{lat:31,lng:44},{});
 return {response,body:JSON.parse(response.body),writes,saved,permissionCalls};
}
(async()=>{
 const active=await run({busy:true,allowed:false});assert.equal(active.response.statusCode,200);assert.equal(active.permissionCalls,0);assert.equal(active.saved.length,1);const write=active.saved[0].Update;assert(!Object.values(write.ExpressionAttributeNames).includes('allowed_region_ids'));assert(!write.UpdateExpression.includes('stop'));assert(write.ConditionExpression.includes('#f5')); // activeOrdersCount fenced
 const denied=await run({allowed:false});assert.equal(denied.response.statusCode,403);assert.equal(denied.body.searching_stopped,true);assert(Object.values(denied.saved.at(-1).Update.ExpressionAttributeValues).includes('offline'));
 const unknown=await run({unknown:true});assert.equal(unknown.body.searching_stopped,true);assert.equal(unknown.body.location_updated,true);
 const good=await run();assert.equal(good.response.statusCode,200);assert.equal(good.body.searching_stopped,false);
 const race=await run({allowed:false,race:true});assert.equal(race.response.statusCode,409);assert.equal(race.body.success,false);
 console.log('PASS actual updateLocation: preserve active delivery, stop only new search, unknown region, permitted move, atomic acceptance race');
})().catch(e=>{console.error(e);process.exitCode=1;});
