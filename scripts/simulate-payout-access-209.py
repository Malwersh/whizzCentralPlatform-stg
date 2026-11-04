"""Read-only IAM simulation of the permission delta, not existing whole-role authority."""
import sys,pathlib,json
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
p=pathlib.Path('/private/tmp/payout-209');a=json.loads((p/'access.private.json').read_text());iam=session().client('iam');results=[]
arn=lambda t:'arn:aws:dynamodb:us-east-1:699561669180:table/'+t
wallet=a['staffManagedPolicy']['document']['Statement'][0]['Condition']['ForAllValues:StringEquals']['dynamodb:Attributes']
def check(name,policy,action,resource,expected,keys=None,attrs=None):
 context=[]
 for key,values in [('dynamodb:LeadingKeys',keys),('dynamodb:Attributes',attrs)]:
  if values is not None:context.append({'ContextKeyName':key,'ContextKeyValues':values,'ContextKeyType':'stringList'})
 r=iam.simulate_custom_policy(PolicyInputList=[json.dumps(policy)],ActionNames=[action],ResourceArns=[resource],ContextEntries=context)['EvaluationResults'][0]['EvalDecision'];assert r==expected,(name,r,expected);results.append({'case':name,'expected':expected,'actual':r})
s=a['staffManagedPolicy']['document'];w=a['workerManagedPolicy']['document']
check('projected merchant wallet read',s,'dynamodb:GetItem',arn('staging-Wallets'),'allowed',['WALLET#MERCHANT#branch'],wallet)
check('unprojected wallet read denied by new policy',s,'dynamodb:GetItem',arn('staging-Wallets'),'implicitDeny',['WALLET#MERCHANT#branch'])
check('merchant liability update',s,'dynamodb:UpdateItem',arn('staging-Wallets'),'allowed',['WALLET#MERCHANT#branch'],wallet)
for key in ['WALLET#PLATFORM','WALLET#DRIVER#driver']:check(key+' update denied',s,'dynamodb:UpdateItem',arn('staging-Wallets'),'implicitDeny',[key],wallet)
check('named paid fields update',s,'dynamodb:UpdateItem',arn('staging-Holds'),'allowed',['11111111-1111-4111-8111-111111111111'],['orderId','sk','status','paidPayoutId','paidAt','amount','settlementBatchId','settlementLineDigest'])
check('only payout destination secret reference',s,'ssm:GetParameter','arn:aws:ssm:us-east-1:699561669180:parameter/whizz/staging/otpiq-key','allowed')
check('other parameter denied',s,'ssm:GetParameter','arn:aws:ssm:us-east-1:699561669180:parameter/other-secret','implicitDeny')
check('expired OTP may be removed during scoped deletion',w,'dynamodb:DeleteItem',arn('staging-MerchantPlatform'),'allowed',['MERCHANT_PAYOUT_DESTINATION#branch'])
check('financial payout source cannot be deleted by new policy',w,'dynamodb:DeleteItem',arn('staging-MerchantPlatform'),'implicitDeny',['MERCHANT_PAYOUT#branch'])
(p/'access-simulation.json').write_text(json.dumps({'basis':'CANDIDATE_DELTA_ONLY','results':results},indent=2)+'\n');print(json.dumps({'simulations':len(results),'passed':len(results),'financialWritesPerformed':False}))
