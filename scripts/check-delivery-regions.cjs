'use strict';
// Read-only verification against the existing staging reference. No provider calls or writes.
const {DynamoDBClient}=require('../backend/wallet-service/node_modules/@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient}=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const {createDynamoRegionCoverage}=require('../backend/wallet-service/dist/regionCoverage');
async function main(){
 if(process.env.AWS_PROFILE!=='Wizz_stg_UserApp')throw Error('STAGING_PROFILE_REQUIRED');
 const [latitude,longitude]=process.argv.slice(2).map(Number);
 if(process.argv.length!==4||!Number.isFinite(latitude)||!Number.isFinite(longitude))throw Error('LATITUDE_LONGITUDE_REQUIRED');
 const client=new DynamoDBClient({region:'us-east-1',maxAttempts:2});
 try{
  const resolve=createDynamoRegionCoverage({db:DynamoDBDocumentClient.from(client),tables:{regions:'WizzCentral_Regions',derived:'WizzCentral_RegionsDerived_staging',index:'WizzCentral_RegionIndex_staging'}});
  const match=await resolve({latitude,longitude});
  console.log(JSON.stringify({readOnly:true,matched:!!match,...(match?{regionId:match.regionId,regionPath:match.regionPath,referenceVersion:match.referenceVersion,cellId:match.cellId}:{})}));
 }finally{client.destroy();}
}
main().catch(e=>{console.error(JSON.stringify({readOnly:true,error:e.code||'REGION_CHECK_FAILED'}));process.exitCode=1;});
