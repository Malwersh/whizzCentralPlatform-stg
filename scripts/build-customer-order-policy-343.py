"""Build additive create-order code update from a captured published zip. No AWS writes."""
import argparse,base64,hashlib,json,pathlib,subprocess,zipfile,copy
root=pathlib.Path(__file__).resolve().parents[1]
user=root.parent/'wizzuser-stg'
p=argparse.ArgumentParser();p.add_argument('base_zip');p.add_argument('output_zip');p.add_argument('manifest');args=p.parse_args()
old=subprocess.check_output(['git','show','51725a4:backend/src/functions/create-order/index.js'],cwd=user)
index=(user/'backend/src/functions/create-order/index.js').read_bytes()
patches={
 'functions/create-order/index.js':index,
 'functions/shared/customer-order-policy-343.js':(root/'backend/shared/customer-order-policy-343.js').read_bytes(),
 'functions/shared/customer-order-policy-343.json':(root/'backend/shared/customer-order-policy-343.json').read_bytes(),
}
with zipfile.ZipFile(args.base_zip) as src:
 assert src.read('functions/create-order/index.js')==old,'Base index differs from audited deployed source; review concurrent changes before packaging'
 assert len(src.namelist())==len(set(src.namelist())),'Duplicate archive entries'
 with zipfile.ZipFile(args.output_zip,'w',compression=zipfile.ZIP_DEFLATED) as out:
  for item in src.infolist():out.writestr(copy.copy(item),patches.get(item.filename,src.read(item.filename)))
  for n,data in patches.items():
   if n not in src.namelist():out.writestr(n,data)
 with zipfile.ZipFile(args.output_zip) as out:
  for n in src.namelist():
   if n not in patches:assert out.read(n)==src.read(n),'Unrelated entry changed: '+n
  assert set(out.namelist())==set(src.namelist())|set(patches)
manifest={'part':343,'function':'WizzUser-CreateOrder-staging','baseCodeSha256':base64.b64encode(hashlib.sha256(pathlib.Path(args.base_zip).read_bytes()).digest()).decode(),'candidateCodeSha256':base64.b64encode(hashlib.sha256(pathlib.Path(args.output_zip).read_bytes()).digest()).decode(),'changedEntries':list(patches),'otherEntriesIdentical':True,'iamChanges':False,'configurationChanges':False,'businessWritesByBuilder':0,'status':'BUILT_NOT_PUBLISHED'}
pathlib.Path(args.manifest).write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
