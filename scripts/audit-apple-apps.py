#!/usr/bin/env python3
"""Read-only Apple release preflight. No account access, uploads or backend writes."""
import argparse
import json
import pathlib
import plistlib
import re
import subprocess


def audit(root, app):
    front = root / app['repository'] / 'frontend'
    info = plistlib.loads((front / 'ios/Runner/Info.plist').read_bytes())
    project = (front / 'ios/Runner.xcodeproj/project.pbxproj').read_text()
    findings = []
    def check(ok, code, detail):
        findings.append({'check': code, 'status': 'pass' if ok else 'pending', 'detail': detail})
    check(app['bundleId'] in project, 'bundle_id', app['bundleId'])
    check('F6B9QH9W82' in project, 'team', 'F6B9QH9W82')
    modes = info.get('UIBackgroundModes', [])
    valid_modes = {'audio', 'location', 'voip', 'fetch', 'remote-notification', 'processing', 'bluetooth-central', 'bluetooth-peripheral', 'external-accessory', 'nearby-interaction', 'push-to-talk'}
    check(all(m in valid_modes for m in modes), 'background_modes', modes)
    check(not info.get('NSAppTransportSecurity', {}).get('NSAllowsArbitraryLoads', False), 'transport_security', 'Release must not allow arbitrary cleartext loads; audit legacy image URLs and printers before tightening.')
    check(not info.get('NSBonjourServices'), 'release_debug_discovery', 'Debug Bonjour services should be isolated from public release; retain merchant printer discovery only if implemented.')
    privacy = front / 'ios/Runner/PrivacyInfo.xcprivacy'
    check(privacy.exists() and 'PrivacyInfo.xcprivacy in Resources' in project, 'app_privacy_manifest', 'App resource declaration; inspect SDK manifests in final signed archive separately.')
    export = plistlib.loads((front / 'ios/ExportOptions-AppStore.plist').read_bytes())
    check(export.get('method') == 'app-store-connect' and export.get('destination') == 'export', 'export_only', 'No upload action in export preset.')
    icons = front / 'ios/Runner/Assets.xcassets/AppIcon.appiconset'
    catalog = json.loads((icons / 'Contents.json').read_text())
    store_icons = [icons / x['filename'] for x in catalog['images'] if x.get('size') == '1024x1024' and x.get('filename')]
    icon_ok = bool(store_icons)
    for icon in store_icons:
        result = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'hasAlpha', str(icon)], capture_output=True, text=True)
        icon_ok &= result.returncode == 0 and 'pixelWidth: 1024' in result.stdout and 'pixelHeight: 1024' in result.stdout and 'hasAlpha: no' in result.stdout
    check(icon_ok, 'store_icon', '1024 × 1024 without alpha')
    obsolete = []
    for path in (front / 'lib').rglob('*.dart'):
        if re.search(r'support@(?:zad-app\.com|whizzecosystem\.com|whizz\.com|wizz\.com)', path.read_text()):
            obsolete.append(str(path.relative_to(front)))
    check(not obsolete, 'support_email', obsolete or 'support@wiz-go.com')
    for key in ['privacyPolicyUrl', 'supportUrl', 'legalOperator']:
        check(bool(app.get(key)), key, app.get(key))
    return {'role': app['role'], 'bundleId': app['bundleId'], 'displayName': info.get('CFBundleDisplayName'), 'checks': findings, 'status': 'pending' if any(x['status'] != 'pass' for x in findings) else 'static_checks_passed'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repos-root', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[2])
    parser.add_argument('--output', type=pathlib.Path)
    parser.add_argument('--strict', action='store_true', help='Return nonzero while any release requirement remains pending.')
    args = parser.parse_args()
    manifest = json.loads((pathlib.Path(__file__).resolve().parents[1] / 'docs/apple-shared-release-preparation-20261023.json').read_text())
    report = {'scope': 'static_preflight_only_not_submission_approval', 'apps': [audit(args.repos_root, a) for a in manifest['apps']]}
    encoded = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded)
    print(encoded)
    return 1 if args.strict and any(a['status'] == 'pending' for a in report['apps']) else 0


if __name__ == '__main__':
    raise SystemExit(main())
