#!/usr/bin/env python3
"""Read-only Staging metadata and IAM audit. Never retrieves credentials, profiles, balances or orders."""
import argparse, json, subprocess
from pathlib import Path
import boto3

def run():
 p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--no-discount',action='store_true');a=p.parse_args();out=Path(a.output).resolve();assert out.parent==Path('/private/tmp') and not out.exists(),'NEW_PRIVATE_TMP_REPORT_REQUIRED'
 s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180'
 lam=s.client('lambda');iam=s.client('iam');ddb=s.client('dynamodb');secrets=s.client('secretsmanager')
 configs={};functions=[]
 allow=['DELIVERY_OPERATIONS_MODE','DELIVERY_QUOTES_ENABLED','DELIVERY_QUOTE_MAX_PER_MINUTE','MAPBOX_SECRET_ARN','FINANCIAL_ROUTING_SECRET_ARN','FINANCIAL_OFFER_TTL_SECONDS','FINANCIAL_POSITION_MAX_AGE_SECONDS','FINANCIAL_REASSIGNMENT_WINDOW_SECONDS','DELIVERY_QUOTE_MODE','COMMERCIAL_PRICING_MODE']
 for kind,name in [('quote','WizzUser-DeliveryQuotes-staging'),('routingHost','WaveSystem_StartWave'),('driver','staging-driver-financial-accept'),('writer','WizzUser-CreateOrder-staging'),('cleanup','staging-account-deletion-worker')]:
  c=lam.get_function_configuration(FunctionName=name);env=c.get('Environment',{}).get('Variables',{});configs[kind]={k:v for k,v in env.items() if k in allow or k.startswith('FINANCIAL_') and k.endswith('_MODE')};functions.append({'kind':kind,'name':name,'revisionId':c['RevisionId'],'codeSha256':c['CodeSha256']})
  if kind=='writer':writer_role=c['Role']
 metadata=[]
 for arn in sorted({v for e in configs.values() for k,v in e.items() if k in ['MAPBOX_SECRET_ARN','FINANCIAL_ROUTING_SECRET_ARN'] and v.startswith('arn:aws:secretsmanager:us-east-1:699561669180:secret:')}):
  try:
   m=secrets.describe_secret(SecretId=arn);metadata.append({'arn':arn,'exists':True,'scheduledDeletion':bool(m.get('DeletedDate')),'hasCurrentVersion':any('AWSCURRENT' in v for v in m.get('VersionIdsToStages',{}).values())})
  except secrets.exceptions.ResourceNotFoundException:metadata.append({'arn':arn,'exists':False})
 # The central policy is the authoritative source when the runtime hosts use CENTRAL.
 central_raw=ddb.get_item(TableName='staging-PlatformStaff',Key={'pk':{'S':'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS'},'sk':{'S':'CURRENT'}},ConsistentRead=True,ProjectionExpression='#v,#values',ExpressionAttributeNames={'#v':'version','#values':'values'}).get('Item')
 from boto3.dynamodb.types import TypeDeserializer
 dec=TypeDeserializer();central={k:dec.deserialize(v) for k,v in central_raw.items()} if central_raw else None
 configs['centralOperations']=central
 if a.no_discount:configs['discountPlan']={'mode':'NONE','campaignIds':[],'platformShareMinor':0,'merchantShareMinor':0}
 # Only the server's operational pricing reference is read; no staff/person partitions or financial balances.
 policy=ddb.get_item(TableName='staging-PlatformStaff',Key={'pk':{'S':'OPERATIONAL_SETTINGS#DELIVERY_PRICING'},'sk':{'S':'CURRENT'}},ConsistentRead=True).get('Item')
 from boto3.dynamodb.types import TypeDeserializer
 decode=TypeDeserializer();row={k:decode.deserialize(v) for k,v in policy.items()} if policy else None
 node="const fs=require('fs'),r=JSON.parse(fs.readFileSync(0,'utf8'));try{const v=require('./backend/wallet-service/dist/deliveryPricing').validatePricingRules(r.values);process.stdout.write(JSON.stringify({valid:Number.isSafeInteger(r.version)&&r.version>=1&&v.deliveryRules.length>0&&[...v.deliveryRules,...v.driverRules].every(x=>['PUBLISHED','ARCHIVED'].includes(x.status)),deliveryRules:v.deliveryRules.length,driverRules:v.driverRules.length}));}catch{process.stdout.write(JSON.stringify({valid:false}));}"
 # DynamoDB Decimal is converted for the same runtime validation used by Quote, without persisting policy contents.
 pricing=json.loads(subprocess.run(['node','-e',node],input=json.dumps(row,default=lambda n:int(n) if n==int(n) else float(n)),text=True,capture_output=True,check=True,cwd=Path(__file__).resolve().parents[1]).stdout)
 pricing['exists']=row is not None
 checks=[]
 for action,table,key in [('dynamodb:GetItem','staging-MerchantPlatform','COMMERCIAL_AGREEMENT#readiness'),('dynamodb:ConditionCheckItem','staging-MerchantPlatform','COMMERCIAL_AGREEMENT#readiness'),('dynamodb:GetItem','staging-PlatformStaff','DISCOUNT_FUNDING#readiness'),('dynamodb:ConditionCheckItem','staging-PlatformStaff','DISCOUNT_FUNDING#readiness'),('dynamodb:UpdateItem','staging-Wallets','WALLET#PLATFORM'),('dynamodb:PutItem','staging-Holds','readiness'),('dynamodb:PutItem','staging-LedgerEntries','WALLET#PLATFORM'),('dynamodb:PutItem','staging-AuditLog','PROMO#readiness')]:
  decision=iam.simulate_principal_policy(PolicySourceArn=writer_role,ActionNames=[action],ResourceArns=['arn:aws:dynamodb:us-east-1:699561669180:table/'+table],ContextEntries=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[key]}])['EvaluationResults'][0]['EvalDecision'];checks.append({'action':action,'table':table,'decision':decision})
 proposal=json.loads(subprocess.run(['node','scripts/prepare-commercial-writer-access.cjs'],text=True,capture_output=True,check=True,cwd=Path(__file__).resolve().parents[1]).stdout)
 proposed=[]
 positive=[(x['action'],x['table'],'WALLET#PLATFORM' if x['table'] in ['staging-Wallets','staging-LedgerEntries'] else 'DISCOUNT_FUNDING#readiness' if x['table']=='staging-PlatformStaff' else 'COMMERCIAL_AGREEMENT#readiness' if x['table']=='staging-MerchantPlatform' else 'readiness','allowed') for x in checks]
 negative=[('dynamodb:UpdateItem','staging-Wallets','WALLET#DRIVER#readiness','implicitDeny'),('dynamodb:PutItem','staging-LedgerEntries','WALLET#DRIVER#readiness','implicitDeny'),('dynamodb:DeleteItem','staging-Holds','readiness','implicitDeny'),('dynamodb:PutItem','staging-DeliveryQuotes','CUSTOMER#readiness','implicitDeny'),('dynamodb:UpdateItem','staging-PlatformStaff','DISCOUNT_FUNDING#readiness','implicitDeny')]
 for action,table,key,expected in positive+negative:
  decision=iam.simulate_custom_policy(PolicyInputList=[json.dumps(proposal['document'])],ActionNames=[action],ResourceArns=['arn:aws:dynamodb:us-east-1:699561669180:table/'+table],ContextEntries=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[key]}])['EvaluationResults'][0]['EvalDecision'];assert decision==expected,(action,table,decision);proposed.append({'action':action,'table':table,'decision':decision,'expected':expected})
 configs.update(pricingValid=pricing['valid'],writerIam=checks)
 approved=json.loads((Path(__file__).resolve().parents[1]/'docs/finance-staging-operating-limits.json').read_text())
 expected={'FINANCIAL_OFFER_TTL_SECONDS':str(approved['driverOfferTtlSeconds']),'FINANCIAL_POSITION_MAX_AGE_SECONDS':str(approved['driverPositionMaxAgeSeconds']),'FINANCIAL_REASSIGNMENT_WINDOW_SECONDS':str(approved['reassignmentWindowSeconds'])}
 if any(configs[k].get('DELIVERY_OPERATIONS_MODE')=='CENTRAL' for k in ['quote','driver','routingHost']):
  matches=bool(central) and int(central['version'])>=1 and all(configs[k].get('DELIVERY_OPERATIONS_MODE')=='CENTRAL' for k in ['quote','driver','routingHost']) and all(central['values'].get(k)==approved[k] for k in ['quoteMaxPerCustomerPerMinute','driverOfferTtlSeconds','driverPositionMaxAgeSeconds','reassignmentWindowSeconds','maximumWaves'])
 else:matches=configs['quote'].get('DELIVERY_QUOTE_MAX_PER_MINUTE')==str(approved['quoteMaxPerCustomerPerMinute']) and all(configs['driver'].get(k)==v for k,v in expected.items())
 configs['evidence']={'OPERATING_LIMITS_APPROVED':approved['status']=='USER_APPROVED_2026_10_16' and matches}
 root=Path(__file__).resolve().parents[1];result=json.loads(subprocess.run(['node','scripts/financial-release-readiness.cjs'],input=json.dumps(configs,default=lambda n:int(n) if n==int(n) else float(n)),text=True,capture_output=True,check=True,cwd=root).stdout)
 report={'account':'699561669180','region':'us-east-1','readOnly':True,'secretValuesRead':False,'humanDataRead':False,'functions':functions,'selectedEnvironment':{kind:configs[kind] for kind in ['quote','routingHost','driver','writer','cleanup']},'configuredSecretMetadata':metadata,'centralOperationsVersion':int(central['version']) if central else None,'sampleDiscountPlan':configs.get('discountPlan'),'pricingPolicy':pricing,'writerIam':checks,'proposedWriterPolicy':{'status':'REFERENCE_ONLY_NO_POLICY_WRITES','checks':proposed,'sourceSha256':proposal['sourceSha256']},'readiness':result}
 out.write_text(json.dumps(report,indent=2)+'\n');out.chmod(0o600);print(json.dumps({'readOnly':True,'gatesClosed':result['gatesClosed'],'blockers':result['blockers'],'pricing':pricing,'writerAllowed':sum(x['decision']=='allowed' for x in checks),'writerChecks':len(checks)}))
if __name__=='__main__':run()
