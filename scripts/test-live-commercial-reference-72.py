import pathlib,importlib.util,os,json,time,subprocess
R=pathlib.Path(__file__).resolve().parents[1];sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);s=m.session();d=s.client('dynamodb');name='staging-reference72-test-'+str(int(time.time()));out=pathlib.Path('/private/tmp/reference72');out.mkdir(exist_ok=True)
d.create_table(TableName=name,KeySchema=[{'AttributeName':'pk','KeyType':'HASH'},{'AttributeName':'sk','KeyType':'RANGE'}],AttributeDefinitions=[{'AttributeName':'pk','AttributeType':'S'},{'AttributeName':'sk','AttributeType':'S'}],BillingMode='PAY_PER_REQUEST')
try:
 d.get_waiter('table_exists').wait(TableName=name);c=s.get_credentials().get_frozen_credentials();env=os.environ.copy();env.update(AWS_ACCESS_KEY_ID=c.access_key,AWS_SECRET_ACCESS_KEY=c.secret_key,AWS_SESSION_TOKEN=c.token,REFERENCE_TEST_TABLE=name);env.pop('AWS_PROFILE',None);env.pop('AWS_DEFAULT_PROFILE',None);p=subprocess.run(['node','scripts/test-live-commercial-reference-72.cjs'],cwd=R,env=env,capture_output=True,text=True);assert p.returncode==0,p.stderr;result=json.loads(p.stdout);result['isolatedTable']=name
finally:
 d.delete_table(TableName=name);d.get_waiter('table_not_exists').wait(TableName=name)
result['isolatedTableDeleted']=True;(out/'live-test.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
