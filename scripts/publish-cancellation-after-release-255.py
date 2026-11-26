import pathlib,json,zipfile,copy,hashlib,base64,re,subprocess,sys,time,boto3
root=pathlib.Path(__file__).resolve().parents[1];p=root/'backend/.tmp/cancel-after-release-255';changes={}
for name in ['staff-order-management-runtime.js','order-exception-runtime-229.js']:
 s=(p/'base'/name).read_text();start=s.index('async function prepareFullCashRelease(');end=s.index('\n}',start)+2;block=s[start:end]
 m=re.search(r'if \((H\d*) \|\| hold \|\| order.driverId != null \|\| order.holdId != null\) return (fail\d*)\(\);\s*operations.push\(\{ ConditionCheck: \{ TableName: "staging-Holds", Key: (holdKey\d*), ConditionExpression: "attribute_not_exists\(orderId\)" \} \}\);',block);assert m,name
 h,fail,hk=m.groups();replacement=f'''if ({h} || order.driverId!=null || order.assignedDriverId!=null || order.holdId!=null)return {fail}();
 if(hold){{
 const r=order.financialRelease,key={{orderId,sk:'ASSIGNMENT_RELEASE#'+r?.attempt}},archive=r?await strongGet(db,'staging-Holds',key):null;
 if(!terminal||!r||!Number.isSafeInteger(r.attempt)||r.attempt<1||order.assignmentAttemptCounter!==r.attempt||!archive||archive.kind!=='COD_ASSIGNMENT_RELEASE'||archive.outcome!=='UNASSIGNED'||archive.orderId!==orderId||archive.attempt!==r.attempt||archive.offerId!==r.offerId||archive.operationId!==r.operationId||archive.branchId!==order.storeId||archive.snapshotDigest!==quoteHash(order.financialSnapshot)||hold.financialSchemaVersion!==4||hold.status!=='RELEASED'||hold.releaseOperationId!==r.operationId||hold.metadata?.assignmentAttempt!==r.attempt||hold.metadata?.offerId!==r.offerId||hold.walletId!=='WALLET#DRIVER#'+archive.driverId||!equal(hold,archive.releasedHold))return {fail}();
 operations.push(exactCheck('staging-Holds',{hk},hold),exactCheck('staging-Holds',key,archive));
 }}else operations.push({{ConditionCheck:{{TableName:'staging-Holds',Key:{hk},ConditionExpression:'attribute_not_exists(orderId)'}}}});'''
 block=block[:m.start()]+replacement+block[m.end():]
 old='!equal(budget.platformGoodsFunding, offer.allocation.platformGoodsDiscountFunding)';assert block.count(old)==1
 candidate=s[:start]+block+s[end:];path=p/name;path.write_text(candidate);subprocess.run(['node','--check',str(path)],check=True);changes[name]=candidate.encode()
if '--prepare' in sys.argv:print('PREPARED',list(changes));sys.exit()
assert 'fail 0' in pathlib.Path('/private/tmp/cancel255-tests.log').read_text()
assert 'fail 0' in pathlib.Path('/private/tmp/cancel255-bundle-tests.log').read_text()
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');cfg=json.loads((p/'config.json').read_text());c=l.get_function_configuration(FunctionName=cfg['FunctionName']);assert c['CodeSha256']==cfg['CodeSha256'],'LIVE_DRIFT'
sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode();assert sha((p/'base.zip').read_bytes())==c['CodeSha256']
with zipfile.ZipFile(p/'base.zip')as z:
 with zipfile.ZipFile(p/'candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for i in z.infolist():out.writestr(copy.copy(i),changes.get(i.filename,z.read(i.filename)))
 with zipfile.ZipFile(p/'candidate.zip')as out:assert all(z.read(n)==out.read(n)for n in z.namelist()if n not in changes)
raw=(p/'candidate.zip').read_bytes();l.update_function_code(FunctionName=cfg['FunctionName'],RevisionId=c['RevisionId'],ZipFile=raw)
for _ in range(50):
 after=l.get_function_configuration(FunctionName=cfg['FunctionName'])
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(1)
assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha(raw)
for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Architectures','VpcConfig']:assert after.get(k)==c.get(k)
report={'part':255,'status':'PUBLISHED','function':cfg['FunctionName'],'before':c['CodeSha256'],'after':after['CodeSha256'],'changedFiles':list(changes),'unrelatedZipEntriesIdentical':True,'configurationAndIamPreserved':True,'agentDirectBusinessWrites':False}
(root/'docs/cancellation-after-unassignment-publication-255.json').write_text(json.dumps(report,indent=2)+'\n');print('PUBLISHED',cfg['FunctionName'])
