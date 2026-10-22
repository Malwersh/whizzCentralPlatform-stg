#!/usr/bin/env python3
"""Offline candidate IAM grant review, not an AWS authorization simulation."""
import argparse, fnmatch, json
from pathlib import Path

ARN='arn:aws:dynamodb:us-east-1:699561669180:table/'
HISTORY=['orderId','createdAt','discountId','promoCode','userSub','userId','offerSnapshot','offerUsageRelease']
def listed(value): return value if isinstance(value,list) else [value]
def matches(statement,action,resource):
    return any(fnmatch.fnmatchcase(action.lower(),v.lower()) for v in listed(statement.get('Action',[]))) and any(fnmatch.fnmatchcase(resource,v) for v in listed(statement.get('Resource',[])))
def requirements(name):
    result=[]
    if any(v in name for v in ['GetStoreDiscounts','GetActivePromoCodes','ApplyPromoCode','ValidatePromoCode']):
        result += [('dynamodb:GetItem',t) for t in ['WizzUser_users_staging','WizzUser_addresses_staging','WizzCentral_Regions','staging-WizzOfferJourney']]
        result += [('dynamodb:Scan','WizzOrders')]
    if any(v in name for v in ['ApplyPromoCode','ValidatePromoCode','discount-management']):
        result += [('dynamodb:GetItem',t) for t in ['WhizzMerchants_Products','WhizzMerchants_Categories']]
    if 'CreateOrder' in name:
        result += [('dynamodb:GetItem',t) for t in ['WhizzMerchants_Products','WhizzMerchants_Categories','staging-WizzOfferJourney']]
        result += [('dynamodb:ConditionCheckItem',t) for t in ['WhizzMerchants_Products','WhizzMerchants_Categories']]
        result += [('dynamodb:PutItem','staging-WizzOfferJourney')]
    if 'merchant-response' in name:
        result += [(action,t) for action in ['dynamodb:GetItem','dynamodb:PutItem','dynamodb:ConditionCheckItem'] for t in ['staging-WizzOfferJourney','WhizzMerchants_Discounts','WizzCentral_Platform_Discounts']]
    if 'CancelOrder' in name:
        for action,tables in [
            ('dynamodb:GetItem',['WizzOrders','WizzUser_users_staging','WhizzMerchants_Businesses','staging-WizzOfferJourney','WhizzMerchants_Discounts','WizzCentral_Platform_Discounts','staging-Wallets','staging-Holds']),
            ('dynamodb:ConditionCheckItem',['WizzOrders','WizzUser_users_staging','WhizzMerchants_Businesses','staging-WizzOfferJourney','WhizzMerchants_Discounts','WizzCentral_Platform_Discounts','staging-Wallets']),
            ('dynamodb:PutItem',['staging-WizzOfferJourney','WhizzMerchants_Discounts','WizzCentral_Platform_Discounts','staging-LedgerEntries']),
            ('dynamodb:UpdateItem',['WizzOrders','staging-Wallets']),
        ]:
            result += [(action,t) for t in tables]
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--backup',required=True,type=Path);p.add_argument('--out',required=True,type=Path);a=p.parse_args()
    if a.out.exists():p.error('Output exists; use a fresh path')
    manifest=json.loads((a.backup/'manifest.json').read_text())
    if not manifest.get('complete'):p.error('Backup is incomplete')
    rows=[]
    for entry in manifest['backups']:
        docs=json.loads(Path(entry['iamPolicies']).read_text())
        statements=[]
        for policy in docs['inline']:statements+=listed(policy['PolicyDocument']['Statement'])
        for policy in docs['managed']:statements+=listed(policy['version']['PolicyVersion']['Document']['Statement'])
        for action,table in requirements(entry['function']):
            allow=[s for s in statements if s.get('Effect')=='Allow' and matches(s,action,ARN+table)]
            deny=[s for s in statements if s.get('Effect')=='Deny' and matches(s,action,ARN+table)]
            history_review=[]
            if table=='WizzOrders':
                for s in allow:
                    fields=s.get('Condition',{}).get('ForAllValues:StringEquals',{}).get('dynamodb:Attributes')
                    if fields is not None:history_review.append({'missingHistoryFields':[f for f in HISTORY if f not in fields]})
            rows.append({'function':entry['function'],'action':action,'table':table,
                'matchingAllows':len(allow),'matchingDenies':len(deny),
                'conditionalAllows':sum(bool(s.get('Condition')) for s in allow),'historyProjectionReview':history_review})
    report={'readOnly':True,'method':'Offline statement matching; conditions, boundaries and SCPs still require review',
        'checks':rows,'noMatchingAllow':[r for r in rows if not r['matchingAllows']],
        'historyFieldGaps':[r for r in rows if any(v['missingHistoryFields'] for v in r['historyProjectionReview'])]}
    with a.out.open('x') as output:json.dump(report,output,indent=2);output.write('\n')
    print(json.dumps({'report':str(a.out),'checks':len(rows),'noMatchingAllow':len(report['noMatchingAllow']),'historyFieldGaps':len(report['historyFieldGaps'])}))
if __name__=='__main__':main()
