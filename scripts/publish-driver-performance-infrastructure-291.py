"""Approved staging-only infrastructure. Never writes source business records."""
from pathlib import Path
import json,subprocess,datetime,os
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-performance-projection-291');P.mkdir(exist_ok=True)
BASE=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*args):
 raw=subprocess.check_output(BASE+list(args));return json.loads(raw)if raw.strip()else{}
assert '--approved-staging-infrastructure' in __import__('sys').argv,'Explicit user approval required'
assert aws('sts','get-caller-identity')['Account']=='699561669180'
rows=[]
for table in ['WaveOffers_staging','WizzOrders','staging-Holds','WhizzDrivers_staging','whizz-order-ratings-staging']:
 t=aws('dynamodb','describe-table','--table-name',table)['Table'];rows.append({'table':table,'stream':t.get('LatestStreamArn'),'view':t.get('StreamSpecification',{}).get('StreamViewType')})
(P/'before-streams.json').write_text(json.dumps(rows,indent=2))
for row in rows:
 if not row['stream']:
  assert row['table']in['staging-Holds','whizz-order-ratings-staging']
  aws('dynamodb','update-table','--table-name',row['table'],'--stream-specification','StreamEnabled=true,StreamViewType=NEW_AND_OLD_IMAGES')
  subprocess.check_call(BASE+['dynamodb','wait','table-exists','--table-name',row['table']])
  row['stream']=aws('dynamodb','describe-table','--table-name',row['table'])['Table']['LatestStreamArn']
(P/'streams.json').write_text(json.dumps(rows,indent=2))
subprocess.run([str(R/'backend/wallet-service/node_modules/.bin/esbuild'),str(R/'backend/driver-performance-projection/index.js'),'--bundle','--platform=node','--target=node22','--external:@aws-sdk/*','--outfile='+str(R/'backend/driver-performance-projection/build/index.js')],check=True)
subprocess.run(['sam','package','--template-file',str(R/'backend/driver-performance-projection/template.yaml'),'--s3-bucket','aws-sam-cli-managed-default-samclisourcebucket-c0s0eilxsprc','--s3-prefix','driver-performance-projection-291','--output-template-file',str(P/'packaged.yaml'),'--profile','Wizz_stg_UserApp','--region','us-east-1'],env={**os.environ,'SAM_CLI_TELEMETRY':'0'},check=True)
streams={r['table']:r['stream']for r in rows};params=[{'ParameterKey':'SourceStreams','ParameterValue':json.dumps(streams,separators=(',',':'))},{'ParameterKey':'OrderForwardReady','ParameterValue':'false'}]
for param,table in [('OffersStream','WaveOffers_staging'),('HoldsStream','staging-Holds'),('DriversStream','WhizzDrivers_staging'),('RatingsStream','whizz-order-ratings-staging')]:params.append({'ParameterKey':param,'ParameterValue':streams[table]})
(P/'parameters.json').write_text(json.dumps(params,indent=2))
stack='staging-driver-performance-projection';changeset='projection-291-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
result=aws('cloudformation','create-change-set','--stack-name',stack,'--change-set-name',changeset,'--change-set-type','CREATE','--template-body','file://'+str(P/'packaged.yaml'),'--parameters','file://'+str(P/'parameters.json'),'--capabilities','CAPABILITY_IAM','--description','User-approved verified driver metrics. Source reads only; derived table writes only.')
subprocess.check_call(BASE+['cloudformation','wait','change-set-create-complete','--stack-name',stack,'--change-set-name',changeset])
d=aws('cloudformation','describe-change-set','--stack-name',stack,'--change-set-name',changeset)
allowed={'AWS::DynamoDB::Table','AWS::SQS::Queue','AWS::IAM::Role','AWS::Lambda::Function','AWS::Lambda::Permission','AWS::Lambda::EventSourceMapping','AWS::Lambda::EventInvokeConfig','AWS::Events::Rule'}
assert all(c['ResourceChange']['Action']=='Add'and c['ResourceChange']['ResourceType']in allowed for c in d['Changes'])
report={'status':'APPROVED_CHANGESET_EXECUTING','userApproval':'EXPLICIT_STAGING_INFRASTRUCTURE_APPROVAL_RECEIVED','stack':stack,'changeSet':changeset,'changeSetArn':result['Id'],'sourceStreams':streams,'thirdOrderStreamReaderAdded':False,'sourceBusinessWrites':0,'resources':[{'id':c['ResourceChange']['LogicalResourceId'],'type':c['ResourceChange']['ResourceType']}for c in d['Changes']]}
file=R/'docs/driver-performance-projection-infrastructure-291.json';file.write_text(json.dumps(report,indent=2)+'\n');aws('cloudformation','execute-change-set','--stack-name',stack,'--change-set-name',changeset);print('APPROVED_CHANGESET_EXECUTING',flush=True)
