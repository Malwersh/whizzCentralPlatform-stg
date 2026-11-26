"""Prepare the support page and app bindings using a verified production portal bundle."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from tempfile import TemporaryDirectory

from build_admin_frontend import build
from deploy_admin_amplify_bundle import archive

ASSETS = ('pages/support.html', 'support.css', 'support.js', 'support-attachments.js', 'support-config.js')
LINK = '<a href="/pages/support.html">محادثات الدعم</a>'
ANCHOR = re.compile(r'<nav aria-label="أقسام الإدارة"><span class="nav-group-label">المتابعة</span><a href="/pages/dashboard[.]html"(?: aria-current="page")?>الرئيسية</a>')


def prepare(baseline, manifest_file, rules_file, endpoints_file, output):
    manifest = json.loads(manifest_file.read_text())
    if manifest.get('accountId') != '746727375268' or any(name in manifest['files'] for name in ASSETS):
        raise ValueError('Expected the production portal bundle before support chat')
    archive(baseline, manifest)
    endpoints = json.loads(endpoints_file.read_text())
    api = endpoints['ApiUrl']
    if not re.fullmatch(r'https://[a-z0-9]{10}[.]execute-api[.]us-east-1[.]amazonaws[.]com/production', api):
        raise ValueError('Expected the deployed production support REST API')
    rules = json.loads(rules_file.read_text())
    routes = {'/support-api/socket-ticket': 'socket-ticket', '/support-api/attachments': 'attachments'}
    if any(rule['source'] in routes for rule in rules):
        raise ValueError('Support rewrites are already present in this baseline')
    if output.exists():
        raise ValueError('Choose a new output directory')
    output.mkdir(parents=True)
    web = output/'web'
    result = {}
    with TemporaryDirectory(dir=output) as tmp:
        fresh = Path(tmp)
        build(fresh, baseline/'vendor', support_socket_url=endpoints['SocketUrl'])
        shell = re.search(rb'/platform-shell[.]js[?]v=[0-9a-f]{12}', (baseline/'pages/dashboard.html').read_bytes())
        support_page = (fresh/ASSETS[0]).read_bytes()
        if not shell or shell.group() not in support_page:
            raise ValueError('Support page must use the deployed production shell revision')

        def write(name, data):
            destination = web/name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            result[name] = hashlib.sha256(data).hexdigest()

        for name in manifest['files']:
            data = (baseline/name).read_bytes()
            if name.startswith('pages/') and name.endswith('.html') and b'platform-sidebar' in data:
                page = data.decode()
                matches = list(ANCHOR.finditer(page))
                if len(matches) != 1:
                    raise ValueError('Sidebar anchor differs from live baseline: ' + name)
                data = ANCHOR.sub(lambda match: match.group() + LINK, page, count=1).encode()
            write(name, data)
        for name in ASSETS:
            write(name, (fresh/name).read_bytes())

    manifest['files'] = result
    manifest['pageScope'] = [*manifest['pageScope'], 'support-chat']
    rewrite_rules = [{'source': source, 'target': api + '/support/' + segment, 'status': '200'}
                     for source, segment in routes.items()]
    bindings = {
        'SUPPORT_CHAT_WS_URL': endpoints['SocketUrl'],
        'SUPPORT_CHAT_WEBSOCKET_URL': endpoints['SocketUrl'],
        'SUPPORT_ATTACHMENTS_API_URL': api + '/support/attachments',
    }
    for filename, data in [('manifest.json', manifest), ('rules.json', rewrite_rules + rules),
                           ('flutter-defines.json', bindings)]:
        (output/filename).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    archive(web, manifest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('baseline', 'manifest', 'rules', 'endpoints', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    prepare(args.baseline, args.manifest, args.rules, args.endpoints, args.output)
