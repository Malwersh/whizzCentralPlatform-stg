'use strict';
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const sdk=require('@aws-sdk/lib-dynamodb');
const {SQSClient,SendMessageCommand}=require('@aws-sdk/client-sqs');
const {allowed}=require('../staff-service/catalog');
const {make}=require('./worker');
const db=sdk.DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}}),sqs=new SQSClient({});
const enqueue=jobId=>sqs.send(new SendMessageCommand({QueueUrl:process.env.REGION_PUBLICATION_QUEUE_URL,MessageBody:JSON.stringify({jobId}),DelaySeconds:2}));
exports.handler=async(event,context)=>{
 if(process.env.PLATFORM_ENVIRONMENT!=='staging'||process.env.REGION_MANAGEMENT_ENABLED!=='true'||process.env.REGION_COMPOSITE_READERS_READY!=='true')throw Error('REGION_MANAGEMENT_UNAVAILABLE');
 const worker=make({db,sdk,table:process.env.STAFF_TABLE,allowed,enqueue,deadline:()=>Date.now()+Math.min(45000,context.getRemainingTimeInMillis()-5000)});
 if(event?.source==='aws.events'&&event['detail-type']==='Scheduled Event'&&event.resources?.length===1&&event.resources[0]===process.env.REGION_RECOVERY_RULE_ARN)return worker.tick();
 if(!Array.isArray(event?.Records)||!event.Records.length)throw Error('REGION_WORKER_SOURCE_INVALID');
 const failures=[];
 for(const record of event.Records){try{
  if(record.eventSource!=='aws:sqs'||record.eventSourceARN!==process.env.REGION_PUBLICATION_QUEUE_ARN)throw Error('REGION_WORKER_SOURCE_INVALID');
  const body=JSON.parse(record.body);if(Object.keys(body).join(',')!=='jobId'||!/^RP_[a-f0-9]{40}$/.test(body.jobId))throw Error('REGION_JOB_INVALID');
  await worker.run(body.jobId);
 }catch(error){console.error('REGION_PUBLICATION_WORKER_FAILED',{messageId:record.messageId,code:error.code||error.name});failures.push({itemIdentifier:record.messageId});}}
 return {batchItemFailures:failures};
};
