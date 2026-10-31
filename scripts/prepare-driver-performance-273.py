from pathlib import Path
import subprocess,json,urllib.request,zipfile,copy,hashlib,base64,re,os
R=Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';P=Path('/private/tmp/driver-performance-273');P.mkdir(exist_ok=True)
def aws(*a):return json.loads(subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']))
rows=[]
for label,name in [('driver','DriversApi-staging'),('financial','staging-driver-financial-accept')]:
 f=aws('lambda','get-function','--function-name',name);cfg=f['Configuration'];private=P/(label+'-config.private.json');private.write_text(json.dumps(cfg));os.chmod(private,0o600)
 with urllib.request.urlopen(f['Code']['Location'],timeout=120)as response:data=response.read()
 assert base64.b64encode(hashlib.sha256(data).digest()).decode()==cfg['CodeSha256']
 (P/(label+'-base.zip')).write_bytes(data);old=zipfile.ZipFile(P/(label+'-base.zip'));changes={}
 if label=='driver':
  s=old.read('lambda_driver_api_v2.js').decode();needle="rulesVersion:event.queryStringParameters?.rules==='2'?2:1";assert s.count(needle)==1;s=s.replace(needle,"rulesVersion:event.queryStringParameters?.rules==='3'?3:event.queryStringParameters?.rules==='2'?2:1",1)
  source=(D/'backend/lambda_driver_api_v2.js').read_text()
  for name in ['arriveAtStore','pickupOrder','arriveAtCustomer']:
   def bounds(t):
    a=t.index('async function '+name+'(');b=t.find('\nasync function ',a+20);return a,len(t)if b<0 else b
   a,b=bounds(s);c,d=bounds(source);s=s[:a]+source[c:d]+s[b:]
  changes['lambda_driver_api_v2.js']=s.encode()
  for n in ['driver-performance.js','driver-performance-timing-273.js','driver-performance-progress.js']:changes[n]=(D/'backend'/n).read_bytes()
 else:
  for name in ['index.js','driver-acceptance-eta98.js']:
   s=old.read(name).decode();needle='    Object.assign(orderUpdate.ExpressionAttributeValues, { ":arrivalTime": arrival.estimatedDeliveryTime, ":arrivalEstimate": arrival.deliveryEstimate });\n';assert s.count(needle)==1,name
   stamp=re.search(r'const arrival = assignedArrivalEstimate\(\s*(\w+),',s).group(1)
   insert='''    const performanceTiming273=require('./driver-performance-timing-273.js').buildTimingPlan({orderId,driverId:actor.driverId,offerId,attempt:references.order.nextAssignmentAttempt,acceptedAt:STAMP,pickupSeconds:offer.calculation.pickupRoute.durationSeconds,deliverySeconds:offer.calculation.deliveryRoute.durationSeconds,estimatedReadyAt:readyAt??null});
    orderUpdate.UpdateExpression+=', #performanceTiming=:performanceTiming REMOVE #oldStoreArrival, #oldPickup, #oldCustomerArrival, #oldHeadingStore, #oldHeadingCustomer';
    Object.assign(orderUpdate.ExpressionAttributeNames,{'#performanceTiming':'performanceTiming','#oldStoreArrival':'arrivedAtStoreAt','#oldPickup':'pickedUpAt','#oldCustomerArrival':'arrivedAtCustomerAt','#oldHeadingStore':'startHeadingToStoreAt','#oldHeadingCustomer':'startHeadingToCustomerAt'});
    Object.assign(orderUpdate.ExpressionAttributeValues,{':performanceTiming':performanceTiming273});
    const acceptedOfferUpdate273=ops.find(op=>op.Update?.TableName==='WaveOffers_staging')?.Update;
    if(!acceptedOfferUpdate273)throw Error('FINANCIAL_ACCEPTANCE_UNAVAILABLE');
    acceptedOfferUpdate273.UpdateExpression+=', #performanceTiming=:performanceTiming';
    Object.assign(acceptedOfferUpdate273.ExpressionAttributeNames,{'#performanceTiming':'performanceTiming'});
    Object.assign(acceptedOfferUpdate273.ExpressionAttributeValues,{':performanceTiming':performanceTiming273});
'''.replace('STAMP',stamp)
   s=s.replace(needle,needle+insert,1);changes[name]=s.encode()
  changes['driver-performance-timing-273.js']=(R/'backend/shared/driver-performance-timing-273.js').read_bytes()
 with zipfile.ZipFile(P/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  for n,v in changes.items():
   if n not in old.namelist():out.writestr(n,v)
 new=zipfile.ZipFile(P/(label+'-candidate.zip'));assert all(new.read(n)==old.read(n)for n in old.namelist()if n not in changes)
 runtime=P/(label+'-runtime');runtime.mkdir(exist_ok=True);new.extractall(runtime)
 for n,v in changes.items():
  if n.endswith('.js'):subprocess.run(['node','--check',str(runtime/n)],check=True)
 rows.append({'label':label,'function':cfg['FunctionName'],'before':cfg['CodeSha256'],'revision':cfg['RevisionId'],'candidate':base64.b64encode(hashlib.sha256((P/(label+'-candidate.zip')).read_bytes()).digest()).decode(),'changedFiles':list(changes),'allOtherEntriesIdentical':True})
(R/'docs/driver-performance-packages-273.json').write_text(json.dumps({'status':'PREPARED_NOT_PUBLISHED','functions':rows,'newPermissions':False,'financialCalculationChanged':False},indent=2)+'\n')
print(json.dumps([{'function':x['function'],'changedFiles':x['changedFiles']}for x in rows],indent=2))
