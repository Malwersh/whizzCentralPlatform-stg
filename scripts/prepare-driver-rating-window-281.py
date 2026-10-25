from pathlib import Path
import subprocess,json,urllib.request,zipfile,copy,hashlib,base64,os
R=Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';P=Path('/private/tmp/driver-rating-window-281');P.mkdir(exist_ok=True)
def aws(*a):return json.loads(subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']))
rows=[]
for label,name in [('ratings','whizz-order-ratings-staging-ratings'),('driver','DriversApi-staging')]:
 f=aws('lambda','get-function','--function-name',name);cfg=f['Configuration'];private=P/(label+'-config.private.json');private.write_text(json.dumps(cfg));os.chmod(private,0o600)
 with urllib.request.urlopen(f['Code']['Location'],timeout=60)as response:data=response.read()
 assert base64.b64encode(hashlib.sha256(data).digest()).decode()==cfg['CodeSha256']
 (P/(label+'-base.zip')).write_bytes(data);old=zipfile.ZipFile(P/(label+'-base.zip'));changes={}
 if label=='ratings':
  source=(R/'backend/src/handlers/order-ratings.js').read_text();base=old.read('src/handlers/order-ratings.js').decode();needle="const {ratingChronology}=require('../shared/driver-rating-chronology-281');\n";stamp='    const chronology=ratingChronology(record);if(chronology)Object.assign(record,chronology);\n';assert source.replace(needle,'').replace(stamp,'')==base,'Rating baseline drift';changes['src/handlers/order-ratings.js']=source.encode();changes['src/shared/driver-rating-chronology-281.js']=(R/'backend/src/shared/driver-rating-chronology-281.js').read_bytes()
 else:
  s=old.read('lambda_driver_api_v2.js').decode();needle="holds:process.env.WALLET_HOLDS_TABLE,drivers:DRIVERS_TABLE},rulesVersion:";assert s.count(needle)==1;s=s.replace(needle,"holds:process.env.WALLET_HOLDS_TABLE,drivers:DRIVERS_TABLE,ratings:'whizz-order-ratings-staging',ratingIndex:'DriverRatingChronology281'},rulesVersion:",1);needle="rulesVersion:event.queryStringParameters?.rules==='3'";assert s.count(needle)==1;s=s.replace(needle,"rulesVersion:event.queryStringParameters?.rules==='4'?4:event.queryStringParameters?.rules==='3'",1);changes['lambda_driver_api_v2.js']=s.encode()
  for n in ['driver-performance.js','driver-rating-window-281.js','driver-rating-chronology-281.js']:changes[n]=(D/'backend'/n).read_bytes()
 with zipfile.ZipFile(P/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  for n,v in changes.items():
   if n not in old.namelist():out.writestr(n,v)
 new=zipfile.ZipFile(P/(label+'-candidate.zip'));assert all(new.read(n)==old.read(n)for n in old.namelist()if n not in changes);runtime=P/(label+'-runtime');new.extractall(runtime)
 for n in changes:subprocess.run(['node','--check',str(runtime/n)],check=True)
 rows.append({'label':label,'function':name,'before':cfg['CodeSha256'],'revision':cfg['RevisionId'],'candidate':base64.b64encode(hashlib.sha256((P/(label+'-candidate.zip')).read_bytes()).digest()).decode(),'changedFiles':list(changes),'otherEntriesByteIdentical':True})
(R/'docs/driver-rating-window-packages-281.json').write_text(json.dumps({'status':'PREPARED_NOT_PUBLISHED','functions':rows},indent=2)+'\n')
raw=aws('cloudformation','get-template','--stack-name','whizz-order-ratings-staging','--template-stage','Original');body=raw['TemplateBody'];base=json.loads(body)if isinstance(body,str)else body
for name,value in [('stack-template-base.private.json',base),('stack-description.private.json',aws('cloudformation','describe-stacks','--stack-name','whizz-order-ratings-staging'))]:
 f=P/name;f.write_text(json.dumps(value));os.chmod(f,0o600)
new=copy.deepcopy(base);table=new['Resources']['RatingsTable']['Properties'];assert not table.get('GlobalSecondaryIndexes');table['AttributeDefinitions']+= [{'AttributeName':'driverRatingKey','AttributeType':'S'},{'AttributeName':'driverRatingSort','AttributeType':'S'}];table['GlobalSecondaryIndexes']=[{'IndexName':'DriverRatingChronology281','KeySchema':[{'AttributeName':'driverRatingKey','KeyType':'HASH'},{'AttributeName':'driverRatingSort','KeyType':'RANGE'}],'Projection':{'ProjectionType':'KEYS_ONLY'}}]
assert all(base[k]==new[k]for k in base if k!='Resources');assert all(base['Resources'][k]==new['Resources'][k]for k in base['Resources']if k!='RatingsTable')
f=P/'stack-template-candidate.private.json';f.write_text(json.dumps(new));os.chmod(f,0o600)
policy={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['dynamodb:GetItem'],'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/whizz-order-ratings-staging'},{'Effect':'Allow','Action':['dynamodb:Query'],'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/whizz-order-ratings-staging/index/DriverRatingChronology281'}]};(R/'docs/driver-rating-window-policy-281.json').write_text(json.dumps(policy,indent=2)+'\n')
summary={'status':'PREPARED_NOT_EXECUTED','stack':'whizz-order-ratings-staging','changedResourceOnly':'RatingsTable','newIndex':'DriverRatingChronology281','keySchema':['driverRatingKey','driverRatingSort'],'projection':'KEYS_ONLY','replacesTable':False,'changesOriginalStarsOrComments':False,'driverReadOnlyPolicy':'docs/driver-rating-window-policy-281.json','metadataBackfill':'Add derived chronology keys conditionally to existing verified driver ratings only; never alter original rating values. Current audit found zero items.','requiresIndexActiveBeforeDriverPublication':True};(R/'docs/driver-rating-window-infrastructure-281.json').write_text(json.dumps(summary,indent=2)+'\n')
print('Prepared two isolated Lambda candidates, table-only index template, and read-only driver policy. Nothing published.')
