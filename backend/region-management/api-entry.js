'use strict';
const {SQSClient,SendMessageCommand}=require('@aws-sdk/client-sqs');
const service=require('./service');
const queue=new SQSClient({});
async function route(ctx,actor,method,path,input){
 if(process.env.PLATFORM_ENVIRONMENT!=='staging'||process.env.REGION_MANAGEMENT_ENABLED!=='true')throw Object.assign(Error('REGION_MANAGEMENT_UNAVAILABLE'),{code:'REGION_MANAGEMENT_UNAVAILABLE',status:503});
 if(path.endsWith('/publish')&&process.env.REGION_COMPOSITE_READERS_READY!=='true')throw Object.assign(Error('REGION_READERS_NOT_READY'),{code:'REGION_READERS_NOT_READY',status:503});
 return service.route({...ctx,enqueue:async jobId=>queue.send(new SendMessageCommand({QueueUrl:process.env.REGION_PUBLICATION_QUEUE_URL,MessageBody:JSON.stringify({jobId})}))},actor,method,path,input);
}
module.exports={route};
