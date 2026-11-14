from pathlib import Path
import json,subprocess,datetime
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-rating-window-281')
def aws(*a):
 raw=subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']);return json.loads(raw)if raw.strip()else{}
stack=json.loads((P/'stack-description.private.json').read_text())['Stacks'][0]
parameters=[{'ParameterKey':x['ParameterKey'],'UsePreviousValue':True}for x in stack.get('Parameters',[])]
f=P/'stack-parameters.private.json';f.write_text(json.dumps(parameters));f.chmod(0o600)
name='driver-rating-window-281-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
args=['cloudformation','create-change-set','--stack-name','whizz-order-ratings-staging','--change-set-name',name,'--change-set-type','UPDATE','--template-body','file://'+str(P/'stack-template-candidate.private.json'),'--capabilities','CAPABILITY_NAMED_IAM','--description','Add only DriverRatingChronology281 sparse keys-only index; retain all existing resources and original rating values']
if parameters:args+=['--parameters','file://'+str(f)]
created=aws(*args);(P/'change-set.private.json').write_text(json.dumps(created));(P/'change-set.private.json').chmod(0o600)
subprocess.check_call(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1','cloudformation','wait','change-set-create-complete','--change-set-name',created['Id']])
from driver_rating_index_guard_281 import validate
view=aws('cloudformation','describe-change-set','--change-set-name',created['Id']);changes=validate(view)
report={'status':'PREVIEW_READY_NOT_EXECUTED','changeSetName':name,'changeSetId':created['Id'],'changes':[{k:c[k]for k in ['Action','LogicalResourceId','ResourceType','Replacement','Scope']}for c in changes],'newIndex':'DriverRatingChronology281','onlyDirectlyModifiedResource':'RatingsTable','otherResourceTemplatesUnchanged':True,'dependencyReevaluations':'Unchanged table ARN -> existing IAM policy -> same Lambda role -> same API integration/permission; no function Code or environment modifications.'};(R/'docs/driver-rating-window-changeset-281.json').write_text(json.dumps(report,indent=2)+'\n');print('Change set ready: no table replacement; table index changes plus only validated unchanged-ARN dependency reevaluations; NOT executed.')
