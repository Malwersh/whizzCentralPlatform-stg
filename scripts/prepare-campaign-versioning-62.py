"""Offline scoped overlays on the captured live discount writers. Does not activate finance."""
import pathlib,json,zipfile,importlib.util,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1];R=pathlib.Path('/private/tmp/finance62');M=ROOT.parent/'whizzMerchants-stg';U=ROOT.parent/'wizzuser-stg'
def once(s,a,b):assert s.count(a)==1,'ANCHOR_CHANGED';return s.replace(a,b,1)
def main():
 # Candidates can be refreshed offline from the captured originals until publication.
 assert not (R/'publication.json').exists(),'ALREADY_PUBLISHED'
 if (R/'preparation.json').exists():
  import time
  archived=R/('candidate-revision-'+str(time.time_ns()));archived.mkdir()
  for candidate in R.glob('*.candidate.zip'):candidate.rename(archived/candidate.name)
 inv=json.loads((R/'inventory.json').read_text());spec=importlib.util.spec_from_file_location('overlay',ROOT/'scripts/prepare-central-pricing-release-56.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 changes={};core=(ROOT/'backend/src/utils/campaign-version.js').read_bytes()
 with zipfile.ZipFile(R/'staff.zip') as z:
  local=(ROOT/'backend/staff-service/index.js').read_text();line=next(l for l in local.splitlines(True) if "path==='/staff/promotions'" in l);assert local.replace(line,'',1)==z.read('index.js').decode(),'STAFF_INDEX_DRIFT';changes['staff']={'index.js':local.encode(),'promotions.js':(ROOT/'backend/staff-service/promotions.js').read_bytes(),'campaign-version.js':core}
 with zipfile.ZipFile(R/'auth.zip') as z:
  old=z.read('branch_device_discounts.js').decode();local=(M/'backend/functions/auth/branch_device_discounts.js').read_text();assert '../shared/campaign-version' not in old;changes['auth']={'branch_device_discounts.js':local.replace("require('../shared/","require('./shared/").encode(),'shared/campaign-version.js':core}
 with zipfile.ZipFile(R/'discount.zip') as z:
  life=z.read('shared/merchant-lifecycle.js').decode();old="const items=name==='TransactWriteCommand'?command.input.TransactItems:[{[name.slice(0,-7)]:{...command.input}}];";new="const items=name==='TransactWriteCommand'?command.input.TransactItems.map(x=>({...x})):[{[name.slice(0,-7)]:{...command.input}}];\n  for(let i=0;i<items.length;i++)if((items[i].Put||items[i].Update||items[i].Delete)?.TableName==='WhizzMerchants_Discounts'){if(actor.deviceGuards)throw Error('DEVICE_WRITE_SCOPE_INVALID');items[i]=await require('./campaign-version').ownerOperation(raw,items[i],actor.businessId,{GetCommand,expectedRevision:actor.campaignBaseRevision});}"
  life=once(life,old,new);life=once(life,"delete items[0][name.slice(0,-7)].ReturnValues;","delete Object.values(items[0])[0].ReturnValues;");life=once(life,'event.pathParameters?.businessId||body.businessId','event.pathParameters?.businessId||event.queryStringParameters?.businessId||body.businessId');life=once(life,'scope.run({sub,businessId:business.businessId}', 'scope.run({sub,businessId:business.businessId,campaignBaseRevision:event.queryStringParameters?.baseRevision}')
  local=(M/'backend/functions/discounts/discount_management_handler.js').read_text().replace("require('../shared/","require('./shared/");changes['discount']={'discount_management_handler.js':local.encode(),'shared/merchant-lifecycle.js':life.encode(),'shared/campaign-version.js':core}
 with zipfile.ZipFile(R/'writer.zip') as z:
  source=(U/'backend/src/functions/shared/discount-reservation.js').read_bytes();assert b'validVersion(raw)' not in z.read('functions/shared/discount-reservation.js');changes['writer']={'functions/shared/discount-reservation.js':source,'functions/shared/campaign-version.js':core}
 with zipfile.ZipFile(R/'frontend.zip') as z:
  # Source preserves the live Arabic shell and colleague campaign form; only writer functions are replaced.
  changes['frontend']={'data-service.js':(ROOT/'frontend/data-service.js').read_bytes(),'simplified-campaign-manager.js':(ROOT/'frontend/simplified-campaign-manager.js').read_bytes()};html=z.read('pages/promotions.html').decode();html=once(html,'../data-service.js?v=20261016-campaign2','../data-service.js?v=20261017-campaign-versions62');html=once(html,'../simplified-campaign-manager.js?v=20261017-ar1','../simplified-campaign-manager.js?v=20261017-campaign-versions62');changes['frontend']['pages/promotions.html']=('\n'.join(l.rstrip() for l in html.splitlines())+'\n').encode()
 # Align the changed page with the live Arabic shell; preserve the old local source privately.
 for name,data in changes['frontend'].items():
  path=ROOT/'frontend'/name;backup=R/'source-backups'/name;backup.parent.mkdir(parents=True,exist_ok=True)
  if path.exists() and not backup.exists():backup.write_bytes(path.read_bytes())
  path.write_bytes(data)
 packages={k:m.archive(R/(k+'.zip'),R/(k+'.candidate.zip'),v) for k,v in changes.items()}
 roles=json.loads((R/'browser-roles.private.json').read_text());browser=set(roles['roles'].values());browser.update(r['RoleARN'] for v in roles['roleMappings'].values() for r in v.get('RulesConfiguration',{}).get('Rules',[]))
 arn=lambda name:'arn:aws:dynamodb:us-east-1:699561669180:table/'+name
 doc={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['dynamodb:'+a for a in ['GetItem','PutItem','UpdateItem','DeleteItem','ConditionCheckItem']],'Resource':[arn('WhizzMerchants_Discounts'),arn('WizzCentral_Platform_Discounts')]},{'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':[arn('WhizzMerchants_Businesses'),arn('WizzCentral_Regions')]},{'Effect':'Allow','Action':['dynamodb:ConditionCheckItem'],'Resource':arn('staging-AccountDeletion'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ACCOUNT_LIFECYCLE#MERCHANT#*','BUSINESS_LIFECYCLE#MERCHANT#*']}}}]}
 browserDoc={'Version':'2012-10-17','Statement':[{'Effect':'Deny','Action':['dynamodb:'+a for a in ['PutItem','UpdateItem','DeleteItem','BatchWriteItem','PartiQLInsert','PartiQLUpdate','PartiQLDelete']],'Resource':[arn('WhizzMerchants_Discounts'),arn('WizzCentral_Platform_Discounts')]}]}
 merchantDoc={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['cognito-idp:AdminGetUser'],'Resource':'arn:aws:cognito-idp:us-east-1:699561669180:userpool/us-east-1_gtCR3ndzT'}]}
 template={'AWSTemplateFormatVersion':'2010-09-09','Description':'Campaign-version writers on existing Staging roles and prevent browser bypass; no finance gates changed.','Parameters':{'BrowserWritesClosed':{'Type':'String','AllowedValues':['true','false'],'Default':'true'}},'Conditions':{'StagingOnly':{'Fn::And':[{'Fn::Equals':[{'Ref':'AWS::AccountId'},'699561669180']},{'Fn::Equals':[{'Ref':'AWS::Region'},'us-east-1']}] }},'Resources':{}}
 for logical,policy,names in [('StaffCampaignWriter',doc,[inv['staff']['role'].rsplit('/',1)[1]]),('BrowserCampaignWrites',browserDoc,[a.rsplit('/',1)[1] for a in sorted(browser)]),('MerchantDiscountIdentity',merchantDoc,[inv['discount']['role'].rsplit('/',1)[1]])]:template['Resources'][logical]={'Type':'AWS::IAM::ManagedPolicy','Condition':'StagingOnly','Properties':{'ManagedPolicyName':logical+'62','Roles':names,'PolicyDocument':policy}}
 template['Conditions']['BrowserCutover']={'Fn::And':[{'Condition':'StagingOnly'},{'Fn::Equals':[{'Ref':'BrowserWritesClosed'},'true']}]};template['Resources']['BrowserCampaignWrites']['Condition']='BrowserCutover'
 (ROOT/'backend/campaign-versioning-access.staging.json').write_text(json.dumps(template,indent=2)+'\n');p={'part':62,'base':inv,'packages':packages,'browserRoles':sorted(browser),'activationPerformed':False};(R/'preparation.json').write_text(json.dumps(p,indent=2));print(json.dumps(p))
if __name__=='__main__':main()
