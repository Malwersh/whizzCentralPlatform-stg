"""Build the canonical wallet authorizer with Linux wheels, never host binaries."""
import hashlib
import io
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent

def bundle(wheels):
    files = {}
    wheels = Path(wheels)
    required = {'PyJWT', 'cryptography', 'boto3'}
    found = set()
    for wheel in sorted(wheels.glob('*.whl')):
        found.add(wheel.name.split('-')[0])
        if not ('manylinux' in wheel.name or wheel.name.endswith('none-any.whl')):
            raise ValueError('Dependency is not a Linux or portable wheel')
        with zipfile.ZipFile(wheel) as z:
            for name in z.namelist():
                if name.endswith('/'):
                    continue
                if name.startswith('/') or '..' in Path(name).parts:
                    raise ValueError('Unsafe wheel path')
                if name in files:
                    raise ValueError('Duplicate dependency path')
                files[name] = z.read(name)
    if not required <= found:
        raise ValueError('Missing authorizer dependencies')
    source = ROOT.parent.parent / 'backend/wallet-service/src'
    for name in ('authorizer.py', 'staff_policy.py', 'staff-roles.json'):
        files[name] = (source / name).read_bytes()
    for name in ('wallet_authorizer_entry.py', 'wallet_token_policy.py'):
        files[name] = (ROOT / name).read_bytes()
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    data = out.getvalue()
    return data, hashlib.sha256(data).hexdigest()

if __name__ == '__main__':
    import sys
    data, digest = bundle(sys.argv[1])
    Path('/private/tmp/wizz-production-wallet-authorizer.zip').write_bytes(data)
    print(digest)
