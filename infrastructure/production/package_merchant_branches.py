"""Produce a self-contained branch artifact; does not deploy or enable registration."""
import hashlib, io, json, os, subprocess, tempfile, zipfile
from pathlib import Path
ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]

def package():
    modules = REPO / 'backend/wallet-service/node_modules'
    with tempfile.TemporaryDirectory(prefix='wizz-merchant-branches-') as tmp:
        output = Path(tmp) / 'index.cjs'
        subprocess.run([str(modules / '.bin/esbuild'), str(ROOT / 'merchant-branches/index.cjs'),
            '--bundle', '--platform=node', '--target=node22', '--format=cjs',
            '--outfile=' + str(output), '--log-level=error'],
            env={**os.environ, 'NODE_PATH': str(modules)}, check=True)
        raw = output.read_bytes()
        subprocess.run(['node', '-e',
            "require(process.argv[1]).handler({}).then(r=>{if(r.statusCode!==503)process.exit(1)})",
            str(output)], check=True)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
            info = zipfile.ZipInfo('index.cjs', date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, raw)
        return archive.getvalue()

if __name__ == '__main__':
    raw = package()
    digest = hashlib.sha256(raw).hexdigest()
    target = Path('/private/tmp') / ('wizz-production-merchant-branches-' + digest + '.zip')
    target.write_bytes(raw)
    print(json.dumps({'artifact': str(target), 'sha256': digest, 'bytes': len(raw),
                      'status': 'PACKAGED_DISABLED_NOT_DEPLOYED'}))
