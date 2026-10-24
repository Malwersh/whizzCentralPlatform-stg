// Appended only to the captured published bundle in a disposable, non-HTTP Lambda.
// Calls the bundle's existing routing factories. No orders, people, offers or funds.
module.exports.routingProbe=async(event)=>{
 if(process.env.STAGE!=='staging'||event?.probeId!==process.env.PROBE_ID)throw Error('INVALID_ROUTING_PROBE');
 const {SecretsManagerClient,GetSecretValueCommand}=require('@aws-sdk/client-secrets-manager');
 const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
 const {DynamoDBDocumentClient}=require('@aws-sdk/lib-dynamodb');
 const secrets=process.env.PROBE_KIND==='wave'?new import_client_secrets_manager2.SecretsManagerClient({region:'us-east-1',maxAttempts:1}):new SecretsManagerClient({region:'us-east-1',maxAttempts:1});
 const credentialFailures=[];const watchedSecrets={send:async(...args)=>{try{return await secrets.send(...args);}catch(e){credentialFailures.push(e.name||'CREDENTIAL_READ_FAILED');throw e;}}};
 const low=new DynamoDBClient({region:'us-east-1',maxAttempts:1});let providerRequests=0;
 const fetchImpl=(...args)=>{if(++providerRequests>1)throw Error('PROVIDER_REQUEST_LIMIT');return fetch(...args);};
 try{
  let denied=false;
  try{await secrets.send(new GetSecretValueCommand({SecretId:process.env.PROBE_SECRET_ARN+'-foreign',VersionStage:'AWSCURRENT'}));}
  catch(e){denied=e.name==='AccessDeniedException';}
  if(!denied)throw Error('FOREIGN_SECRET_NOT_DENIED');
  const options={secrets:watchedSecrets,secretArn:process.env.PROBE_SECRET_ARN,accountId:'699561669180',region:'us-east-1',timeoutMs:1500};
  const from={latitude:31.9256092,longitude:44.45708},to={latitude:31.929,longitude:44.46};
  let route,coverage;
  if(process.env.PROBE_KIND==='quote'){
   const router=createStagingSecretDeliveryRouting({db:DynamoDBDocumentClient.from(low),secrets:watchedSecrets,secretArn:options.secretArn,profile:'driving',ttlSeconds:120,timeoutMs:8000,credentialTimeoutMs:2000,fetchImpl});
   const result=await router.getDeliveryRoute(from,to);route=result.route;
   coverage={originRegionId:result.originCoverage.regionId,destinationRegionId:result.destinationCoverage.regionId,revalidatedAfterProvider:true};
  }else if(process.env.PROBE_KIND==='wave'){
   const router=createMapboxRoadRouter({getAccessToken:createMapboxSecretReader(options),profile:'driving',ttlSeconds:60,timeoutMs:5000,fetchImpl});route=(await router.getRoute(from,to)).route;
  }else throw Error('INVALID_ROUTING_PROBE_KIND');
  return {ok:true,foreignSecretDenied:true,secretRead:true,publishedFactory:true,providerRequests,source:route.source,quality:route.quality,distanceMeters:route.distanceMeters,durationSeconds:route.durationSeconds,...(coverage?{coverage}:{}),financialWrites:0,humanRowsRead:false};
 }catch(e){return {ok:false,code:e.code||(['FOREIGN_SECRET_NOT_DENIED','INVALID_ROUTING_PROBE_KIND','PROVIDER_REQUEST_LIMIT'].includes(e.message)?e.message:'ROUTING_PROBE_FAILED'),providerRequests,credentialFailures};}
 finally{secrets.destroy();low.destroy();}
};
