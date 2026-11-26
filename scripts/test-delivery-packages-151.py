"""Load exact candidate Lambda handlers in isolated subprocesses, never invoke them."""
import hashlib, base64, json, os, pathlib, subprocess, sys, tempfile, zipfile

root = pathlib.Path(__file__).resolve().parents[1]
folder = pathlib.Path(sys.argv[1])
manifest = json.loads((folder / 'package-manifest.json').read_text())
node_paths = [root / 'backend/node_modules', root / 'backend/staff-service/node_modules', root.parent / 'wizzuser-stg/backend/node_modules']
results = []
loader = r'''
const Module=require('module');
for(const name of ['http','https','net','tls']){
 const m=require(name);for(const key of ['request','get','connect','createConnection'])if(typeof m[key]==='function')m[key]=()=>{throw Error('NETWORK_FORBIDDEN_IN_PACKAGE_LOAD')};
}
const path=require('path'),parts=process.argv[2].split('.'),exportName=parts.pop();
const file=path.resolve(process.argv[1],parts.join('.')+'.js');
const exported=require(file);if(typeof exported[exportName]!=='function')throw Error('HANDLER_EXPORT_MISSING');
console.log(JSON.stringify({handlerLoaded:true}));
'''
with tempfile.TemporaryDirectory(prefix='delivery-package-load-151-') as temp:
    for item in manifest['functions']:
        archive = folder / item['candidate']
        assert base64.b64encode(hashlib.sha256(archive.read_bytes()).digest()).decode() == item['codeSha256']
        target = pathlib.Path(temp) / item['name']
        target.mkdir()
        with zipfile.ZipFile(archive) as package:
            for entry in package.infolist():
                resolved = (target / entry.filename).resolve()
                assert resolved.is_relative_to(target.resolve()) and not (entry.external_attr >> 16) & 0o170000 == 0o120000
            package.extractall(target)
        env = {**os.environ, 'NODE_PATH': ':'.join(map(str, node_paths)), 'AWS_EC2_METADATA_DISABLED': 'true', 'AWS_REGION': 'us-east-1', 'STAGE': 'staging', 'USER_POOL_ID': 'us-east-1_LocalLoadOnly', 'CLIENT_ID': 'local-load-only', 'STAFF_TABLE': 'local-load-only', 'DRIVER_TABLE': 'local-load-only', 'ORDERS_TABLE': 'local-load-only', 'WEBSOCKET_CONNECTIONS_TABLE': 'local-load-only', 'REGIONS_TABLE': 'local-load-only', 'REGION_INDEX_TABLE': 'local-load-only', 'REGION_NEIGHBORS_TABLE': 'local-load-only', 'ORDER_SERVICE_URL': 'https://example.invalid/local-load-only', 'WEBSOCKET_MANAGEMENT_ENDPOINT': 'https://example.invalid/local-load-only', **{key: 'local-load-only' for key in ['DISPATCH_JOBS_TABLE','DRIVER_LIVE_STATE_TABLE','WAVE_OFFERS_TABLE','DRIVERS_TABLE']}}
        p = subprocess.run(['node', '-e', loader, str(target), item['handler']], env=env, capture_output=True, text=True, timeout=30)
        if p.returncode:
            print(item['name'] + ': ' + p.stderr[-2000:])
            raise RuntimeError('CANDIDATE_HANDLER_LOAD_FAILED')
        results.append({'name': item['name'], 'handlerLoaded': True, 'networkBlocked': True, 'invoked': False})
report = {'part': 151, 'applied': False, 'handlers': results}
(folder / 'handler-load-validation-151.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'handlersLoaded': len(results), 'networkBlocked': True, 'invoked': False}))
