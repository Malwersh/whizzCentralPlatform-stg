import pathlib,importlib.util,json,urllib.request,base64,hashlib,io,zipfile,copy,subprocess
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/otpiq-telegram-116');O.mkdir(mode=0o700,exist_ok=True)
sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);lam=m.session().client('lambda')
hosts=[('WizzUser-phone-auth-staging','index.js',None),('WizzUser-phone-link-staging','index.js',None),('WhizzDrivers-phone-otp-staging','triggers.js',None),('WhizzDrivers-phone-registration-staging','registration.js',None),('WhizzMerchants-otp-create-staging','create_auth_challenge.js','OTPIQ_PROVIDER'),('order-receiver-regional-staging-unified-auth-v4-sam','profile_otp_provider.js','PROFILE_OTP_PROVIDER')]
rows=[]
for name,suffix,envkey in hosts:
 f=lam.get_function(FunctionName=name);c=f['Configuration'];b=urllib.request.urlopen(f['Code']['Location'],timeout=40).read();assert base64.b64encode(hashlib.sha256(b).digest()).decode()==c['CodeSha256'];old=zipfile.ZipFile(io.BytesIO(b));matches=[n for n in old.namelist() if (n==suffix or n.endswith('/'+suffix)) and not n.startswith('node_modules/')];assert len(matches)==1,(name,matches);entry=matches[0];source=old.read(entry).decode();old_route='whatsapp-sms'
 if name=='WhizzMerchants-otp-create-staging' and old_route not in source:
  assert source.count("process.env.OTPIQ_PROVIDER || 'sms'")==1
  fixed=source.replace("process.env.OTPIQ_PROVIDER || 'sms'","process.env.OTPIQ_PROVIDER || 'whatsapp-telegram-sms'")
 else:
  assert old_route in source,(name,'old route missing');fixed=source.replace(old_route,'whatsapp-telegram-sms');assert fixed.replace('whatsapp-telegram-sms',old_route)==source
 p=O/(name+'.syntax.js');p.write_text(fixed);subprocess.run(['node','--check',str(p)],check=True,capture_output=True)
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w') as z:
  for info in old.infolist():z.writestr(copy.copy(info),fixed.encode() if info.filename==entry else old.read(info.filename))
 candidate=out.getvalue();new=zipfile.ZipFile(io.BytesIO(candidate));assert [n for n in old.namelist() if old.read(n)!=new.read(n)]==[entry]
 if envkey:assert c['Environment']['Variables'].get(envkey) in [None,'whatsapp-sms'], 'UNKNOWN_CUSTOM_ROUTE'
 for fn,data in [(name+'.before.zip',b),(name+'.candidate.zip',candidate),(name+'.private.json',json.dumps(c,default=str).encode())]:
  p=O/fn;p.write_bytes(data);p.chmod(0o600)
 rows.append({'name':name,'entry':entry,'baseCodeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'candidateSha256':base64.b64encode(hashlib.sha256(candidate).digest()).decode(),'envKey':envkey})
(O/'preparation.json').write_text(json.dumps(rows,indent=2));print(json.dumps({'preparedHosts':len(rows),'changedEntryPerHost':1,'unrelatedEntriesPreserved':True,'messagesSent':0}))
