'use strict';
async function inspectSources({lambda,cloudwatch,sqs,commands,queueUrl,now=Date.now(),collector='staging-driver-performance-collector',expectedStreams}){
 const mappings=await lambda.send(new commands.ListEventSourceMappingsCommand({FunctionName:collector}));
 const enabled=(mappings.EventSourceMappings||[]).filter(m=>m.State==='Enabled');
 if(enabled.length!==4||expectedStreams?.some(arn=>!enabled.some(m=>m.EventSourceArn===arn)))return false;
 const queue=await sqs.send(new commands.GetQueueAttributesCommand({QueueUrl:queueUrl,AttributeNames:['ApproximateNumberOfMessages','ApproximateNumberOfMessagesNotVisible']}));
 if(!queue.Attributes||Object.values(queue.Attributes).some(v=>Number(v)!==0))return false;
 const result=await cloudwatch.send(new commands.GetMetricDataCommand({StartTime:new Date(now-180000),EndTime:new Date(now),MetricDataQueries:[{Id:'age',MetricStat:{Metric:{Namespace:'AWS/Lambda',MetricName:'IteratorAge',Dimensions:[{Name:'FunctionName',Value:collector}]},Period:60,Stat:'Maximum'},ReturnData:true}]}));
 return !(result.MetricDataResults||[]).some(r=>r.StatusCode!=='Complete'||(r.Values||[]).some(v=>!Number.isFinite(v)||v>60000));
}
module.exports={inspectSources};
