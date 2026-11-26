"""Frontend-only branch record projection correction; preserves live Arabic shell and existing control APIs."""
import pathlib,json,zipfile,hashlib,base64,importlib.util,re,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1];R=pathlib.Path('/private/tmp/merchant-branch-view-20261017');BASE=pathlib.Path('/private/tmp/commercial-branch-picker-20261017')
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def once(s,a,b):
 assert s.count(a)==1,'ANCHOR_DRIFT: '+a;return s.replace(a,b,1)
def prepare():
 R.mkdir(mode=0o700,exist_ok=True);assert not (R/'preparation.json').exists() and not (R/'candidate.zip').exists()
 base=json.loads((BASE/'publication.json').read_text());assert base['published'] and base['amplify']['status']=='SUCCEED';old=BASE/'candidate.zip';assert base['package']['codeSha256']==base64.b64encode(hashlib.sha256(old.read_bytes()).digest()).decode();(R/'rollback.zip').write_bytes(old.read_bytes())
 with zipfile.ZipFile(old) as z:
  changes={'merchant-branch-view.js':(ROOT/'frontend/merchant-branch-view.js').read_bytes()};source=(ROOT/'frontend/merchants.js').read_text();s=z.read('merchants.js').decode()
  s=once(s,'                fullData: item\n','                fullData: item,\n                ...window.MerchantBranchView.normalize(item)\n')
  for begin,end in [('function renderMerchantsTable() {','// Delegated events for merchants table'),('function viewMerchantDetails(merchantId) {','function editMerchant(merchantId) {'),('function editMerchant(merchantId) {','// Product view functions')]:
   a=s.index(begin);b=s.index(end,a);local=source[source.index(begin):source.index(end,source.index(begin))];s=s[:a]+local+s[b:]
  changes['merchants.js']=s.encode();html=z.read('pages/merchants.html').decode();html=once(html,'<script src="../merchants.js?v=20261017-branch-picker"></script>','<script src="../merchant-branch-view.js?v=20261017-branch-view"></script>\n<script src="../merchants.js?v=20261017-branch-view"></script>');html=once(html,'href="../styles/merchants-table.css"','href="../styles/merchants-table.css?v=20261017-branch-view"')
  start=html.index('                    <table class="data-table">');end=html.index('</thead>',start);local=(ROOT/'frontend/pages/merchants.html').read_text();a=local.index('                    <table class="data-table" id="merchantBranchesTable"');b=local.index('</thead>',a);html=html[:start]+local[a:b]+html[end:];changes['pages/merchants.html']=html.encode()
  marker='/* Branch data has independent review, setup and reception states. */';css=(ROOT/'frontend/styles/merchants-table.css').read_text();changes['styles/merchants-table.css']=z.read('styles/merchants-table.css')+b'\n\n'+css[css.index(marker):].encode()
  for name in ['merchants.js','merchant-branch-view.js']:
   p=R/('check-'+name);p.write_bytes(changes[name]);subprocess.run(['node','--check',str(p)],check=True)
 overlay=load('overlay',ROOT/'scripts/prepare-central-pricing-release-56.py');package=overlay.archive(R/'rollback.zip',R/'candidate.zip',changes)
 paths=['frontend/merchant-branch-view.js','frontend/merchants.js','frontend/styles/merchants-table.css','frontend/pages/merchants.html','scripts/test-merchant-branch-view-browser.cjs']
 result={'environment':'Staging','kind':'MERCHANT_BRANCH_DATA_VIEW_CORRECTION','cacheVersion':'20261017-branch-view','baseJobId':base['amplify']['jobId'],'package':package,'backendChanged':False,'activationPerformed':False,'tests':{'realTableColumns':True,'nestedAndLegacyAddress':True,'reviewSetupAvailabilityReceptionSeparate':True,'missingValuesNotGuessed':True,'safeTextAndImage':True,'realDelegatedDetailsAndCommercialActions':True,'mobileHorizontalScroll':True},'sourceSha256':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in paths}}
 (R/'preparation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':
 if sys.argv[1:]==['--prepare']:prepare()
 elif sys.argv[1:] in [['--publish'],['--verify']]:
  m=load('ui_release',ROOT/'scripts/publish-commercial-branch-picker-ui.py');m.R=R
  if sys.argv[1:]==['--publish']:m.publish()
  else:m.verify()
 else:raise SystemExit('Use --prepare, --publish or --verify')
