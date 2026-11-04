"""Read-only IAM simulation for the new rollout identity fence. No grant/deploy."""
import argparse, datetime, json
from pathlib import Path

ATTRIBUTES = ['PK','SK','orderId','userSub','storeId','businessId','financeRollout','driverId','assignedDriverId']
READ_ONLY = {'staging-wizz-wallet-notification-worker','wizzcentral-notifications-staging-pushSendWaveOffer'}
NO_ORDER_READ = {'WizzUser-DeliveryQuotes-staging'}

def audit(directory, output, proposals=None, dependency_plan=None):
    import boto3
    session=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1')
    if session.client('sts').get_caller_identity()['Account']!='699561669180':
        raise ValueError('STAGING_ACCOUNT_REQUIRED')
    inventory=json.loads((Path(directory)/'inventory.json').read_text())
    if inventory['account']!='699561669180' or inventory['region']!='us-east-1':
        raise ValueError('STAGING_INVENTORY_REQUIRED')
    iam=session.client('iam'); rows=[]
    proposed={p['name']:p for p in json.loads(Path(proposals).read_text())} if proposals else {}
    for f in inventory['functions']:
        if f['name'] in NO_ORDER_READ: continue
        # Only the thirteen rollout hosts, not unrelated privacy readers.
        if f['name'].startswith('WizzUser-') and f['name']!='WizzUser-CreateOrder-staging':continue
        if f['name']=='order-receiver-merchant-orders-staging-v1':continue
        actions=['dynamodb:GetItem']+([] if f['name'] in READ_ONLY else ['dynamodb:ConditionCheckItem'])
        contexts=[{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':ATTRIBUTES},
            {'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':['ORDER#finance54-synthetic-probe']}]
        extra={'PolicyInputList':[json.dumps(proposed[f['name']]['policy'])]} if f['name'] in proposed else {}
        response=iam.simulate_principal_policy(**extra,PolicySourceArn=f['role'],ActionNames=actions,
            ResourceArns=['arn:aws:dynamodb:us-east-1:699561669180:table/WizzOrders'],ContextEntries=contexts)
        rows.append({'name':f['name'],'role':f['role'],'baseCodeSha256':f['codeSha256'],
            'checks':[{'action':r['EvalActionName'],'decision':r['EvalDecision'],
              'missingContext':r.get('MissingContextValues',[]),
              'boundary':r.get('PermissionsBoundaryDecisionDetail')} for r in response['EvaluationResults']]})
    dependencies=[]
    if dependency_plan:
        staff=next(f for f in inventory['functions'] if f['name']=='staging-wizz-staff-service')
        proposal=next(p for p in json.loads(Path(dependency_plan).read_text()) if p['name']==staff['name'])
        extra={'PolicyInputList':[json.dumps(proposed[staff['name']]['policy'])]} if staff['name'] in proposed else {}
        for statement in proposal['policy']['Statement']:
            resources=statement['Resource'] if isinstance(statement['Resource'],list) else [statement['Resource']]
            for resource in resources:
                table=resource.rsplit('/',1)[-1]
                if table=='WizzOrders':continue
                attrs=statement.get('Condition',{}).get('ForAllValues:StringEquals',{}).get('dynamodb:Attributes')
                key='BUSINESS_LIFECYCLE#MERCHANT#finance54-synthetic-probe' if table=='staging-AccountDeletion' else 'finance54-synthetic-probe'
                contexts=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[key]}]
                if attrs:contexts.append({'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':attrs})
                if any(a in ['dynamodb:Query','dynamodb:Scan'] for a in statement['Action']):contexts.append({'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':['SPECIFIC_ATTRIBUTES']})
                result=iam.simulate_principal_policy(**extra,PolicySourceArn=staff['role'],ActionNames=statement['Action'],ResourceArns=[resource],ContextEntries=contexts)
                dependencies.extend({'table':table,'action':e['EvalActionName'],'decision':e['EvalDecision'],'missingContext':e.get('MissingContextValues',[])} for e in result['EvaluationResults'])
    report={'schemaVersion':1,'part':54,'checkedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'account':'699561669180','region':'us-east-1','readOnly':True,'IAMChanged':False,'proposedPoliciesIncluded':bool(proposals),
        'humanRowsRead':False,'handlerInvocations':0,'attributes':ATTRIBUTES,'functions':rows,'reviewDependencyChecks':dependencies,
        'limitations':['IAM simulation is not an actual DynamoDB/Gateway transaction.',
          'Existing policies, boundaries, resource policies and organizational controls require deployment-time reconciliation.',
          'This checks new order identity reads/fences only, not provider/device/funding readiness or every existing operation.']}
    Path(output).write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'hostsChecked':len(rows),'denied':[{ 'name':r['name'],'actions':[c['action'] for c in r['checks'] if c['decision']!='allowed']} for r in rows if any(c['decision']!='allowed' for c in r['checks'])],'reviewDependencyDenials':[r for r in dependencies if r['decision']!='allowed'],'IAMChanged':False}))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory');p.add_argument('output');p.add_argument('--proposals');p.add_argument('--dependency-plan');a=p.parse_args();audit(a.directory,a.output,a.proposals,a.dependency_plan)
