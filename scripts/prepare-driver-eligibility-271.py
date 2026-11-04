import pathlib,zipfile,subprocess
P=pathlib.Path('/private/tmp/eligibility-271')
for name,target in [('staging-driver-financial-accept','index.js'),('WaveSystem_StartWave','dispatch-cycle-runtime.js'),('WaveSystem_HandleWaveTimeout','dispatch-cycle-runtime.js')]:
 z=zipfile.ZipFile(P/(name+'.zip'));s=z.read(target).decode();a='driver: ["driverId", "cognitoSub", "status"';b='if (driver.driverId !== driverId ||';assert s.count(a)==s.count(b)==1
 s=s.replace(a,'driver: ["isActive", "driverId", "cognitoSub", "status"',1).replace(b,'if (driver.isActive !== void 0 && driver.isActive !== true || driver.driverId !== driverId ||',1)
 c='if (!state || !driver || !isDriverApproved(driver)';n=s.count(c);assert n==(0 if name=='staging-driver-financial-accept'else 1)
 s=s.replace(c,'if (!state || !driver || driver.isActive !== void 0 && driver.isActive !== true || !isDriverApproved(driver)',n)
 candidate=P/(name+'.candidate.js');candidate.write_text(s);subprocess.run(['node','--check',str(candidate)],check=True)
 runtime=P/name;runtime.mkdir(exist_ok=True);z.extractall(runtime)
 (runtime/'eligibility-test.js').write_text(s+'\nmodule.exports.__eligibilityContext=createStagingDriverOfferContext;\n')
 print(name,'prepared',flush=True)
