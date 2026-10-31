"""Publish reviewed final lifecycle guard/error projection, preserving all other closed-release bytes."""
import pathlib,json,zipfile,subprocess,copy,base64,hashlib,boto3
ROOT=pathlib.Path(__file__).resolve().parents[1];R=pathlib.Path('/private/tmp/finance60');M=ROOT.parent/'whizzMerchants-stg'
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
def main():
 state=json.loads((R/'publication.json').read_text());prep=json.loads((R/'preparation.json').read_text());assert state['activationPerformed'] is False
 subprocess.run([str(ROOT/'backend/wallet-service/node_modules/.bin/esbuild'),str(M/'backend/functions/auth/commercial_agreements.js'),'--bundle','--platform=node','--target=node22','--outfile='+str(R/'commercial_agreements.final.js')],check=True)
 s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';lam=s.client('lambda')
 for kind,target,source in [('staff','commercial-management.js',ROOT/'backend/staff-service/commercial-management.js'),('merchant','commercial_agreements.js',R/'commercial_agreements.final.js')]:
  row=next(x for x in state['functions'] if x['name']==prep['base'][kind]['name']);current=lam.get_function_configuration(FunctionName=row['name']);assert current['CodeSha256']==row['codeSha256'] and current['RevisionId']==row['revisionId'];assert current.get('Environment',{}).get('Variables',{}).get('COMMERCIAL_ADMIN_ENABLED')!='true'
  old=R/(kind+'.candidate.zip');assert sha(old.read_bytes())==row['codeSha256'];new=R/(kind+'.final.zip');assert not new.exists()
  with zipfile.ZipFile(old) as z,zipfile.ZipFile(new,'w',zipfile.ZIP_DEFLATED) as out:
   for info in z.infolist():out.writestr(copy.copy(info),source.read_bytes() if info.filename==target else z.read(info.filename))
  with zipfile.ZipFile(old) as z,zipfile.ZipFile(new) as out:assert all(z.read(n)==out.read(n) for n in z.namelist() if n!=target)
  lam.update_function_code(FunctionName=row['name'],RevisionId=current['RevisionId'],ZipFile=new.read_bytes(),Publish=False);lam.get_waiter('function_updated_v2').wait(FunctionName=row['name'],WaiterConfig={'Delay':2,'MaxAttempts':90});cfg=lam.get_function_configuration(FunctionName=row['name']);assert cfg['CodeSha256']==sha(new.read_bytes());assert cfg.get('Environment')==current.get('Environment');assert cfg['Role']==current['Role']
  state.setdefault('finalReviewCorrections',[]).append({'name':row['name'],'beforeCodeSha256':row['codeSha256'],'changedFile':target,'environmentPreserved':True});row['codeSha256']=cfg['CodeSha256'];row['revisionId']=cfg['RevisionId'];prep['packages'][kind]['codeSha256']=cfg['CodeSha256']
  old.rename(R/(kind+'.first-publication.zip'));new.rename(old);(R/'publication.json').write_text(json.dumps(state,indent=2));(R/'preparation.json').write_text(json.dumps(prep,indent=2));print(json.dumps({'correctedClosedHost':kind}),flush=True)
if __name__=='__main__':main()
