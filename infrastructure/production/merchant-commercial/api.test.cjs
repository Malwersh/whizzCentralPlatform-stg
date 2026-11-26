'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { createApi, tables, ownerPath, staffPath } = require('./api.cjs');
const { identities } = require('../wallet-identity-bindings.json');
const { hash } = require('../../../backend/staff-service/commercial-management');
const branchId = 'business-finance';
const agreementId = 'commercial-contract';
const instant = '2026-11-24T11:00:00.000Z';
const date = () => Date.parse(instant);
const { platform, staff, businesses } = tables;
const noticeOutbox = 'wizz-production-WalletNotifications';
const discounts = 'wizz-production-MerchantDiscounts';
const platformDiscounts = 'wizz-production-PlatformDiscounts';
const noCharge = { kind: 'NONE', basis: null, fixed: null, rate: null, rounding: 'EXACT',
  finalRounding: { incrementIqd: 1, mode: 'HALF_AWAY_FROM_ZERO' } };
const terms = { scope: 'BRANCH', effectiveFrom: '2026-11-24T10:00:00.000Z', effectiveTo: null,
  commission: { ...noCharge, kind: 'PERCENT', basis: 'GOODS_GROSS', rate: { numerator: 15, denominator: 100 },
    rounding: 'HALF_AWAY_FROM_ZERO' },
  serviceFee: noCharge, allowedFundingPolicyIds: [] };

