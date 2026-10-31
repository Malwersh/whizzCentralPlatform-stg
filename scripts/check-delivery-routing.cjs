'use strict';
// Explicit live smoke check: one Directions request after coverage checks, no financial writes.
// Configure MAPBOX_SECRET_ARN with an existing staging secret; never pass a token on the command line.
const {DynamoDBClient}=require('../backend/wallet-service/node_modules/@aws-sdk/client-dynamodb');
const {DynamoDBDocumentClient}=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const {SecretsManagerClient}=require('../backend/wallet-service/node_modules/@aws-sdk/client-secrets-manager');
const {createStagingSecretDeliveryRouting}=require('../backend/wallet-service/dist/routingCredentials');
async function main(){
 if(process.env.AWS_PROFILE!=='Wizz_stg_UserApp')throw Error('STAGING_PROFILE_REQUIRED');
 const coords=process.argv.slice(2).map(Number);
 if(coords.length!==4||coords.some(n=>!Number.isFinite(n)))throw Error('FOUR_COORDINATES_REQUIRED');
 const dbClient=new DynamoDBClient({region:'us-east-1',maxAttempts:2});
 const secrets=new SecretsManagerClient({region:'us-east-1',maxAttempts:1});
 try{
  const routing=createStagingSecretDeliveryRouting({db:DynamoDBDocumentClient.from(dbClient),secrets,
   secretArn:process.env.MAPBOX_SECRET_ARN,profile:'driving',ttlSeconds:120,timeoutMs:15000,credentialTimeoutMs:3000});
  const result=await routing.getDeliveryRoute({latitude:coords[0],longitude:coords[1]},{latitude:coords[2],longitude:coords[3]});
  console.log(JSON.stringify({financialWrites:false,providerRequests:1,source:result.route.source,quality:result.route.quality,
   distanceMeters:result.route.distanceMeters,durationSeconds:result.route.durationSeconds,
   normalization:result.normalization,originRegionId:result.originCoverage.regionId,destinationRegionId:result.destinationCoverage.regionId}));
 }finally{dbClient.destroy();secrets.destroy();}
}
main().catch(e=>{console.error(JSON.stringify({error:e.code||'ROUTING_CHECK_FAILED'}));process.exitCode=1;});
