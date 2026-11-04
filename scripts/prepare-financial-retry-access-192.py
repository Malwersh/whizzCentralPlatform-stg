"""Prepare exact-key, time-limited read/fence access. No grant is applied here."""
import pathlib,json,hashlib
p=pathlib.Path('/private/tmp/financial-retry-192');case='DISPATCH_REVIEW#254030a354294ab77b82feaa0ed06144b70050c10503b25801643d42093c9a1e';order='0277eafa-183c-506a-8eae-cb4b3c65b1a4';until='2026-10-19T20:00:00Z';rows=[]
def statement(table,keys):return {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/'+table,'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':keys},'DateLessThan':{'aws:CurrentTime':until}}}
for name in ['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept']:
 cfg=json.loads((p/(name+'.private.json')).read_text());statements=[statement('staging-PlatformStaff',[case])] if name!='WaveSystem_HandleWaveTimeout' else [statement('staging-PlatformStaff',['DELIVERY_RESERVATION#'+order]),statement('staging-Wallets',['WALLET#PLATFORM'])]
 policy={'Version':'2012-10-17','Statement':statements};file=p/(name+'.recovery-read-policy.json');file.write_text(json.dumps(policy,indent=2)+'\n');rows.append({'name':name,'role':cfg['Role'].rsplit('/',1)[1],'policyName':'FundedDispatchRecoveryRead192','policyFile':str(file),'expiresAt':until,'actions':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
(p/'read-access-plan.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(rows))
