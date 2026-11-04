"""Narrow Creator overlay: use its existing condition-only lifecycle permission, retaining final transaction fences."""
import pathlib,zipfile,io,copy,json,hashlib,base64,subprocess
p=pathlib.Path('/private/tmp/checkout-policy-179');p.mkdir(exist_ok=True);original=pathlib.Path('/private/tmp/minimum-173/WizzUser-CreateOrder-staging/legacy-candidate.zip').read_bytes();(p/'original.zip').write_bytes(original);z=zipfile.ZipFile(io.BytesIO(original));name='functions/create-order/commercial-runtime.js';s=z.read(name).decode();a=s.index('var require_deliveryFundingReader =');b=s.index('// ../wizzuser-stg/backend/src/functions/create-order/quote-runtime/deliveryPromotion.js',a);part=s[a:b]
needle='      const { db } = options, now = options.now ?? Date.now;';assert part.count(needle)==1;part=part.replace(needle,needle+'\n      if(options.lifecycleReadMode!==void 0&&!["GET","CONDITION_CHECK"].includes(options.lifecycleReadMode))return fail();')
a1=part.index('          for (const pk of ["ACCOUNT_LIFECYCLE#MERCHANT#"');b1=part.index('          return { policy: resolved.policy',a1)
part=part[:a1]+'''          const lifecycleChecks=["ACCOUNT_LIFECYCLE#MERCHANT#"+branch.ownerId,"BUSINESS_LIFECYCLE#MERCHANT#"+branch.businessId].map(pk=>({ConditionCheck:{TableName:L,Key:{pk,sk:"META"},ConditionExpression:"attribute_not_exists(pk)"}}));
          if(options.lifecycleReadMode==="CONDITION_CHECK"){
            try{await db.send(new lib_dynamodb_1.TransactWriteCommand({TransactItems:lifecycleChecks}));}
            catch(checkError){if(checkError?.name==="TransactionCanceledException"&&checkError?.CancellationReasons?.some(r=>r.Code==="ConditionalCheckFailed"))return fail("DELIVERY_POLICY_AUTHORITY_REVOKED");return fail();}
          }else{
            for(const check of lifecycleChecks){const state=await db.send(new lib_dynamodb_1.GetCommand({TableName:L,Key:check.ConditionCheck.Key,ConsistentRead:true}));if(state.Item)return fail("DELIVERY_POLICY_AUTHORITY_REVOKED");}
          }
          fences.push(...lifecycleChecks);
'''+part[b1:];s=s[:a]+part+s[b:]
needle='const reader = (0, deliveryFundingReader_1.createStagingDeliveryFundingReader)({ db, now });';assert s.count(needle)==1;s=s.replace(needle,'const reader = (0, deliveryFundingReader_1.createStagingDeliveryFundingReader)({ db, now, lifecycleReadMode: options.lifecycleReadMode });')
needle='const deliveryPromotion = deliveryPromotionMode === "REQUIRED" ? createStagingDeliveryPromotionSelection({\n        db: dynamoDb,';assert s.count(needle)==1;s=s.replace(needle,needle+'\n        lifecycleReadMode: "CONDITION_CHECK",')
(p/'candidate.js').write_text(s);subprocess.run(['node','--check',str(p/'candidate.js')],check=True);out=io.BytesIO()
with zipfile.ZipFile(out,'w')as dest:
 for item in z.infolist():dest.writestr(copy.copy(item),s.encode()if item.filename==name else z.read(item.filename))
b=out.getvalue();(p/'candidate.zip').write_bytes(b);check=zipfile.ZipFile(io.BytesIO(b));assert all(z.read(n)==check.read(n)for n in z.namelist()if n!=name)
r={'function':'WizzUser-CreateOrder-staging','baseCodeSha256':base64.b64encode(hashlib.sha256(original).digest()).decode(),'codeSha256':base64.b64encode(hashlib.sha256(b).digest()).decode(),'changedEntries':[name],'otherEntriesIdentical':True,'newIamPermissions':False,'transactionContainsOnlyConditionChecks':True,'finalOrderLifecycleFencesRetained':True,'defaultReaderModePreservedForOtherCallers':True};pathlib.Path('docs/checkout-policy-candidate-179.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