function fixture() {
  const rows = new Map();
  const txs = [];
  let queuePageEnd;
  const key = (table, id) => table + JSON.stringify(id);
  const put = (table, id, row) => rows.set(key(table, id), { ...id, ...row });
  const read = (table, id) => rows.get(key(table, id));
  const branch = { businessId: branchId, ownerId: 'owner', cognitoUserId: 'owner', organizationId: 'organization',
    regionId: 'hira', status: 'approved', isActive: false };
  put(businesses, { businessId: branchId }, branch);
  put(platform, { pk: 'PERSON#owner', sk: 'ORGANIZATION#organization' }, { organizationId: 'organization', subjectId: 'owner' });
  for (const name of ['author', 'approver']) {
    put(staff, { pk: 'EMPLOYEE#' + name, sk: 'PROFILE' }, {
      status: 'ACTIVE', employeeId: name, version: 1, roles: ['bootstrap_admin'], scope: { allRegions: true },
    });
  }
  const db = {
    async send(command) {
      const spec = command.input;
      if (command.constructor.name === 'GetCommand') return { Item: read(spec.TableName, spec.Key) };
      if (command.constructor.name === 'ScanCommand' && spec.TableName === platformDiscounts) {
        return {Items:[...rows].filter(([k])=>k.startsWith(platformDiscounts)).map(([,item])=>item)};
      }
      if (command.constructor.name === 'ScanCommand' && spec.TableName === businesses) {
        assert.equal(spec.Select,'SPECIFIC_ATTRIBUTES');
        return {Items:[...rows].filter(([key])=>key.startsWith(businesses)).map(([,row])=>row)};
      }
      if (command.constructor.name === 'QueryCommand') {
        if (spec.TableName === businesses) return { Items: [{ businessId: branchId }] };
        if (spec.TableName === discounts) {
          assert.equal(spec.IndexName,'BusinessIdIndex');
          return {Items:[...rows].filter(([k,row])=>k.startsWith(discounts)&&row.businessId===spec.ExpressionAttributeValues[':business'])
            .map(([,item])=>item)};
        }
        const pk = spec.ExpressionAttributeValues[':pk'];
        if (pk==='COMMERCIAL_FUNDING_QUEUE') {
          const selected=[...rows.values()].filter(row=>row.pk===pk&&
            ['businessId','campaignId','source'].every(name=>spec.ExpressionAttributeValues[':'+name]===undefined||
              row[name]===spec.ExpressionAttributeValues[':'+name]));
          const last=queuePageEnd;
          queuePageEnd=undefined;
          return {Items:selected,LastEvaluatedKey:last&&{pk,sk:last}};
        }
        return { Items: [...rows.values()].filter(row => row.pk === pk && row.sk?.startsWith(spec.ExpressionAttributeValues[':p'])) };
      }
      assert.equal(command.constructor.name, 'TransactWriteCommand');
      txs.push(spec.TransactItems);
      for (const op of spec.TransactItems) {
        const change = Object.values(op)[0];
        assert.ok([...Object.values(tables),discounts,platformDiscounts,noticeOutbox].includes(change.TableName), change.TableName);
        if (op.Put) {
          const { Item, TableName } = op.Put;
          put(TableName, TableName===noticeOutbox?{eventId:Item.eventId}:{pk: Item.pk, sk: Item.sk}, Item);
        }
        if (op.Update) {
          put(businesses, change.Key, { ...read(businesses, change.Key),
            commercialAgreementId: change.ExpressionAttributeValues[':aid'],
            commercialAgreementVersion: change.ExpressionAttributeValues[':av'] });
        }
      }
      return {};
    },
  };
  const verify = audience => async sub => {
    if (sub === 'invalid') throw Error();
    return { sub, iss: 'https://cognito-idp.us-east-1.amazonaws.com/' + identities[audience].poolId,
      client_id: identities[audience].clientId, token_use: 'access', exp: date() / 1000 + 120, auth_time: date() / 1000 - 800 };
  };
  const admin = createApi({ db, now: date, verifyAccess: verify('admin'), liveIdentity: async claims => ({
    Enabled: true, UserStatus: 'CONFIRMED', UserAttributes: [{ Name: 'sub', Value: claims.sub }],
    UserMFASettingList: ['SOFTWARE_TOKEN_MFA'],
  }) }, 'staff');
  const merchant = createApi({ db, now: date, verifyAccess: verify('merchant'),
    verifyMerchantId: async sub => ({ sub, phone_number: '+9647800000000' }),
    liveIdentity: async sub => ({ UserAttributes: [
      { Name: 'sub', Value: sub }, { Name: 'phone_number', Value: '+9647800000000' },
      { Name: 'phone_number_verified', Value: 'true' },
    ] }),
  }, 'owner');
  return { db, put, read, txs,setQueuePageEnd:value=>{queuePageEnd=value;},
    browse:(who,query,owner=false)=>(owner?merchant:admin)({
      path:owner?ownerPath:staffPath,requestContext:{stage:'production'},httpMethod:'GET',queryStringParameters:query,
      headers:{Authorization:'Bearer '+who,...(owner&&{'Access-Token':who})},
    }),
    call: (who, input, owner = false, idSub = who, view) => (owner ? merchant : admin)({
    path: owner ? ownerPath : staffPath, requestContext: { stage: 'production' },
    httpMethod: input ? 'POST' : 'GET', queryStringParameters: { businessId: branchId, ...(view!==undefined&&{view}) },
    headers: { Authorization: 'Bearer ' + idSub, ...(owner && { 'Access-Token': who }) },
    body: input && JSON.stringify({ businessId: branchId, ...input }),
  }) };
}

