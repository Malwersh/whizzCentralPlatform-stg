"""Publish or verify the reviewed part-27/28 ZIPs only; no environment, IAM or API mutation."""
import argparse,base64,hashlib,json,time,urllib.request,zipfile,io
from pathlib import Path
import boto3

NAMES={'WizzUser-CreateOrder-staging','WizzUser-GetOrder-staging','WizzUser-GetUserOrders-staging','WizzUser-GetGuestOrders-staging','WizzUser-SearchOrderByNumber-staging','WizzUser-CancelOrder-staging','WizzUser-UpdateOrderStatus-staging','order-receiver-merchant-orders-staging-v1'}
FENCE_NAMES={'WizzUser-GetUserOrders-staging','WizzUser-CreateOrder-staging','WizzUser-UpdateOrderStatus-staging','WizzUser-CancelOrder-staging','WizzUser-GetGuestOrders-staging','WizzUser-MerchantOrderStatusUpdate-staging','order-receiver-merchant-orders-staging-v1','OrderService-staging','DriversApi-staging','WaveSystem_HandleDriverAccept'}
ACCOUNT='699561669180'
CLOSED=['DriversApi-staging','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept','staging-cod-integration']

def run(a):
    audit=Path(a.audit).resolve();release=Path(a.release).resolve()
    manifest=json.loads((release/'manifest.json').read_text());inventory=json.loads((audit/'inventory.json').read_text())
    assert manifest['account']==ACCOUNT and manifest['region']=='us-east-1' and manifest['activation']=='OFF'
    assert not any(manifest[k] for k in ['environmentMutation','iamMutation','apiMutation'])
    assert {f['name'] for f in manifest['functions']}==(NAMES if a.release_part==27 else FENCE_NAMES)
    session=boto3.Session(profile_name=a.profile,region_name='us-east-1')
    assert session.client('sts').get_caller_identity()['Account']==ACCOUNT
    client=session.client('lambda');s3=session.client('s3')
    for name in CLOSED:
        env=client.get_function_configuration(FunctionName=name).get('Environment',{}).get('Variables',{})
        assert all(v=='OFF' for k,v in env.items() if k.startswith('FINANCIAL_') and k.endswith('_MODE'))
    configs={};sources={f['name']:f for f in inventory['functions']}
    for f in manifest['functions']:
        name=f['name'];r=client.get_function(FunctionName=name);c=r['Configuration'];configs[name]=c
        original=json.loads((audit/(name+'.configuration.private.json')).read_text())
        assert (c['CodeSha256']==f['codeSha256']) if a.verify_published else (c['RevisionId']==f['baseRevisionId'] and c['CodeSha256']==f['baseCodeSha256'])
        assert c.get('Environment',{})==original.get('Environment',{}) and c['Handler']==f['handler']
        assert r['Tags']['aws:cloudformation:stack-name']==f['ownerStack']
        env=c.get('Environment',{}).get('Variables',{})
        assert env.get('DELIVERY_QUOTE_MODE','OFF')=='OFF' and env.get('COMMERCIAL_PRICING_MODE','OFF')=='OFF'
        raw=(release/(name+'.candidate.zip')).read_bytes();assert base64.b64encode(hashlib.sha256(raw).digest()).decode()==f['codeSha256']
        with zipfile.ZipFile(audit/(name+'.zip')) as old,zipfile.ZipFile(io.BytesIO(raw)) as new:
            replaced=set(f['replacedFiles']);added=set(f['addedFiles'])
            assert set(new.namelist())==set(old.namelist())|added
            for key in old.namelist():
                if key not in replaced:assert old.read(key)==new.read(key)
            if f.get('legacySourcePrefixPreserved',False):
                entry=f['handler'].rsplit('.',1)[0]+'.js';before=old.read(entry);after=new.read(entry)
                assert after.startswith(before) and after[len(before):].startswith(b'\n// COD_DEPENDENCIES_V1:')
                assert len(after[len(before):])<600
    print(json.dumps({'reviewedFunctions':len(configs),'financialActivation':'OFF','publishRequested':a.publish}),flush=True)
    if not (a.publish or a.verify_published):return
    if a.publish:
        results=[];output=release/'publication.json'
        assert not output.exists(),'ALREADY_PUBLISHED_OR_PARTIAL_RELEASE_REQUIRES_REVIEW'
        bucket='aws-sam-cli-managed-default-samclisourcebucket-c0s0eilxsprc'
        for f in manifest['functions']:
            name=f['name'];raw=(release/(name+'.candidate.zip')).read_bytes();key='cod'+str(a.release_part)+'/2026-10-16/'+hashlib.sha256(raw).hexdigest()+'.zip'
            s3.put_object(Bucket=bucket,Key=key,Body=raw,ExpectedBucketOwner=ACCOUNT,ServerSideEncryption='AES256')
            client.update_function_code(FunctionName=name,S3Bucket=bucket,S3Key=key,RevisionId=f['baseRevisionId'],Publish=False)
            for _ in range(90):
                c=client.get_function_configuration(FunctionName=name)
                if c['LastUpdateStatus']=='Successful':break
                assert c['LastUpdateStatus']!='Failed','LAMBDA_UPDATE_FAILED'
                time.sleep(2)
            else:raise RuntimeError('LAMBDA_UPDATE_TIMEOUT')
            assert c['CodeSha256']==f['codeSha256'] and c.get('Environment',{})==configs[name].get('Environment',{})
            results.append({'name':name,'codeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'environmentUnchanged':True})
            output.write_text(json.dumps(results,indent=2)+'\n');print('Verified '+name,flush=True)
    else:
        results=json.loads((release/'publication.json').read_text())
        assert len(results)==len(manifest['functions'])
    probes=[]
    for name in (NAMES if a.release_part==27 else FENCE_NAMES):
        r=client.invoke(FunctionName=name,InvocationType='RequestResponse',Payload=json.dumps({'httpMethod':'OPTIONS','headers':{},'body':''}).encode())
        assert not r.get('FunctionError'),name
        result=json.load(r['Payload']);assert result.get('statusCode') in ([400] if name=='WaveSystem_HandleDriverAccept' else [401] if name=='DriversApi-staging' else [200,204]),(name,result.get('statusCode'))
        probes.append({'name':name,'probe':'MISSING_FIELDS_NO_DATA_ACCESS' if name=='WaveSystem_HandleDriverAccept' else 'ANONYMOUS_AUTH_REJECTION_NO_DATA_ACCESS' if name=='DriversApi-staging' else 'OPTIONS_NO_DATA_ACCESS','statusCode':result['statusCode']})
    for body,resource in [({'quoteId':'cod27-closed'},'/orders'),({'action':'preview_commercial'},'/orders/commercial-preview')]:
        r=client.invoke(FunctionName='WizzUser-CreateOrder-staging',InvocationType='RequestResponse',Payload=json.dumps({'httpMethod':'POST','resource':resource,'body':json.dumps(body)}).encode())
        assert not r.get('FunctionError');result=json.load(r['Payload']);payload=json.loads(result['body'])
        assert result['statusCode']==409 and payload['code']=='COMMERCIAL_NOT_ENABLED'
        probes.append({'name':'WizzUser-CreateOrder-staging','probe':'CLOSED_QUOTED_OR_PREVIEW_REQUEST','statusCode':409})
    (release/'runtime-verification.json').write_text(json.dumps({'functionsVerified':len(results),'financialActivation':'OFF','environmentMutation':False,'probes':probes,'humanDataAccess':False,'otpSent':False,'pushSent':False},indent=2)+'\n')
    print(json.dumps({'functionsVerified':len(results),'probes':len(probes),'financialActivation':'OFF'}),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('audit');parser.add_argument('release');parser.add_argument('--profile',default='Wizz_stg_UserApp');mode=parser.add_mutually_exclusive_group();mode.add_argument('--publish',action='store_true');mode.add_argument('--verify-published',action='store_true');parser.add_argument('--release-part',type=int,choices=[27,28],default=27);run(parser.parse_args())
