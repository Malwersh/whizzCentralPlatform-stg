'use strict';
async function inspectSources({lambda,cloudwatch,sqs,commands,queueUrl,now=Date.now()}){
 const mappings=await lambda.send(new commands.ListEventSourceMappingsCommand({FunctionName:'staging-driver-performance-collector'}));
 if((mappings.EventSourceMappings||[]).filter(m=>m.State==='Enabled').length!==4)return false;
 const queue=await sqs.send(new commands.GetQueueAttributesCommand({QueueUrl:queueUrl,AttributeNames:['ApproximateNumberOfMessages','ApproximateNumberOfMessagesNotVisible']}));
 if(!queue.Attributes||Object.values(queue.Attributes).some(v=>Number(v)!==0))return false;
 const result=await cloudwatch.send(new commands.GetMetricDataCommand({StartTime:new Date(now-180000),EndTime:new Date(now),MetricDataQueries:[{Id:'age',MetricStat:{Metric:{Namespace:'AWS/Lambda',MetricName:'IteratorAge',Dimensions:[{Name:'FunctionName',Value:'staging-driver-performance-collector'}]},Period:60,Stat:'Maximum'},ReturnData:true}]}));
 return !(result.MetricDataResults||[]).some(r=>r.StatusCode!=='Complete'||(r.Values||[]).some(v=>!Number.isFinite(v)||v>60000));
}
module.exports={inspectSources};
