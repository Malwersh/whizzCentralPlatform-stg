"""Synchronize shared validation contract, never customer policy content on devices."""
import pathlib,sys
root=pathlib.Path(__file__).resolve().parents[1]
for name in ['customer-legal-contract-344.js','customer-legal-defaults-344.json','driver-legal-defaults-344.json','merchant-legal-defaults-344.json']:
 source=(root/'backend/shared'/name).read_bytes();target=root.parent/'wizzuser-stg/backend/phone-auth'/name
 if '--check' in sys.argv:assert target.read_bytes()==source,str(target)
 else:target.write_bytes(source)
print('Customer legal shared contracts match' if '--check' in sys.argv else 'Synced customer legal contract')
