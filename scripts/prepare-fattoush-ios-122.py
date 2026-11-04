"""Prepare Fattoush checkout for customer/merchant/driver8280 on physical iOS."""
import pathlib,importlib.util,json,subprocess,copy,datetime,concurrent.futures
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance122')
def main():
 O.mkdir(mode=0o700,exist_ok=True);sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);s=m.session();db=s.resource('dynamodb');lam=s.client('lambda');cog=s.client('cognito-idp')
 names=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./scripts/check-finance-rollout-deployment.cjs').FUNCTIONS))"],cwd=R))
 with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:rows=list(pool.map(lambda n:lam.get_function_configuration(FunctionName=n),names))
 old=json.loads(rows[0]['Environment']['Variables']['FINANCE_ROLLOUT_CONFIG']);assert all(json.loads(c['Environment']['Variables']['FINANCE_ROLLOUT_CONFIG'])==old for c in rows),'SCOPE_DRIFT';assert len(old['scopes'])==3
 selector=json.loads(pathlib.Path('/private/tmp/finance121/selector.private.json').read_text());source=old['scopes'][-1];assert source['id']=='fattoush-customer7435-121';assert source['orders'][0]['orderId']==selector['orderId']
 oid=selector['orderId'];assert not db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+oid,'SK':'META'},ConsistentRead=True).get('Item'),'OLD_ATTEMPT_HAS_ORDER'
 for table in ['staging-Holds','WaveOffers_staging','WizzDispatchJobs_staging']:
  page=db.Table(table).query(KeyConditionExpression='orderId=:o',ExpressionAttributeValues={':o':oid},ConsistentRead=True);assert not page.get('LastEvaluatedKey') and not page.get('Items'),'OLD_ATTEMPT_HAS_OBLIGATIONS '+table
 customer_env=next(c for c in rows if c['FunctionName']=='WizzUser-CreateOrder-staging')['Environment']['Variables'];pool=customer_env.get('USER_POOL_ID') or customer_env.get('COGNITO_USER_POOL_ID');u=cog.list_users(UserPoolId=pool,Filter='phone_number = "+9647800868280"',Limit=2)['Users'];assert len(u)==1 and u[0]['Enabled'];attrs={a['Name']:a['Value'] for a in u[0]['Attributes']};assert attrs['phone_number_verified']=='true'
 profile=db.Table('WizzUser_users_staging').get_item(Key={'userId':attrs['sub']},ConsistentRead=True).get('Item')
 if not profile:
  profiles=db.Table('WizzUser_users_staging').query(IndexName='phone-index',KeyConditionExpression='phone=:p',ExpressionAttributeValues={':p':'+9647800868280'},Limit=2);assert not profiles.get('LastEvaluatedKey') and len(profiles.get('Items',[]))==1;profile=profiles['Items'][0];assert attrs['sub'] in [profile.get('cognitoSub'),profile.get('cognitoUserId'),profile.get('userId')]
 selector['userId']=profile['userId']
 u=cog.list_users(UserPoolId='us-east-1_gtCR3ndzT',Filter='phone_number = "+9647800868280"',Limit=2)['Users'];assert len(u)==1 and u[0]['Enabled'];owner={a['Name']:a['Value'] for a in u[0]['Attributes']}['sub'];b=db.Table('WhizzMerchants_Businesses').get_item(Key={'businessId':selector['branchId']},ConsistentRead=True)['Item'];assert b['ownerId']==owner and b['status']=='approved';assert b.get('commercialAgreementId') and b.get('commercialAgreementVersion')
 driver=source['drivers'][0]['driverId'];w=db.Table('staging-Wallets').get_item(Key={'walletId':'WALLET#DRIVER#'+driver,'sk':'META'},ConsistentRead=True)['Item'];live=db.Table('WizzDriverLiveState_staging').get_item(Key={'driverId':driver},ConsistentRead=True).get('Item',{});assert w['lockedBalance']==0 and w['availableBalance']>=25000 and not live.get('currentOrderId') and not live.get('activeOrdersCount',0)
 if not (O/'selector.private.json').exists():
  node="const x=JSON.parse(require('fs').readFileSync(0,'utf8'));x.requestId=require('crypto').randomUUID();x.orderId=require('./backend/wallet-service/dist/deliveryQuoteOrder').orderIdFor(x.userId,x.requestId);console.log(JSON.stringify(x))";selector=json.loads(subprocess.check_output(['node','-e',node],input=json.dumps(selector).encode(),cwd=R));(O/'selector.private.json').write_text(json.dumps(selector))
 else:selector=json.loads((O/'selector.private.json').read_text())
 assert not db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+selector['orderId'],'SK':'META'},ConsistentRead=True).get('Item')
 candidate=copy.deepcopy(old);new=candidate['scopes'][-1];new.update(id='fattoush-customer8280-ios-122',mode='SCOPED',admitUntil=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=60)).isoformat(timespec='milliseconds').replace('+00:00','Z'));new['orders'][0].update(orderId=selector['orderId'],customerSubjectId=attrs['sub'])
 raw=json.dumps(candidate,separators=(',',':'));digest=subprocess.check_output(['node','-e',"console.log(require('./backend/wallet-service/dist/deliveryQuoteRecord').quoteHash(JSON.parse(require('fs').readFileSync(0,'utf8'))))"],input=raw.encode(),cwd=R).decode().strip();manifest={'account':'699561669180','region':'us-east-1','functions':[]}
 for c in rows:
  env={**c['Environment']['Variables'],'FINANCE_ROLLOUT_CONFIG':raw,'FINANCE_ROLLOUT_SHA256':digest};assert sum(len(k.encode())+len(v.encode()) for k,v in env.items())<4096;manifest['functions'].append({'name':c['FunctionName'],'arn':c['FunctionArn'],'env':{**env,'AWS_REGION':'us-east-1'}})
 defines=json.loads(pathlib.Path('/private/tmp/finance103/user-dart-defines.private.json').read_text());defines['ORDER_LIVE_ACTIVITY_ENABLED']='true';defines['FINANCE_TEST_CHECKOUT_ATTEMPT']=json.dumps({'schemaVersion':1,'userId':selector['userId'],'branchId':selector['branchId'],'requestId':selector['requestId']},separators=(',',':'))
 for name,data in [('before.private.json',rows),('manifest.private.json',manifest),('scope.private.json',candidate),('user-dart-defines.private.json',defines)]:
  p=O/name;p.write_text(json.dumps(data,default=str));p.chmod(0o600)
 (O/'selector.private.json').chmod(0o600);subprocess.run(['node','scripts/check-finance-rollout-deployment.cjs',str(O/'manifest.private.json')],cwd=R,check=True,capture_output=True)
 print(json.dumps({'prepared':True,'hosts':len(rows),'newOrders':1,'oldUnusedAttemptAbsent':True,'oldAttemptHasNoHoldsOffersOrJobs':True,'existingHistoricalPinsPreserved':True,'ownerMatchesFattoush':True,'driverAvailable':str(w['availableBalance']),'admitUntil':new['admitUntil'],'applicationWrites':False}))
if __name__=='__main__':main()
