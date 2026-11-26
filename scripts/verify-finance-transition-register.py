"""Validate traceability and dependency coverage, without AWS calls or mutations."""
import argparse
import hashlib
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--revision-evidence', help='Explicit reviewed successor hashes; the historical register stays unchanged')
args = parser.parse_args()
revisions = {}
if args.revision_evidence:
    successor = json.loads((root / args.revision_evidence).read_text())
    assert successor['environment'] == 'Staging' and successor['part'] > 51
    revisions = {r['path']: r for r in successor['reviewedSourceRevisions']}
    assert len(revisions) == len(successor['reviewedSourceRevisions'])
doc = json.loads((root / 'docs/finance-transition-register-51.json').read_text())
parts = doc['parts']
assert set(revisions) <= {p['primarySource'] for p in parts}, 'Unknown successor source'
assert [p['part'] for p in parts] == list(range(1, 51)), 'Missing or duplicate implementation part'
assert len({p['section'] for p in parts}) == 50
plan = (root / 'docs/finance-pricing-settlements-returns-unified-plan.md').read_text()
phase_ids = {p['id'] for p in doc['phases']}
assert len(phase_ids) == len(doc['phases']), 'Duplicate phase'
visited = set()
for phase in doc['phases']:
    assert set(phase['dependsOn']) <= visited, 'Dependency cycle or out-of-order phase'
    assert set(phase['parts']) <= set(range(1, 51))
    assert phase['exitCriteria'], 'Phase requires explicit acceptance evidence'
    visited.add(phase['id'])
for part in parts:
    assert re.search(r'^## ' + str(part['section']) + r'\.', plan, re.M)
    source = root / part['primarySource']
    assert source.is_file(), str(source)
    expected_hash = part['sourceSha256']
    if part['primarySource'] in revisions:
        revision = revisions[part['primarySource']]
        assert revision['beforeSha256'] == expected_hash and revision['reason']
        expected_hash = revision['afterSha256']
    assert hashlib.sha256(source.read_bytes()).hexdigest() == expected_hash, \
        'Source changed; review the register instead of silently reusing old evidence: ' + str(source)
    assert set(part['transitionPhases']) <= phase_ids
    assert part['transitionPhases']
    assert part['adoptionStatus'] == 'REQUIRES_PHASE_EXIT_EVIDENCE'
    for evidence in part['releaseEvidence']:
        assert (root / evidence).is_file(), evidence
for key in ['liveEvidence', 'packageEvidence']:
    evidence = json.loads((root / doc[key]).read_text())
    assert evidence.get('activationPerformed') is False
assert doc['activationPerformed'] is False
live = json.loads((root / doc['liveEvidence']).read_text())
assert len({f['name'] for f in live['functions']}) == len(live['functions'])
assert live['readOnly'] is True and live['handlerInvocations'] == 0 and live['humanRowsRead'] is False
print(json.dumps({'parts': len(parts), 'phases': len(phase_ids), 'sourceHashesVerified': 50,
                  'reviewedSuccessorSources': len(revisions),
                  'dependencyOrderValid': True, 'activationPerformed': False}))
