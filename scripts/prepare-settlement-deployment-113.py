"""Offline narrow overlays against fresh captured Staging packages. No AWS calls."""
import pathlib,json,importlib.util,zipfile,hashlib,difflib
ROOT=pathlib.Path(__file__).resolve().parents[1];M=ROOT.parent/'whizzMerchants-stg';O=pathlib.Path('/private/tmp/finance113')
def once(s,a,b):
 assert s.count(a)==1,'PATCH_ANCHOR_CHANGED';return s.replace(a,b,1)
def main():
 assert not (O/'preparation.json').exists(),'ALREADY_PREPARED'
 inv=json.loads((O/'inventory.json').read_text())['hosts'];spec=importlib.util.spec_from_file_location('overlay',ROOT/'scripts/prepare-central-pricing-release-56.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);changes={}
 with zipfile.ZipFile(O/'staff.zip') as z:
  local=(ROOT/'backend/staff-service/index.js').read_text();additions=[line for line in local.splitlines(True) if 'settlement_schedule_owner' in line or "path==='/staff/settlement-schedules" in line];assert len(additions)==3
  assert local==z.read('index.js').decode().replace(" if(event?.action==='commercial_owner')",additions[0]+" if(event?.action==='commercial_owner')",1).replace("  if(path==='/staff/commercial')",''.join(additions[1:])+"  if(path==='/staff/commercial')",1),'STAFF_INDEX_DRIFT'
  base=z.read('commercial-owner.js').decode();candidate=once(base,"if(ctx.enabled!==true)return {statusCode:503,code:'COMMERCIAL_MANAGEMENT_DISABLED'};", "if(ctx.enabled!==true)return {statusCode:503,code:event?.action==='settlement_schedule_owner'?'SETTLEMENT_SCHEDULE_ADMIN_DISABLED':'COMMERCIAL_MANAGEMENT_DISABLED'};")
  candidate=once(candidate,"const result=await require('./commercial-management').service(ctx,{kind:'OWNER',sub:claims.sub},event.httpMethod,event.input);", "const result=event.action==='settlement_schedule_owner'?await require('./settlement-schedules').owner(ctx,claims.sub,event.httpMethod,event.input):await require('./commercial-management').service(ctx,{kind:'OWNER',sub:claims.sub},event.httpMethod,event.input);")
  assert candidate==(ROOT/'backend/staff-service/commercial-owner.js').read_text(),'OWNER_WRAPPER_DRIFT'
  changes['staff']={n:(ROOT/'backend/staff-service'/n).read_bytes() for n in ['index.js','commercial-owner.js','settlement-schedules.js','settlement-runtime.js']}
 with zipfile.ZipFile(O/'merchant.zip') as z:
  unified=once(z.read('unified_auth_handler.js').decode(),"['/auth/commercial-agreements',", "['/auth/settlement-schedules','/auth/commercial-agreements',")
  onboarding=once(z.read('person_onboarding.js').decode()," if(path==='/auth/commercial-agreements')", " if(path==='/auth/settlement-schedules')return require('./settlement_schedules').route(event,input);\n if(path==='/auth/commercial-agreements')")
  assert onboarding==(M/'backend/functions/auth/person_onboarding.js').read_text(),'MERCHANT_ONBOARDING_DRIFT'
  changes['merchant']={'unified_auth_handler.js':unified.encode(),'person_onboarding.js':onboarding.encode(),'settlement_schedules.js':(M/'backend/functions/auth/settlement_schedules.js').read_bytes()}
  # Intentionally preserve unrelated local unified-auth differences from the live package.
 with zipfile.ZipFile(O/'worker.zip') as z:
  local=(ROOT/'backend/account-deletion/merchant-worker.js').read_text();hook="await require('./settlement-retention').settlementRetention({db,r,job,requestTable,archiveTable});";assert local.replace(hook,'',1)==z.read('merchant-worker.js').decode(),'WORKER_DRIFT'
  retained=(ROOT/'backend/account-deletion/cod-retention.js').read_text();fields="'settlementBatchId','settlementLineDigest','settlementClaimedAt',";assert retained.replace(fields,'',1)==z.read('cod-retention.js').decode(),'COD_RETENTION_DRIFT'
  changes['worker']={n:(ROOT/'backend/account-deletion'/n).read_bytes() for n in ['merchant-worker.js','cod-retention.js','settlement-retention.js','settlement-schedule-inventory.js']}
 with zipfile.ZipFile(O/'expiry.zip') as z:
  purge=(ROOT/'backend/account-deletion/financial-purge.js').read_text();hook="if(a.kind==='merchant_settlement'){if(a.purgeBlocked!==true||a.expiresAt!==undefined)throw error('SETTLEMENT_PURGE_ADAPTER_REQUIRED');blocked++;continue;}";assert purge.replace(hook,'',1)==z.read('financial-purge.js').decode(),'EXPIRY_DRIFT'
  changes['expiry']={'financial-purge.js':purge.encode()}
 packages={k:m.archive(O/(k+'.zip'),O/(k+'.candidate.zip'),v) for k,v in changes.items()}
 with zipfile.ZipFile(O/'frontend.zip') as z:
  names=['pages/finance.html','pages/merchants.html'];web={}
  marker='<details id="merchant-settlement-schedules" data-settlement-schedules data-independent-source="true" dir="rtl" style="background:white;padding:20px;margin:20px 0;border-radius:16px"></details>'
  live=z.read(names[0]).decode();web[names[0]]=once(once(live,'<main id="content" hidden>',marker+'<main id="content" hidden>'),'</body>','<script src="../settlement-schedules.js?v=113"></script>\n</body>').encode()
  live=z.read(names[1]).decode();web[names[1]]=once(live,'            <details id="merchant-types-section"','            <p><a href="finance.html#merchant-settlement-schedules">إدارة جداول تسوية مستحقات المتاجر في القسم المالي</a></p>\n            <details id="merchant-types-section"').encode()
  web['settlement-schedules.js']=(ROOT/'frontend/settlement-schedules.js').read_bytes()
  # Preserve the captured hosted Arabic shell. Local HTML also contains unrelated
  # unpublished differences; only the explicit reviewed insertion is released.
  assert marker.encode() in web['pages/finance.html']
  assert b'settlement-schedules.js?v=113' in web['pages/finance.html']
 packages['frontend']=m.archive(O/'frontend.zip',O/'frontend.candidate.zip',web)
 policy={'Version':'2012-10-17','Statement':[
  {'Sid':'PinRetainedSettlementSources','Effect':'Allow','Action':['dynamodb:ConditionCheckItem'],'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/staging-MerchantPlatform','Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['BRANCH#*','MERCHANT_SETTLEMENT#*']}}},
  {'Sid':'ReadAndPinSettlementScheduleAudit','Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:Query','dynamodb:ConditionCheckItem'],'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff','Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['SETTLEMENT_SCHEDULE_AUDIT#*']}}}
 ]}
 (ROOT/'backend/finance-settlement-retention-access.staging.json').write_text(json.dumps({'targetRole':inv['worker']['role'],'policyName':'SettlementRetention113','policyDocument':policy},indent=2)+'\n')
 manifest={'part':113,'base':inv,'frontendBase':json.loads((O/'frontend-inventory.json').read_text()),'packages':packages,'scope':'Staging only; preserve all unrelated package entries','activation':False,'awsMutations':0,'pendingPermission':'Worker retention source checks and read-only schedule audit namespace'}
 (O/'preparation.json').write_text(json.dumps(manifest,indent=2));(O/'preparation.json').chmod(0o600)
 print(json.dumps({'preparedPackages':list(packages),'changedFiles':{k:v['changedFiles'] for k,v in packages.items()},'awsMutations':0,'activation':False}))
if __name__=='__main__':main()
