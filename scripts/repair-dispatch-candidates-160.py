"""Fix staging candidate discovery against actual no-GSI schema; add bounded non-PII transition diagnostics."""
import pathlib,zipfile,io,json,copy,subprocess,hashlib,base64,time,sys
p=pathlib.Path('/private/tmp/dispatch-test-160');names=['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout'];artifacts=[]
for name in names:
 cfg=json.loads((p/(name+'.config.private.json')).read_text());old=(p/(name+'.zip')).read_bytes();assert base64.b64encode(hashlib.sha256(old).digest()).decode()==cfg['CodeSha256'];z=zipfile.ZipFile(io.BytesIO(old));file='dispatch-cycle-runtime.js';s=z.read(file).decode()
 a='const result = all ? await db.send(new import_lib_dynamodb7.ScanCommand({ ...q6, FilterExpression: "#s=:available" })) : await db.send(new import_lib_dynamodb7.QueryCommand({ ...q6, IndexName: "RegionStatusIndex", KeyConditionExpression: "current_work_region_id=:region AND #s=:available" }));'
 assert s.count(a)==1;s=s.replace(a,'const result = await db.send(new import_lib_dynamodb7.ScanCommand({ ...q6, FilterExpression: all ? "#s=:available" : "current_work_region_id=:region AND #s=:available" }));')
 a='await commit2(tx);\n      } catch {\n        const fresh = await bound(input.orderId, input.assignmentId);';assert s.count(a)==1;s=s.replace(a,'await commit2(tx);\n      } catch (error) {\n        console.error("DISPATCH_TRANSITION_COMMIT_FAILED", {code:error?.name??"Unknown",reasons:(error?.CancellationReasons??[]).map(r=>r.Code??"None")});\n        const fresh = await bound(input.orderId, input.assignmentId);')
 f=p/(name+'.candidate.js');f.write_text(s);subprocess.run(['node','--check',str(f)],check=True);out=io.BytesIO()
 with zipfile.ZipFile(out,'w') as dest:
  for item in z.infolist():dest.writestr(copy.copy(item),s.encode() if item.filename==file else z.read(item.filename))
 b=out.getvalue();(p/(name+'.candidate.zip')).write_bytes(b);fresh=zipfile.ZipFile(io.BytesIO(b));assert all(z.read(n)==fresh.read(n) for n in z.namelist() if n!=file);artifacts.append((name,cfg,b))
if '--apply' not in sys.argv:print('PREPARED',len(artifacts));sys.exit()
import boto3
l=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda');receipts=[]
for name,cfg,b in artifacts:
 c=l.get_function_configuration(FunctionName=name);assert c['RevisionId']==cfg['RevisionId'] and c['CodeSha256']==cfg['CodeSha256'];l.update_function_code(FunctionName=name,RevisionId=cfg['RevisionId'],ZipFile=b)
 for _ in range(45):
  c=l.get_function_configuration(FunctionName=name)
  if c['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert c['LastUpdateStatus']=='Successful' and c['CodeSha256']==base64.b64encode(hashlib.sha256(b).digest()).decode();assert c['Role']==cfg['Role'] and c['Environment']==cfg['Environment'];receipts.append({'function':name,'codeSha256':c['CodeSha256'],'verified':True,'configurationUnchanged':True});print(name,'VERIFIED',flush=True)
pathlib.Path('docs/dispatch-candidate-repair-160.json').write_text(json.dumps({'receipts':receipts,'newIam':False,'currentOrderRecoveryPending':True},indent=2)+'\n')
