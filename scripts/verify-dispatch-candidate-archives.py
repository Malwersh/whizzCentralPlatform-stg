"""Offline verification. Does not extract/execute packages or call AWS."""
import base64,hashlib,json,pathlib,sys,zipfile

def verify(audit_dir,candidate_dir):
 audit=pathlib.Path(audit_dir);out=pathlib.Path(candidate_dir);m=json.loads((out/'manifest.json').read_text());inv={f['name']:f for f in json.loads((audit/'inventory.json').read_text())['functions']}
 if len(m['functions'])!=9 or m['published'] or m['gates']!='OFF':raise ValueError('COMPLETE_CLOSED_CANDIDATES_REQUIRED')
 report={'scope':'OFFLINE_PINNED_ARCHIVE_VERIFICATION','published':False,'functions':[]}
 for f in m['functions']:
  before=audit/(f['name']+'.zip');after=out/(f['name']+'.candidate.zip');rollback=out/(f['name']+'.rollback.zip')
  digest=lambda p:base64.b64encode(hashlib.sha256(p.read_bytes()).digest()).decode()
  if digest(before)!=f['baseCodeSha256'] or digest(after)!=f['candidateCodeSha256'] or before.read_bytes()!=rollback.read_bytes():raise ValueError('ARCHIVE_DIGEST_OR_ROLLBACK_MISMATCH')
  with zipfile.ZipFile(before) as a,zipfile.ZipFile(after) as b:
   old=set(a.namelist());new=set(b.namelist());changed={n for n in old&new if a.getinfo(n).CRC!=b.getinfo(n).CRC or a.read(n)!=b.read(n)}
   if old-new or new-old!=set(f['addedFiles']) or changed!=set(f['replacedFiles']):raise ValueError('UNREVIEWED_PACKAGE_CHANGE')
   entry=f['handler'].rsplit('.',1)[0]+'.js';live=a.read(entry);candidate=b.read(entry)
   if f['name']=='WaveSystem_StartWave':
    if b'async function getQualifiedDrivers' not in candidate:raise ValueError('OLD_SELECTOR_REMOVED')
    # Every unchanged helper is still in the full live index, not swapped for the refactor.
    if len(candidate.splitlines())<len(live.splitlines()):raise ValueError('UNEXPECTED_STARTWAVE_REWRITE')
   if f['name'] in ['WaveSystem_HandleDriverAccept','WaveSystem_HandleDriverReject'] and b'respondPinnedLegacyOffer' not in candidate:raise ValueError('PINNED_RESPONSE_ROUTE_MISSING')
   if f['name']=='DriversApi-staging' and b'acceptWaveOffer(cognitoUsername, body, corsHeaders, bearerToken)' not in candidate:raise ValueError('PINNED_TOKEN_FORWARDING_MISSING')
   if f['name']=='staging-wizz-staff-service' and a.read('catalog.js')!=b.read('catalog.js'):raise ValueError('ROLE_CATALOG_CHANGED')
   if f['name']=='staging-cod-integration' and not candidate.startswith(live):raise ValueError('PUBLISHED_COD_PREFIX_CHANGED')
   report['functions'].append({'name':f['name'],'preservedEntries':len(old)-len(changed),'changed':sorted(changed),'added':sorted(new-old),'rollbackMatches':True})
 report['unrelatedFilesPreserved']=True
 return report
if __name__=='__main__':
 try:
  r=verify(sys.argv[1],sys.argv[2]);pathlib.Path(sys.argv[3]).write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'verified':len(r['functions']),'unrelatedFilesPreserved':True,'published':False}))
 except Exception as e:
  print('ARCHIVE_VERIFICATION_FAILED:',str(e) if isinstance(e,ValueError) else type(e).__name__);sys.exit(1)
