// Temporary read-only probe using the existing routing and coverage implementations.
import {SecretsManagerClient} from '../backend/wallet-service/node_modules/@aws-sdk/client-secrets-manager';
import {DynamoDBClient} from '../backend/wallet-service/node_modules/@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,QueryCommand} from '../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb';
import {createMapboxSecretReader} from '../backend/wallet-service/src/routingCredentials';
import {createMapboxRoadRouter} from '../backend/wallet-service/src/roadRouting';
import {createDynamoRegionCoverage} from '../backend/wallet-service/src/regionCoverage';
export async function handler(event:unknown){
 if(!event||typeof event!=='object'||Object.keys(event).length)throw Error('EMPTY_PROBE_REQUIRED');
 try{
  const geometry=JSON.parse(process.env.ROUTING_PROBE_GEOMETRY!);
  const getAccessToken=createMapboxSecretReader({secrets:new SecretsManagerClient({region:'us-east-1'}),secretArn:process.env.ROUTING_PROBE_SECRET_ARN!,accountId:'699561669180',region:'us-east-1',timeoutMs:2000});
  const router=createMapboxRoadRouter({getAccessToken,profile:'driving',ttlSeconds:120,timeoutMs:8000});
  const route=await router.getRoute(geometry.origin,geometry.destination);
  let coverage:any=null;
  if(process.env.ROUTING_PROBE_COVERAGE==='true'){
   const client=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}));
   const db={send:(command:any)=>{if(!(command instanceof GetCommand)&&!(command instanceof QueryCommand))throw Error('READ_ONLY_PROBE');return client.send(command);}};
   const resolve=createDynamoRegionCoverage({db,tables:{regions:'WizzCentral_Regions',derived:'WizzCentral_RegionsDerived_staging',index:'WizzCentral_RegionIndex_staging'}});
   try{const [a,b]=await Promise.all([resolve(geometry.origin),resolve(geometry.destination)]);coverage={originCovered:!!a,destinationCovered:!!b};}catch(error:any){coverage={code:error.code||'COVERAGE_PROBE_FAILED'};}finally{client.destroy();}
  }
  return {routingReady:true,provider:route.route.source,quality:route.route.quality,distanceMeters:route.route.distanceMeters,durationSeconds:route.route.durationSeconds,measuredAt:route.route.measuredAt,expiresAt:route.route.expiresAt,testGeometryOnly:true,driverPositionFreshnessProven:false,financialWrites:0,coverage};
 }catch(error:any){return {routingReady:false,code:error.code||'ROUTING_PROBE_FAILED',financialWrites:0};}
}
