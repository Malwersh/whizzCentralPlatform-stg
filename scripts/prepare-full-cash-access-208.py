"""Prepare least-privilege access candidates; never writes AWS state."""
import pathlib,json,hashlib
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/full-cash-208/live');out=p.parent/'access';out.mkdir(exist_ok=True,mode=0o700)
arn=lambda table:'arn:aws:dynamodb:us-east-1:699561669180:table/'+table
fields=json.loads((root/'backend/staff-service/settlement-evidence-fields.json').read_text())
staff=json.loads((p/'staging-wizz-staff-service.role.private.json').read_text());completed=json.loads(json.dumps(staff['policies']['CompletedOrderStatements204']))
for s in completed['Statement']:
 table=s['Resource'].split('/')[-1]
 if table in fields:s['Condition']['ForAllValues:StringEquals']['dynamodb:Attributes']=fields[table]
identity=json.loads(json.dumps(staff['policies']['FinanceRolloutIdentity54']))

updated={**staff['policies'],'CompletedOrderStatements204':completed,'FinanceRolloutIdentity54':identity}
inline_size=sum(len(json.dumps(v,separators=(',',':'))) for v in updated.values())
assert inline_size<=10240,inline_size
condition=lambda keys,attrs:{'Null':{'dynamodb:LeadingKeys':'false','dynamodb:Attributes':'false'},'ForAllValues:StringLike':{'dynamodb:LeadingKeys':keys},'ForAllValues:StringEquals':{'dynamodb:Attributes':attrs}}
managed={'Version':'2012-10-17','Statement':[
 {'Effect':'Allow','Action':'dynamodb:UpdateItem','Resource':arn('staging-Holds'),'Condition':condition(['????????-????-????-????-????????????'],fields['staging-Holds'])},
 {'Effect':'Allow','Action':'dynamodb:PutItem','Resource':arn('staging-AuditLog'),'Condition':condition(['date#*'],['datePartition','sk','action','actorId','branchId','batchId','batchDigest','requestId','createdAt','lineCount','walletChanged','payoutAuthorized'])}
]}
accept=json.loads((p/'staging-driver-financial-accept.role.private.json').read_text())
accept_policy={'Version':'2012-10-17','Statement':[
 {'Effect':'Allow','Action':['dynamodb:PutItem'],'Resource':arn('staging-MerchantPlatform'),'Condition':{'Null':{'dynamodb:LeadingKeys':'false'},'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['FULL_CASH_JOURNAL#*']}}},
 {'Effect':'Allow','Action':'dynamodb:PutItem','Resource':arn('staging-Wallets'),'Condition':condition(['WALLET#MERCHANT#*'],['walletId','sk','ownerId','ownerType','currency','status','availableBalance','lockedBalance','version','createdAt','updatedAt'])}
]}
result={'status':'PREPARED_NOT_APPLIED','account':'699561669180','region':'us-east-1','staffRole':staff['role'],'staffInlineBytesAfter':inline_size,'staffInlineUpdates':{'CompletedOrderStatements204':completed,'FinanceRolloutIdentity54':identity},'staffManagedPolicy':{'name':'staging-merchant-statement-membership-208','document':managed},'acceptanceRole':accept['role'],'acceptanceInlinePolicy':{'name':'FullCashJournal208','document':accept_policy},'noWalletPermissionsForStaff':True,'noNewFullOrderRead':True,'noFinancialWritesPerformed':True}
(out/'candidates.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'status':result['status'],'staffInlineBytesAfter':inline_size,'staffWriteTables':['staging-Holds:allowlisted-payable-attributes; code-sets-membership-only','staging-AuditLog:statement-audit'],'acceptanceWritePartitions':['FULL_CASH_JOURNAL#*','WALLET#MERCHANT#*']}))
