"""Read-only post-deployment verification; never activates the region publisher."""
import json
from pathlib import Path

def verify(session):
 assert session.client('sts').get_caller_identity()['Account']=='746727375268'
 cf=session.client('cloudformation')
 stack=cf.describe_stacks(StackName='wizz-production-region-publication')['Stacks'][0]
 assert stack['StackStatus'] in ['CREATE_COMPLETE','UPDATE_COMPLETE'],stack['StackStatus']
 resources={r['LogicalResourceId']:r['PhysicalResourceId'] for r in cf.list_stack_resources(StackName=stack['StackId'])['StackResourceSummaries']}
 worker=session.client('lambda').get_function_configuration(FunctionName=resources['Worker'])
 assert worker['State']=='Active' and worker['Environment']['Variables']['REGION_MANAGEMENT_ENABLED']=='false'
 assert worker['Environment']['Variables']['REGION_COMPOSITE_READERS_READY']=='false'
 mappings=session.client('lambda').list_event_source_mappings(FunctionName=resources['Worker'])['EventSourceMappings']
 assert len(mappings)==1 and mappings[0]['State']=='Disabled'
 rule=session.client('events').describe_rule(Name=resources['Recovery'])
 assert rule['State']=='DISABLED'
 audit=session.client('dynamodb').describe_table(TableName=resources['RegionAudit'])['Table']
 assert audit['TableStatus']=='ACTIVE' and audit['DeletionProtectionEnabled']
 attributes=session.client('sqs').get_queue_attributes(QueueUrl=resources['Queue'],AttributeNames=['SqsManagedSseEnabled','RedrivePolicy','VisibilityTimeout'])['Attributes']
 assert attributes['SqsManagedSseEnabled']=='true' and int(attributes['VisibilityTimeout'])>=6*worker['Timeout']
 assert int(json.loads(attributes['RedrivePolicy'])['maxReceiveCount'])==5
 return {'accountId':'746727375268','status':'DEPLOYED_VERIFIED_DISABLED','stackStatus':stack['StackStatus'],'workerState':worker['State'],'queueConsumerState':mappings[0]['State'],'recoveryState':rule['State'],'auditTableStatus':audit['TableStatus'],'encryptedQueue':True,'financialResourcesChanged':False}
if __name__=='__main__':
 import boto3,argparse
 p=argparse.ArgumentParser();p.add_argument('--profile',default='Wizz_prod_UserApp');p.add_argument('--evidence',type=Path,required=True);args=p.parse_args()
 result=verify(boto3.Session(profile_name=args.profile,region_name='us-east-1'))
 previous=json.loads(args.evidence.read_text()) if args.evidence.exists() else {}
 previous.update(result);args.evidence.write_text(json.dumps(previous,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result))
