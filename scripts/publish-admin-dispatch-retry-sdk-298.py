from pathlib import Path
import json,subprocess,zipfile,copy,hashlib,base64
R=Path.cwd();P=R/'backend/.tmp/admin-dispatch-retry-298';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];doc=R/'docs/admin-dispatch-retry-publication-298.json'
def aws(*a):return json.loads(subprocess.check_output(B+list(a)))
assert 'ℹ fail 0'in Path('/private/tmp/admin-retry-298-actual-sdk-bridges-tests.log').read_text()
rows=json.load(open(P/'sdk-packages.json'))
q=P/'WaveSystem_HandleWaveTimeout';z=zipfile.ZipFile(q/'candidate.zip');s=z.read('dispatch-cycle-runtime.js').decode();old='''            } catch {
              failed++;
            }
''';new='''            } catch (error) {
              failed++;
              const value = error?.code ?? error?.message;
              console.error("DISPATCH_HOST_ORDER_FAILED", {orderId:r.orderId,code:typeof value==="string"&&/^[A-Z0-9_]{1,100}$/.test(value)?value:String(error?.name??"UnknownError"),origin:String(error?.stack??'').split('\\n').slice(1,4).map(x=>x.slice(0,220))});
            }
''';assert s.count(old)==1;s=s.replace(old,new);(q/'sdk-runtime.js').write_text(s);subprocess.run(['node','--check',str(q/'sdk-runtime.js')],check=True)
with zipfile.ZipFile(q/'sdk-candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
 for info in z.infolist():out.writestr(copy.copy(info),s.encode()if info.filename=='dispatch-cycle-runtime.js'else z.read(info.filename))
row=next(x for x in rows if x['name']=='WaveSystem_HandleWaveTimeout');row['hash']=base64.b64encode(hashlib.sha256((q/'sdk-candidate.zip').read_bytes()).digest()).decode()
# No new cycle may be started until the sender and acceptance endpoints use the same SDK boundary.
priority=['WaveSystem_StartWave','staging-driver-financial-accept','WaveSystem_HandleWaveTimeout']
rows.sort(key=lambda x:priority.index(x['name'])if x['name']in priority else len(priority))
report=json.load(open(doc));report['sdkBoundaryOverlay']={'status':'PUBLISHING','tests':47,'failed':0,'functions':[],'iamChanged':False,'businessDataWrittenDirectly':False}
for row in rows:
 n=row['name'];cfg=aws('lambda','get-function-configuration','--function-name',n);assert cfg['CodeSha256']==row['liveBeforeSdkHash'],'LIVE_DRIFT '+n
 p=P/n/('sdk-candidate.zip'if n=='WaveSystem_HandleWaveTimeout'else'candidate.zip')
 aws('lambda','update-function-code','--function-name',n,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(p));subprocess.run(B+['lambda','wait','function-updated-v2','--function-name',n],check=True)
 after=aws('lambda','get-function-configuration','--function-name',n);assert after['CodeSha256']==row['hash']and after['Environment']==cfg['Environment']and after['Role']==cfg['Role']
 report['sdkBoundaryOverlay']['functions'].append({'name':n,'beforeHash':row['liveBeforeSdkHash'],'hash':row['hash'],'configurationPreserved':True});doc.write_text(json.dumps(report,indent=2)+'\n');print('SDK bridge published',n,flush=True)
report['sdkBoundaryOverlay']['status']='PUBLISHED_VERIFIED';doc.write_text(json.dumps(report,indent=2)+'\n')