test('the same authorized production employee prepares and approves after the owner accepts', async () => {
  const f = fixture();
  const proposal = { action: 'SAVE_AGREEMENT', id: agreementId, baseVersion: 0, draftVersion: 0,
    requestId: randomUUID(), businessIds: [branchId], values: terms, reason: 'إعداد اتفاقية العمولة' };
  const saved = await f.call('author', proposal);
  assert.equal(saved.statusCode, 200, saved.body);
  const row = JSON.parse(saved.body);
  const decision = { id: agreementId, baseVersion: 0, draftVersion: row.draftVersion, hash: row.hash };
  const review = { ...decision, action: 'APPROVE_AGREEMENT', requestId: randomUUID(), reason: 'مراجعة شروط العمولة' };
  const beforeConsent = await f.call('author', review);
  assert.equal(beforeConsent.statusCode, 409);
  assert.equal(JSON.parse(beforeConsent.body).error, 'OWNER_ACCEPTANCE_REQUIRED');
  assert.equal((await f.call('owner', undefined, true, 'other')).statusCode, 401);
  assert.equal((await f.call('other', undefined, true)).statusCode, 404);
  const owned = JSON.parse((await f.call('owner', undefined, true)).body);
  assert.equal(owned.items[0].draft.kind, 'AGREEMENT');
  const accept = { ...decision, requestId: randomUUID(), action: 'ACCEPT_AGREEMENT' };
  assert.equal((await f.call('owner', accept, true)).statusCode, 200);
  const authorKey = { pk: 'EMPLOYEE#author', sk: 'PROFILE' };
  const employee = f.read(staff, authorKey);
  f.put(staff, authorKey, { ...employee, roles: ['commercial_editor'] });
  assert.equal((await f.call('author', review)).statusCode, 403);
  f.put(staff, authorKey, employee);
  const approve = await f.call('author', review);
  assert.equal(approve.statusCode, 200, approve.body);
  const pk = 'COMMERCIAL_AGREEMENT#' + agreementId;
  const record = f.read(platform, { pk, sk: 'VERSION#1' });
  const approval = f.read(staff, { pk, sk: 'APPROVAL#1' });
  const acceptance = f.read(platform, { pk, sk: 'ACCEPTANCE#1' });
  assert.equal(record.termsHash, hash({ terms: record.terms, otherCharges: record.otherCharges,
    allowedFundingPolicyIds: record.allowedFundingPolicyIds, fundingPolicySnapshots: record.fundingPolicySnapshots }));
  assert.equal(approval.termsHash, record.termsHash);
  assert.equal(approval.staffId, 'author');
  assert.equal(acceptance.termsHash, record.termsHash);
  assert.equal(f.read(businesses, { businessId: branchId }).commercialAgreementVersion, 1);
  const replay = await f.call('author', review);
  assert.equal(JSON.parse(replay.body).replayed, true);
});

