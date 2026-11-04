"""Offline archive bridge. Never extracts a Lambda archive or executes its contents."""
import base64, copy, hashlib, json, pathlib, sys, zipfile

def prepare(request):
    if request['mode'] == 'new':
        destination = pathlib.Path(request['destination'])
        additions = request['additions']
        if destination.exists() or any(name.startswith('/') or '\\' in name or '..' in name.split('/') for name in additions):
            raise ValueError('DESTINATION_MUST_BE_NEW')
        with zipfile.ZipFile(destination, 'w') as result:
            for name, filename in sorted(additions.items()):
                entry = zipfile.ZipInfo(name, date_time=(2026, 10, 15, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                result.writestr(entry, pathlib.Path(filename).read_bytes())
        return {'codeSha256': base64.b64encode(hashlib.sha256(destination.read_bytes()).digest()).decode(), 'files': sorted(additions)}
    source = pathlib.Path(request['source'])
    raw = source.read_bytes()
    if base64.b64encode(hashlib.sha256(raw).digest()).decode() != request['expectedCodeSha256']:
        raise ValueError('LIVE_PACKAGE_DIGEST_CHANGED')
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)) or sum(entry.file_size for entry in entries) > 250 * 1024 * 1024:
            raise ValueError('UNSAFE_ARCHIVE')
        if any(name.startswith('/') or '\\' in name or '..' in name.split('/') for name in names):
            raise ValueError('UNSAFE_ARCHIVE_PATH')
        if request['mode'] == 'read':
            return {'base64': base64.b64encode(archive.read(request['name'])).decode()}
        replacements = request['replacements']
        additions = request['additions']
        if set(replacements) - set(names) or set(additions) & set(names) or set(replacements) & set(additions):
            raise ValueError('PACKAGE_FILE_SET_CHANGED')
        if any(name.startswith('/') or '\\' in name or '..' in name.split('/') for name in [*replacements, *additions]):
            raise ValueError('UNSAFE_ARCHIVE_PATH')
        destination = pathlib.Path(request['destination'])
        if destination.resolve() == source.resolve() or destination.exists():
            raise ValueError('DESTINATION_MUST_BE_NEW')
        with zipfile.ZipFile(destination, 'w') as result:
            for entry in entries:
                content = pathlib.Path(replacements[entry.filename]).read_bytes() if entry.filename in replacements else archive.read(entry.filename)
                result.writestr(copy.copy(entry), content)
            for name, filename in additions.items():
                entry = zipfile.ZipInfo(name, date_time=(2026, 10, 15, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                result.writestr(entry, pathlib.Path(filename).read_bytes())
        with zipfile.ZipFile(destination) as result:
            preserved = 0
            for name in names:
                if name not in replacements:
                    if archive.read(name) != result.read(name):
                        raise ValueError('UNMODIFIED_FILE_CHANGED')
                    preserved += 1
        return {'codeSha256': base64.b64encode(hashlib.sha256(destination.read_bytes()).digest()).decode(),
                'preservedFiles': preserved, 'replacedFiles': sorted(replacements), 'addedFiles': sorted(additions)}

if __name__ == '__main__':
    try:
        print(json.dumps(prepare(json.load(sys.stdin))))
    except Exception as error:
        # Do not print archive contents, presigned URLs or SDK errors.
        print(json.dumps({'error': str(error) if isinstance(error, ValueError) else 'PACKAGE_PREPARATION_FAILED'}))
        sys.exit(1)
