"""Read-only capture; no credentials or Lambda environment values are printed."""
import sys,pathlib,json,urllib.request
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180';p=pathlib.Path('/private/tmp/customer-cash-266');p.mkdir(exist_ok=True);p.chmod(0o700)
a=s.client('apigateway');resources=a.get_resources(restApiId='mqwom78d3c',limit=500)['items'];resource=next(x for x in resources if x['path']=='/order/cancel');integration=a.get_integration(restApiId='mqwom78d3c',resourceId=resource['id'],httpMethod='POST');order=integration['uri'].split(':function:')[1].split('/')[0]
names={'deletion':'staging-account-deletion-worker','expiry':'staging-account-deletion-financial-expiry','financial':'staging-driver-financial-accept','staff':'staging-wizz-staff-service','order':order,'driver':'DriversApi-staging','monitor':'staging-order-exception-sla-232'};l=s.client('lambda')
for label,name in names.items():
 f=l.get_function(FunctionName=name);config=p/(label+'-config.private.json');config.write_text(json.dumps(f['Configuration']));config.chmod(0o600)
 (p/(label+'-base.zip')).write_bytes(urllib.request.urlopen(f['Code']['Location'],timeout=90).read());print('Captured '+name,flush=True)
