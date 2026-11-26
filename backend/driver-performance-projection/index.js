'use strict';
const {LambdaClient,ListEventSourceMappingsCommand}=require('@aws-sdk/client-lambda');
const {CloudWatchClient,GetMetricDataCommand}=require('@aws-sdk/client-cloudwatch');
const {inspectSources}=require('./health');
const {performanceBindings}=require('./bindings');
const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');
const {SQSClient,GetQueueAttributesCommand,SendMessageCommand}=require('@aws-sdk/client-sqs');
const sdk=require('@aws-sdk/lib-dynamodb');
const {unmarshall}=require('@aws-sdk/util-dynamodb');
const {createWorker}=require('./worker');
const {readPerformance}=require('../../../whizzDrivers-stg/backend/driver-performance');
const {readIncidents}=require('../../../whizzDrivers-stg/backend/driver-quality-incidents-290');
let instance;
exports.handler=async event=>{
 if(!instance){
  const bindings=performanceBindings(process.env);
  const sqs=new SQSClient({region:'us-east-1'});
  const lambda=new LambdaClient({region:'us-east-1'});
  const cloudwatch=new CloudWatchClient({region:'us-east-1'});
  const sourceHealth=()=>process.env.ORDER_FORWARD_READY==='true'
   ?inspectSources({lambda,cloudwatch,sqs,collector:bindings.collector,expectedStreams:bindings.expectedStreams,
    queueUrl:process.env.FAILURE_QUEUE_URL,commands:{ListEventSourceMappingsCommand,GetMetricDataCommand,GetQueueAttributesCommand}})
   :Promise.resolve(false);
  instance=createWorker({
   ...bindings,
   enqueue:async ids=>{await Promise.all(ids.map(driverId=>sqs.send(new SendMessageCommand({
    QueueUrl:process.env.WORK_QUEUE_URL,MessageBody:JSON.stringify({driverId}),DelaySeconds:2,
   }))));},
   sourceHealth,
   db:sdk.DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),
   sdk:{...sdk,unmarshall},readPerformance,readIncidents,
  });
 }
 return instance.handle(event);
};
