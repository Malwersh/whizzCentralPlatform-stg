"""Retry the existing order's first wave only after a fresh driver and matching scope.
No generic scheduler invocation, forged user action, synthetic location or job mutation.
Default is a read-only preflight. --execute invokes StartWave for this exact existing job.
"""
import pathlib,json,importlib.util,datetime,decimal,sys
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance89');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 s=m.session();db=s.resource('dynamodb');l=s.client('lambda');plan=json.loads(pathlib.Path('/private/tmp/finance86/activation-plan.private.json').read_text());selector=plan['scope']['scopes'][0]['orders'][0];driver=plan['scope']['scopes'][0]['drivers'][0];oid=selector['orderId'];now=datetime.datetime.now(datetime.timezone.utc)
 order=db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+oid,'SK':'META'},ConsistentRead=True)['Item'];assert order['status']=='ready_for_pickup' and order.get('userSub')==selector['customerSubjectId'] and order.get('storeId')==selector['branchId'] and order.get('financialSnapshot') and not order.get('financialAcceptance'),'ORDER_NOT_READY_FOR_EXACT_RETRY'
 job=db.Table('WizzDispatchJobs_staging').get_item(Key={'orderId':oid,'SK':'METADATA'},ConsistentRead=True)['Item'];assert job['status']=='searching' and job['currentWaveNumber']==0 and datetime.datetime.fromisoformat(job['expiresAt'].replace('Z','+00:00'))>now,'FIRST_WAVE_RETRY_NOT_AVAILABLE'
 wave=db.Table('WizzDispatchJobs_staging').get_item(Key={'orderId':oid,'SK':'FINANCIAL_WAVE#1'},ConsistentRead=True).get('Item')
 if wave: assert wave['state']=='PREPARING' and wave['assignmentId']==job['dispatchJobId'] and wave['branchId']==selector['branchId'] and wave['driverIds']==[driver['driverId']] and not wave['delivered'],'EXISTING_WAVE_NOT_SAFE_TO_RESUME'
 scopes=[]
 for f in plan['functions']:
  cfg=l.get_function_configuration(FunctionName=f['name']);e=cfg['Environment']['Variables'];c=json.loads(e['FINANCE_ROLLOUT_CONFIG']);assert c['scopes'][0]['orders']==[selector] and c['scopes'][0]['drivers']==[driver] and c['scopes'][0]['mode']=='SCOPED' and datetime.datetime.fromisoformat(c['scopes'][0]['admitUntil'].replace('Z','+00:00'))>now;scopes.append(e['FINANCE_ROLLOUT_SHA256'])
 assert len(set(scopes))==1,'SCOPE_DRIFT';state=db.Table('WizzDriverLiveState_staging').get_item(Key={'driverId':driver['driverId']},ConsistentRead=True)['Item'];age=(now-datetime.datetime.fromisoformat(state['locationUpdatedAt'].replace('Z','+00:00'))).total_seconds();assert state.get('isActive') is True and state.get('currentOrderId') is None and 0<=age<120,'WAIT_FOR_REAL_DRIVER_POSITION'
 result={'exactOrderPreflightPassed':True,'scopeFunctions':len(scopes),'wave':1,'genericWorkerInvoked':False,'executed':False}
 if '--execute' in sys.argv:
  event={'dispatchJobId':job['dispatchJobId'],'waveNumber':1,'restaurantRegionId':job['restaurantRegionId'],'restaurantLat':float(job['restaurantLat']),'restaurantLng':float(job['restaurantLng'])};r=l.invoke(FunctionName='WaveSystem_StartWave',Payload=json.dumps(event).encode());body=json.loads(r['Payload'].read());p=O/'wave-result.private.json';p.write_text(json.dumps(body,default=str));p.chmod(0o600);assert not r.get('FunctionError'),body;result['executed']=True;result['statusCode']=body.get('statusCode');result['resultKeys']=list(body)
 (O/'wave-preflight.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