test('the global funding queue filters canonical states, checks the caller and keeps cursors scoped', async () => {
  const f=fixture();
  const campaign={discountId:'queued-offer',businessId:branchId,title:'عرض قائمة التمويل',type:'fixedAmount',value:1000,
    version:1,status:'active',usage_limit:10,valid_from:'2026-11-24T10:00:00.000Z',valid_to:'2026-12-10T00:00:00.000Z'};
  f.put(discounts,{discountId:campaign.discountId},campaign);
  const id='queued-share';
  const created=await f.call('author',{action:'SAVE_FUNDING',id,draftVersion:0,baseVersion:0,
    requestId:randomUUID(),reason:'إعداد مشاركة التمويل',businessIds:[branchId],values:{
      campaignId:campaign.discountId,source:'MERCHANT',campaignVersion:1,effectiveFrom:campaign.valid_from,
      effectiveTo:campaign.valid_to,merchantNumerator:50,denominator:100,
      merchantShareFinalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'},
    }});
  assert.equal(created.statusCode,200,created.body);
  const parsed=JSON.parse(created.body);
  const operations=f.txs.at(-1);
  assert.ok(operations.some(op=>op.Put?.Item.pk==='COMMERCIAL_FUNDING_QUEUE'&&op.Put.Item.id===id));
  const notice=operations.find(op=>op.Put?.TableName===noticeOutbox).Put;
  assert.match(notice.Item.eventId,/^COMMERCIAL_SHARING_NOTICE#[a-f0-9]{64}$/);
  assert.equal(notice.Item.deliveryStatus,'COMMERCIAL_PENDING');
  assert.equal(notice.Item.noticePk,'DISCOUNT_FUNDING#'+id);
  assert.equal(notice.Item.noticeSk,'NOTICE#1');
  assert.equal(notice.ConditionExpression,'attribute_not_exists(eventId)');
  const listing=async query=>{
    const result=await f.browse('author',{view:'funding-queue',...query});
    assert.equal(result.statusCode,200,result.body);
    return JSON.parse(result.body);
  };
  assert.equal((await f.browse('owner',{view:'funding-queue'},true)).statusCode,403);
  const all=await listing({});
  assert.equal(all.items[0].status,'WAITING');
  assert.equal(all.items[0].branch.id,branchId);
  assert.equal(all.items[0].campaignLabel,campaign.title);
  assert.equal(all.items[0].draft.hash,parsed.hash);
  assert.deepEqual((await listing({businessId:'foreign'})).items,[]);
  assert.deepEqual((await listing({campaignId:campaign.discountId,source:'PLATFORM'})).items,[]);
  assert.deepEqual((await listing({status:'READY'})).items,[]);
  const decision={id,hash:parsed.hash,draftVersion:parsed.draftVersion,baseVersion:0};
  const accept=await f.call('owner',{...decision,action:'ACCEPT_FUNDING',requestId:randomUUID()},true);
  assert.equal(accept.statusCode,200,accept.body);
  f.setQueuePageEnd('FUNDING#'+id);
  const ready=await listing({status:'READY'});
  assert.equal(ready.items[0].acceptedRole,'OWNER');
  assert.equal((await f.browse('author',{view:'funding-queue',status:'APPROVED',cursor:ready.nextCursor})).statusCode,400);
  const approve=await f.call('author',{...decision,action:'APPROVE_FUNDING',requestId:randomUUID(),reason:'اعتماد المشاركة'});
  assert.equal(approve.statusCode,200,approve.body);
  assert.equal((await listing({status:'APPROVED'})).items[0].draft.publishedVersion,1);
  const picker=await f.browse('author',{view:'funding-branches'});
  assert.equal(picker.statusCode,200,picker.body);
  assert.deepEqual(JSON.parse(picker.body).items,[{id:branchId,name:'فرع مسجّل'}]);
  assert.ok(f.txs.at(-1)[0].ConditionCheck.Key.pk==='EMPLOYEE#author');
  const branch=f.read(businesses,{businessId:branchId});
  f.put(businesses,{businessId:branchId},{...branch,ownerId:'new-owner',cognitoUserId:'new-owner'});
  assert.deepEqual((await listing({})).items,[]);
});

test('customer pricing reads the published agreement through its production table bindings', async () => {
  const { readStagingCommercialAgreement } = require('../../../../wizzuser-stg/backend/src/functions/create-order/quote-runtime/orderCommercialSource');
  const previous = { ...process.env };
  Object.assign(process.env, { ENVIRONMENT: 'production', AWS_REGION: 'us-east-1' });
  try {
    const f = fixture();
    const id = 'contract-for-pricing';
    const save = await f.call('author', { action: 'SAVE_AGREEMENT', id, baseVersion: 0, draftVersion: 0,
      requestId: randomUUID(), businessIds: [branchId], values: terms, reason: 'إعداد اتفاقية طلب الزبون' });
    const draft = JSON.parse(save.body);
    const target = { id, baseVersion: 0, draftVersion: draft.draftVersion, hash: draft.hash };
    await f.call('owner', { ...target, action: 'ACCEPT_AGREEMENT', requestId: randomUUID() }, true);
    const approved = await f.call('approver', { ...target, action: 'APPROVE_AGREEMENT', requestId: randomUUID(),
      reason: 'اعتماد اتفاقية طلب الزبون' });
    assert.equal(approved.statusCode, 200, approved.body);
    const branch = f.read(businesses, { businessId: branchId });
    f.put(businesses, { businessId: branchId }, { ...branch, isActive: true, onboardingComplete: true,
      onboardingSchemaVersion: 2, acceptingOrders: true });
    const result = await readStagingCommercialAgreement(f.db, branchId, date());
    assert.equal(result.version, 1);
    assert.equal(result.agreementId, id);
    assert.equal(result.terms.commission.rate.numerator, 15);

    // Ownership changes invalidate the old signature and allow a fresh agreement to restore checkout.
    f.put(businesses, { businessId: branchId }, { ...f.read(businesses, { businessId: branchId }),
      ownerId: 'new-owner', cognitoUserId: 'new-owner' });
    f.put(platform, { pk: 'PERSON#new-owner', sk: 'ORGANIZATION#organization' },
      { organizationId: 'organization', subjectId: 'new-owner' });
    await assert.rejects(readStagingCommercialAgreement(f.db, branchId, date()), { code: 'COMMERCIAL_SOURCE_UNAVAILABLE' });

    const nextId = 'new-owner-contract';
    const nextDraft = await f.call('author', { action: 'SAVE_AGREEMENT', id: nextId, baseVersion: 0, draftVersion: 0,
      requestId: randomUUID(), businessIds: [branchId], values: terms, reason: 'تجديد الاتفاقية للمالك الجديد' });
    assert.equal(nextDraft.statusCode, 200, nextDraft.body);
    const next = JSON.parse(nextDraft.body);
    const nextTarget = { id: nextId, baseVersion: 0, draftVersion: next.draftVersion, hash: next.hash };
    assert.equal((await f.call('owner', { ...nextTarget, action: 'ACCEPT_AGREEMENT', requestId: randomUUID() }, true)).statusCode, 404);
    const newConsent = await f.call('new-owner', { ...nextTarget, action: 'ACCEPT_AGREEMENT', requestId: randomUUID() }, true);
    assert.equal(newConsent.statusCode, 200, newConsent.body);
    const newApproval = await f.call('author', { ...nextTarget, action: 'APPROVE_AGREEMENT', requestId: randomUUID(),
      reason: 'اعتماد اتفاقية المالك الجديد' });
    assert.equal(newApproval.statusCode, 200, newApproval.body);
    const resumed = await readStagingCommercialAgreement(f.db, branchId, date());
    assert.equal(resumed.ownerId, 'new-owner');
    assert.equal(resumed.agreementId, nextId);

  } finally {
    for (const name of ['ENVIRONMENT', 'AWS_REGION']) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('production sharing binds owner consent, same-reviewer approval and the funded customer price', async t => {
  const savedEnv={...process.env};
  Object.assign(process.env,{ENVIRONMENT:'production',AWS_REGION:'us-east-1'});
  t.after(()=>{
    for(const name of ['ENVIRONMENT','AWS_REGION']){
      if(savedEnv[name]===undefined) delete process.env[name];
      else process.env[name]=savedEnv[name];
    }
  });
  const f=fixture();
  const call=async (who,payload,owner=false,view,expected=200)=>{
    const r=await f.call(who,payload,owner,who,view);
    assert.equal(r.statusCode,expected,r.body);
    return JSON.parse(r.body);
  };
  const draftAgreement=await call('author',{action:'SAVE_AGREEMENT',id:agreementId,draftVersion:0,baseVersion:0,
    requestId:randomUUID(),businessIds:[branchId],values:terms,reason:'اتفاقية احتساب الاختبار'});
  const agreement={id:agreementId,draftVersion:draftAgreement.draftVersion,hash:draftAgreement.hash,baseVersion:0};
  await call('owner',{...agreement,requestId:randomUUID(),action:'ACCEPT_AGREEMENT'},true);
  await call('author',{...agreement,requestId:randomUUID(),action:'APPROVE_AGREEMENT',reason:'اعتماد الاتفاقية'});
  const campaign={discountId:'branch-offer',businessId:branchId,title:'خصم الاختبار',type:'percentage',value:20,
    version:1,status:'active',usage_limit:10,maxDiscountAmount:2000,
    valid_from:'2026-11-24T10:00:00.000Z',valid_to:'2026-12-10T00:00:00.000Z'};
  f.put(discounts,{discountId:campaign.discountId},campaign);
  f.put(platformDiscounts,{discountId:'other-branch'},{...campaign,businessId:'other'});
  const options=(await call('author',undefined,false,'funding-options')).options;
  assert.deepEqual(options.map(o=>o.id),[campaign.discountId]);
  const id='sharing-fixture';
  const vals={campaignId:campaign.discountId,source:'MERCHANT',campaignVersion:1,
    effectiveFrom:campaign.valid_from,effectiveTo:campaign.valid_to,merchantNumerator:35,denominator:100,
    merchantShareFinalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}};
  const saved=await call('author',{id,baseVersion:0,draftVersion:0,values:vals,businessIds:[branchId],
    action:'SAVE_FUNDING',requestId:randomUUID(),reason:'عرض المشاركة للاختبار'});
  const decision={id,hash:saved.hash,draftVersion:saved.draftVersion,baseVersion:0};
  const handle={...decision,action:'APPROVE_FUNDING',requestId:randomUUID(),reason:'اعتماد المشاركة بعد القبول'};
  assert.equal((await call('author',handle,false,undefined,409)).error,'OWNER_ACCEPTANCE_REQUIRED');
  const pending=await call('owner',undefined,true,'pending-sharing');
  assert.equal(pending.items[0].campaignLabel,campaign.title);
  assert.equal(pending.items[0].draft.kind,'FUNDING');
  assert.equal((await call('author',undefined)).items[0].draft.kind,'AGREEMENT');
  await call('owner',{...decision,action:'ACCEPT_FUNDING',requestId:randomUUID()},true);
  assert.deepEqual((await call('owner',undefined,true,'pending-sharing')).items,[]);
  assert.equal((await call('author',undefined,false,'funding')).items[0].ownerAccepted,true);
  await call('author',handle);
  assert.equal((await call('author',handle)).replayed,true);
  const policy=f.read(staff,{pk:'DISCOUNT_FUNDING#'+id,sk:'CURRENT'});
  const binding=f.read(platform,{pk:'BRANCH#'+branchId,sk:'COMMERCIAL_SHARING#MERCHANT#'+campaign.discountId});
  assert.equal(policy.acceptedBy,'owner');
  assert.equal(policy.approvedBy,'author');
  assert.equal(binding.policyDigest,hash(policy));
  assert.equal(f.read(platform,{pk:'CAMPAIGN_SHARING_LOCK#MERCHANT#'+campaign.discountId,sk:'META'}).locked,true);
  const branch=f.read(businesses,{businessId:branchId});
  f.put(businesses,{businessId:branchId},{...branch,isActive:true,onboardingSchemaVersion:2,onboardingComplete:true,
    acceptingOrders:true,regionPath:['country','governorate','city','zone']});
  f.put('wizz-production-Products',{productId:'product'},{businessId:branchId,categoryId:'menu',price:5000,isAvailable:true});
  f.put('wizz-production-MenuCategories',{categoryId:'menu'},{businessId:branchId,isActive:true});
  for(const [regionId,parent_id,level] of [['zone','city',3],['city','governorate',2],['governorate','country',1]]){
    f.put('wizz-production-Regions',{regionId},{parent_id,level,is_active:1});
  }
  const {createStagingCommercialSource}=require('../../../../wizzuser-stg/backend/src/functions/create-order/quote-runtime/orderCommercialSource');
  const source=createStagingCommercialSource({db:f.db,now:date,enableFullCash:true});
  const priceInput={orderId:'order-test-shared',branchId,items:[{productId:'product',quantity:1}],
    quote:{createdAt:instant,expiresAt:'2026-11-24T11:02:00.000Z',deliveryFeeMinor:1000000,
      origin:{latitude:31.92,longitude:44.45},destination:{latitude:31.93,longitude:44.46},destinationRegionId:'zone'},
    tip:{currency:'IQD',scale:1000,moneySchemaVersion:1,minorAmount:0},
    discount:{campaign,snapshot:{source:'MERCHANT',discountId:campaign.discountId,target:'GOODS',version:1,amount:1000000}}};
  const price=await source.prepare(priceInput);
  assert.equal(price.calculation.allocationInput.merchantGoodsDiscount.minorAmount,350000);
  assert.equal(price.calculation.allocationInput.platformGoodsDiscount.minorAmount,650000);
  assert.equal(price.funding.policy.digest,binding.policyDigest);
  assert.ok(price.operations.some(op=>op.ConditionCheck?.Key.pk===policy.pk));
  assert.ok(price.operations.some(op=>op.Put?.Item.platformGoodsFunding?.minorAmount===650000));
  const updated={...campaign,version:2};
  await assert.rejects(source.prepare({...priceInput,discount:{campaign:updated,
    snapshot:{...priceInput.discount.snapshot,version:2}}}),/DISCOUNT_FUNDING_TERMS_CHANGED/);
});

test('production sharing accepts a delegated branch manager and rechecks membership before approval', async () => {
  const f=fixture(), member={pk:'BRANCH#'+branchId,sk:'MEMBER#manager'};
  const policy={pk:'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',sk:'CURRENT'};
  f.put(staff,policy,{version:1,enabledPermissions:['branch.read']});
  const grant={subjectId:'manager',status:'ACTIVE',ownerId:'owner',businessId:branchId,role:'BRANCH_MANAGER',
    version:1,permissionSchema:2,grant:{roleId:'BRANCH_MANAGER',branchIds:[branchId],permissions:['branch.read']}};
  f.put(platform,member,grant);
  const campaign={discountId:'shared-platform',type:'fixedAmount',title:'عرض المنصة',value:1000,version:2,status:'active',
    startDate:'2026-11-24T10:00:00.000Z',endDate:'2026-12-10T00:00:00.000Z',usageLimit:100};
  f.put(platformDiscounts,{discountId:campaign.discountId},campaign);
  const values={campaignId:campaign.discountId,source:'PLATFORM',campaignVersion:2,
    effectiveFrom:campaign.startDate,effectiveTo:campaign.endDate,merchantNumerator:50,denominator:100,
    merchantShareFinalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}};
  const saved=await f.call('author',{action:'SAVE_FUNDING',id:'share-by-manager',baseVersion:0,draftVersion:0,
    businessIds:[branchId],requestId:randomUUID(),reason:'إرسال للفرع',values});
  assert.equal(saved.statusCode,200,saved.body);
  const draft=JSON.parse(saved.body), decision={id:'share-by-manager',baseVersion:0,draftVersion:draft.draftVersion,hash:draft.hash};
  const accept=await f.call('manager',{...decision,action:'ACCEPT_FUNDING',requestId:randomUUID()},true);
  assert.equal(accept.statusCode,200,accept.body);
  assert.ok(f.txs.at(-1).some(op=>op.ConditionCheck?.Key.sk===member.sk&&op.ConditionCheck.TableName===platform));
  assert.equal((await f.call('manager',{...decision,action:'ACCEPT_AGREEMENT',requestId:randomUUID()},true)).statusCode,404);
  const listed=await f.call('author',undefined,false,'author','funding');
  assert.equal(JSON.parse(listed.body).items[0].acceptedRole,'MANAGER');
  const approval={...decision,action:'APPROVE_FUNDING',requestId:randomUUID(),reason:'اعتماد المشاركة'};
  f.put(platform,member,{...grant,status:'REVOKED',version:2});
  assert.equal((await f.call('author',approval)).statusCode,404);
  assert.equal(f.read(staff,{pk:'DISCOUNT_FUNDING#share-by-manager',sk:'CURRENT'}),undefined);
});
