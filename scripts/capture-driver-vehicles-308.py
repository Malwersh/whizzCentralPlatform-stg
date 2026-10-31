from pathlib import Path
import subprocess,json,urllib.request,concurrent.futures
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/driver-vehicles-308';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
names=['DriversApi-staging','WaveSystem_CreateDispatchJob','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','WaveSystem_HandleDriverAccept','WaveSystem_HandleDriverReject','staging-driver-financial-accept','staging-wizz-staff-service','staging-cod-integration']
def capture(name):
 p=P/name;p.mkdir(exist_ok=True);r=json.loads(subprocess.check_output(B+['lambda','get-function','--function-name',name,'--output','json']));(p/'config.private.json').write_text(json.dumps(r['Configuration']));urllib.request.urlretrieve(r['Code']['Location'],p/'base.zip');return {'name':name,'beforeHash':r['Configuration']['CodeSha256'],'revision':r['Configuration']['RevisionId']}
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
 rows=list(pool.map(capture,names))
(P/'captured.json').write_text(json.dumps(rows,indent=2));print('Captured',len(rows),'live packages without changes')
