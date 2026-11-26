"""Build the hosted kitchen web ZIP from deployed CloudFormation outputs."""
import argparse
import json
import re
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

from prepare_kitchen_display import MERCHANT


def package(outputs, target):
    pairs = {row['OutputKey']: row['OutputValue'] for row in outputs}
    api = r'https://[a-z0-9]{10}[.]execute-api[.]us-east-1[.]amazonaws[.]com/production/kitchen-display/'
    bindings = {'api': ('HttpEndpoint', api + 'pairing'), 'actions': ('ActionEndpoint', api + 'advance'),
                'websocket': ('WebsocketEndpoint', r'wss://[a-z0-9]{10}[.]execute-api[.]us-east-1[.]amazonaws[.]com/production')}
    config = {}
    for name, (key, pattern) in bindings.items():
        value = pairs[key]
        if not re.fullmatch(pattern, value):
            raise ValueError('Unexpected production kitchen output: ' + key)
        config[name] = value
    with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
        for name in ('index.html', 'kitchen.js', 'kitchen.css'):
            archive.writestr(name, (MERCHANT / 'kitchen-web' / name).read_bytes())
        archive.writestr('config.js', 'window.KITCHEN_CONFIG=' + json.dumps(config) + ';\n')
        origins = [config['api'].split('/production/')[0], config['websocket'].removesuffix('/production')]
        headers = {
            'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src "
                + ' '.join(origins) + "; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
            'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer', 'Strict-Transport-Security': 'max-age=31536000',
        }
        archive.writestr('customHttp.yml', json.dumps({'customHeaders': [
            {'pattern': '**', 'headers': [{'key': key, 'value': value} for key, value in headers.items()]}
        ]}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('outputs', type=Path)
    parser.add_argument('zip', type=Path)
    args = parser.parse_args()
    package(json.loads(args.outputs.read_text()), args.zip)
