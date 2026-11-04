import json,subprocess
from pathlib import Path
O=Path('backend/.tmp/post-payout-353');O.mkdir(exist_ok=True)
attrs=['orderId','sk','kind','version','correctionReview','updatedAt','caseAppeals','appealReviewRequired','exceptionResolution','caseId']
idx=['operationId','kind','schemaVersion','caseId','orderId','branchId','caseKey','caseType','status','caseState','version','queuePartition','nextAttemptAt','createdAt','updatedAt','monitoringPhaseKey','monitoringPhaseStartedAt','monitoringPriority','responseAlertAt','escalatedAt','monitoringStatus']
policy={'Version':'2012-10-17','Statement':[{'Sid':'CorrectionCaseMetadataUpdateOnly','Effect':'Allow','Action':'dynamodb:UpdateItem','Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/staging-Holds','Condition':{'ForAllValues:StringEquals':{'dynamodb:Attributes':attrs},'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['????????-????-????-????-????????????','ORD*']},'Null':{'dynamodb:Attributes':'false','dynamodb:LeadingKeys':'false'}}},{'Sid':'CorrectionReviewQueueMetadataOnly','Effect':'Allow','Action':'dynamodb:PutItem','Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/staging-WalletLifecycle','Condition':{'ForAllValues:StringEquals':{'dynamodb:Attributes':idx},'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['EXCEPTION_CASE#*']},'Null':{'dynamodb:Attributes':'false','dynamodb:LeadingKeys':'false'}}}]}
(O/'case-metadata-policy.json').write_text(json.dumps(policy,indent=2))
role='arn:aws:iam::699561669180:role/staging-wizz-staff-service-StaffFunctionRole-hk0IFW4PhVQx';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];out=[]
for table,action,fields,pk in [('staging-Holds','dynamodb:UpdateItem',attrs,'12345678-1234-1234-1234-123456789012'),('staging-WalletLifecycle','dynamodb:PutItem',idx,'EXCEPTION_CASE#case')]:
 context=[{'ContextKeyName':'dynamodb:Attributes','ContextKeyValues':fields,'ContextKeyType':'stringList'},{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyValues':[pk],'ContextKeyType':'stringList'}]
 result=json.loads(subprocess.check_output(B+['iam','simulate-principal-policy','--policy-source-arn',role,'--policy-input-list',json.dumps(policy),'--action-names',action,'--resource-arns','arn:aws:dynamodb:us-east-1:699561669180:table/'+table,'--context-entries',json.dumps(context),'--output','json']))['EvaluationResults'][0]
 assert result['EvalDecision']=='allowed';out.append({'table':table,'action':action,'decision':'allowed'})
# Show that the new statement does not permit amounts or arbitrary lifecycle records.
for table,action,fields,pk in [('staging-Holds','dynamodb:UpdateItem',attrs+['amount'],'12345678-1234-1234-1234-123456789012'),('staging-WalletLifecycle','dynamodb:PutItem',idx,'UNRELATED#record')]:
 context=[{'ContextKeyName':'dynamodb:Attributes','ContextKeyValues':fields,'ContextKeyType':'stringList'},{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyValues':[pk],'ContextKeyType':'stringList'}]
 result=json.loads(subprocess.check_output(B+['iam','simulate-custom-policy','--policy-input-list',json.dumps(policy),'--action-names',action,'--resource-arns','arn:aws:dynamodb:us-east-1:699561669180:table/'+table,'--context-entries',json.dumps(context),'--output','json']))['EvaluationResults'][0]
 assert result['EvalDecision']=='implicitDeny';out.append({'negativeTest':pk+' '+','.join(fields[-1:]),'decision':'implicitDeny'})
(O/'case-metadata-permission-proof.json').write_text(json.dumps(out,indent=2));print('PASS scoped case metadata permissions; monetary fields and unrelated keys denied')
