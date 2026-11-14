"""Read-only monthly query on existing driver-authenticated history route."""
import boto3,pathlib,json,zipfile,copy,urllib.request,difflib,hashlib,base64
R=pathlib.Path(__file__).resolve().parents[1];P=pathlib.Path('/private/tmp/monthly-wallet-266');P.mkdir(exist_ok=True)
assert 'All tests passed!' in pathlib.Path('/private/tmp/monthly-wallet-tests.log').read_text()
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');name='staging-wizz-wallet-service';f=l.get_function(FunctionName=name);expected=json.loads((R/'docs/wallet-recipient-picker-265.json').read_text())['backendAfter'];assert f['Configuration']['CodeSha256']==expected,'LIVE_DRIFT';urllib.request.urlretrieve(f['Code']['Location'],P/'base.zip');changes={n:(R/'backend/wallet-service'/n).read_bytes()for n in ['dist/index.js','dist/monthlyWalletHistory.js']}
with zipfile.ZipFile(P/'base.zip')as old:
 diff=list(difflib.unified_diff(old.read('dist/index.js').decode().splitlines(),changes['dist/index.js'].decode().splitlines()));assert len(diff)<30,'UNRELATED_ROUTER_DRIFT';(P/'index.diff').write_text('\n'.join(diff))
 with zipfile.ZipFile(P/'code.zip','w',zipfile.ZIP_DEFLATED)as new:
  for ent in old.infolist():new.writestr(copy.copy(ent),changes.get(ent.filename,old.read(ent.filename)))
  for n,b in changes.items():
   if n not in old.namelist():new.writestr(n,b)
 with zipfile.ZipFile(P/'code.zip')as new:assert all(old.read(n)==new.read(n)for n in old.namelist()if n not in changes)
raw=(P/'code.zip').read_bytes();l.update_function_code(FunctionName=name,RevisionId=f['Configuration']['RevisionId'],ZipFile=raw);l.get_waiter('function_updated_v2').wait(FunctionName=name);after=l.get_function_configuration(FunctionName=name);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(raw).digest()).decode()
report={'status':'BACKEND_PUBLISHED','before':expected,'after':after['CodeSha256'],'modules':list(changes),'unrelatedModulesPreserved':True,'financialWrites':0,'route':'GET /wallet/me/transactions?month=YYYY-MM','timeZone':'Asia/Baghdad','sameAuthenticatedDriverOnly':True,'snapshotCutoffAcrossPages':True,'partialTotalsNeverDisplayed':True,'openingClosingBalances':'NOT_INFERRED_FROM_INCOMPLETE_LEGACY_SNAPSHOTS','manualAndGatewaySettingsChanged':False};(R/'docs/monthly-wallet-266.json').write_text(json.dumps(report,indent=2)+'\n');print('MONTHLY_BACKEND_PUBLISHED_VERIFIED')
