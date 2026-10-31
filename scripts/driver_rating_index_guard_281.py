"""Validate the exact non-replacing index change and unchanged-ARN dependency chain."""
DEPENDENCIES={
 'IamRoleLambdaExecution':('AWS::IAM::Role','False','Policies','RatingsTable.Arn','Never'),
 'RatingsLambdaFunction':('AWS::Lambda::Function','False','Role','IamRoleLambdaExecution.Arn','Never'),
 'RatingsLambdaPermissionApiGateway':('AWS::Lambda::Permission','Conditional','FunctionName','RatingsLambdaFunction.Arn','Always'),
 'ApiGatewayMethodOrdersOrderidVarRatingGet':('AWS::ApiGateway::Method','False','Integration','RatingsLambdaFunction.Arn','Never'),
 'ApiGatewayMethodOrdersOrderidVarRatingPost':('AWS::ApiGateway::Method','False','Integration','RatingsLambdaFunction.Arn','Never')}
def validate(view):
 changes=[x['ResourceChange']for x in view['Changes']];assert len({c['LogicalResourceId']for c in changes})==len(changes)
 tables=[c for c in changes if c['LogicalResourceId']=='RatingsTable'];assert len(tables)==1
 table=tables[0];assert table['Action']=='Modify'and table['Replacement']=='False'and table['ResourceType']=='AWS::DynamoDB::Table'and set(table['Scope'])=={'Properties'}
 assert {d['Target']['Name']for d in table['Details']}=={'GlobalSecondaryIndexes','AttributeDefinitions'}
 assert all(d['ChangeSource']=='DirectModification'and d['Evaluation']=='Static'and d['Target']['RequiresRecreation']=='Never'for d in table['Details'])
 for c in changes:
  if c is table:continue
  key=c['LogicalResourceId'];assert key in DEPENDENCIES
  kind,replacement,field,cause,recreation=DEPENDENCIES[key]
  assert c['Action']=='Modify'and c['ResourceType']==kind and c['Replacement']==replacement and set(c['Scope'])=={'Properties'}
  assert c['Details']and all(d['Evaluation']=='Dynamic'and d['ChangeSource']=='ResourceAttribute'and d['CausingEntity']==cause and d['Target']['Name']==field and d['Target']['RequiresRecreation']==recreation for d in c['Details'])
 return changes
