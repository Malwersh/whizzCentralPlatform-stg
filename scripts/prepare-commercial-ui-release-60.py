"""Narrow, offline overlays of commercial UI/closed handlers on captured live code."""
import importlib.util,pathlib,json,zipfile,re,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1];R=pathlib.Path('/private/tmp/finance60');M=ROOT.parent/'whizzMerchants-stg'
spec=importlib.util.spec_from_file_location('overlay',ROOT/'scripts/prepare-central-pricing-release-56.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def once(text,old,new):
 assert text.count(old)==1,'PATCH_ANCHOR_CHANGED';return text.replace(old,new,1)
def main():
 inv=json.loads((R/'inventory.json').read_text());changes={}
 with zipfile.ZipFile(R/'staff.zip') as z:
  local=(ROOT/'backend/staff-service/index.js').read_text();added=[line for line in local.splitlines(True) if "event?.action==='commercial_owner'" in line or "path==='/staff/commercial'" in line];assert len(added)==2
  stripped=local
  for line in added:stripped=stripped.replace(line,'',1)
  assert stripped==z.read('index.js').decode(),'UNREVIEWED_STAFF_INDEX_DRIFT'
  changes['index.js']=local.encode()
  # Added dedicated roles only; no change to existing role definitions.
  old=z.read('catalog.js').decode();new=(ROOT/'backend/staff-service/catalog.js').read_text();assert all(x in new for x in ['commercial_viewer','commercial_editor','commercial_approver'])
  removed=new
  for line in new.splitlines(True):
   if line.startswith(' commercial_'):removed=removed.replace(line,'',1)
  removed=re.sub(r"commercial_viewer:'[^']*',commercial_editor:'[^']*',commercial_approver:'[^']*',",'',removed)
  removed=removed.replace("'commercial_viewer','commercial_editor','commercial_approver',",'');assert removed==old,'UNREVIEWED_CATALOG_DRIFT';changes['catalog.js']=new.encode()
 for name in ['commercial-management.js','commercial-owner.js','pricing-runtime/money.js','pricing-runtime/deliveryPricing.js','pricing-runtime/orderAllocation.js','pricing-runtime/deliveryQuoteRecord.js','pricing-runtime/orderCommercialPricing.js']:changes[name]=(ROOT/'backend/staff-service'/name).read_bytes()
 outputs={'staff':module.archive(R/'staff.zip',R/'staff.candidate.zip',changes)}
 with zipfile.ZipFile(R/'merchant.zip') as z:
  changes={};live=z.read('unified_auth_handler.js').decode();changes['unified_auth_handler.js']=once(live,"if (['/auth/order-cancellation'","if (['/auth/commercial-agreements','/auth/order-cancellation'").encode()
  live=z.read('person_onboarding.js').decode();anchor=" if(path==='/auth/business-changes')";changes['person_onboarding.js']=once(live,anchor," if(path==='/auth/commercial-agreements')return require('./commercial_agreements').route(event,input);\n"+anchor).encode()
 bundle=R/'commercial_agreements.js';subprocess.run([str(ROOT/'backend/wallet-service/node_modules/.bin/esbuild'),str(M/'backend/functions/auth/commercial_agreements.js'),'--bundle','--platform=node','--target=node22','--outfile='+str(bundle)],check=True);changes['commercial_agreements.js']=bundle.read_bytes();outputs['merchant']=module.archive(R/'merchant.zip',R/'merchant.candidate.zip',changes)
 with zipfile.ZipFile(R/'frontend.zip') as z:
  changes={'commercial-management.js':(ROOT/'frontend/commercial-management.js').read_bytes(),'delivery-pricing.js':(ROOT/'frontend/delivery-pricing.js').read_bytes()}
  for name in ['merchants','promotions']:
   text=z.read('pages/'+name+'.html').decode();local=(ROOT/'frontend/pages'/str(name+'.html')).read_text();section=re.search(r'<details data-commercial-kind=.*?</details>',local,re.S).group();text=once(text,'<div class="page-content">','<div class="page-content">\n'+section);text=once(text,'</body>','<script src="../commercial-management.js?v=20261016-60"></script>\n</body>');changes['pages/'+name+'.html']=text.encode()
  text=z.read('merchants.js').decode();local=(ROOT/'frontend/merchants.js').read_text();extra=local.split('function viewMerchantDetails(merchantId) {',1)[1].split('\n\n',1)[0];changes['merchants.js']=once(text,'function viewMerchantDetails(merchantId) {','function viewMerchantDetails(merchantId) {'+extra+'\n').encode()
  text=z.read('assets/js/rbac.js').decode();text=once(text,"if(pageName==='settings.html')return","if(['merchants.html','promotions.html'].includes(pageName)&&this.staff.permissions.includes('commercial.read'))return true;\n            if(pageName==='settings.html')return");text=once(text,"actionButtons.forEach(button => {\n            const text","actionButtons.forEach(button => {\n            if(button.closest('[data-commercial-kind]'))return;\n            const text");text=once(text,"if (!input.closest('.search-form')) {","if (!input.closest('.search-form') && !input.closest('[data-commercial-kind]')) {");changes['assets/js/rbac.js']=text.encode()
 outputs['frontend']=module.archive(R/'frontend.zip',R/'frontend.candidate.zip',changes)
 manifest={'part':60,'base':inv,'activation':False,'commercialAdminEnabled':False,'packages':outputs,'gatewayPrepared':False,'retentionAdapterComplete':False,'legacyCampaignVersioningComplete':False}
 (R/'preparation.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest))
if __name__=='__main__':main()
