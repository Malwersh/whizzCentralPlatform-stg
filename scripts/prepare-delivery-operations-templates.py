"""Patch fresh processed templates, preserving all unrelated deployed resources."""
import copy,json,sys
from pathlib import Path
base,out=map(Path,sys.argv[1:]);key='OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS'
plans=[]
for name in ['staging-cod-lifecycle','staging-delivery-quotes']:
 old=json.load(open(base/(name+'.template.json')));new=copy.deepcopy(old)
 roles=['Cod26WaveSystemStartWaveFunctionGuardPolicy','DriverFinancialAcceptanceFunctionRole'] if name.endswith('lifecycle') else ['DeliveryQuoteRole']
 def walk(x):
  if isinstance(x,dict):
   for k,v in x.items():
    if k=='dynamodb:LeadingKeys' and isinstance(v,list) and 'OPERATIONAL_SETTINGS#DELIVERY_PRICING' in v and key not in v:v.append(key)
    else:walk(v)
  elif isinstance(x,list):
   for v in x:walk(v)
 for rid in roles:walk(new['Resources'][rid])
 rid='DriverFinancialAcceptanceFunction' if name.endswith('lifecycle') else 'DeliveryQuotesFunction'
 env=new['Resources'][rid]['Properties']['Environment']['Variables'];env['DELIVERY_OPERATIONS_MODE']='CENTRAL'
 assert all(v=='OFF' for k,v in env.items() if k.startswith('FINANCIAL_') and k.endswith('_MODE'))
 if 'DELIVERY_QUOTES_ENABLED' in env:assert env['DELIVERY_QUOTES_ENABLED']=='false'
 changed=[k for k in old['Resources'] if old['Resources'][k]!=new['Resources'][k]];assert set(changed)==set(roles+[rid]);assert set(old['Resources'])==set(new['Resources'])
 for k in old:
  if k!='Resources':assert old[k]==new[k]
 (out/(name+'.template.json')).write_text(json.dumps(new,indent=2)+'\n');plans.append({'stack':name,'modifiedResources':changed,'codePointersPreserved':True,'activation':'OFF'})
(out/'infrastructure-plan.json').write_text(json.dumps(plans,indent=2)+'\n');print(json.dumps(plans))
