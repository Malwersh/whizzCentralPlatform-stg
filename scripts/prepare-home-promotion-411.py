from pathlib import Path
import zipfile,subprocess,json
r=Path.cwd();z=zipfile.ZipFile('/tmp/header411-before.zip');data={n:z.read(n) for n in z.namelist()}
def replace(s,a,b):
 assert s.count(a)==1,(a[:110],s.count(a));return s.replace(a,b)
n='home-taxonomy-378.js';s=data[n].decode();s=replace(s,'const p = current.published;','const p = current.published;\n      const promotionHeader=require(process.env.LAMBDA_TASK_ROOT+"/home-promotion-settings.js");')
s=replace(s,'configured: false, version: 0, sections: [], welcome:', 'configured: false, version: 0, sections: [], promotionHeader:promotionHeader.project(null,now), welcome:')
s=replace(s,'configured: true, version: p.revision, filters:', 'configured: true, version: p.revision, promotionHeader:promotionHeader.project(p.promotionHeader,now), filters:')
s=replace(s,'let sections, welcome, nav, filters;', 'let sections, welcome, nav, filters, promo;\n      const promotionHeader=require(process.env.LAMBDA_TASK_ROOT+"/home-promotion-settings.js");')
s=replace(s,'sections = validate(input.sections);','promo=promotionHeader.validate(input.promotionHeader??current.draftPromotionHeader??current.published?.promotionHeader);\n        sections = validate(input.sections);')
s=replace(s,'sections = validate(snapshot.sections);','promo=promotionHeader.validate(snapshot.promotionHeader);\n        sections = validate(snapshot.sections);')
s=replace(s,'sections = validate(current.draft);','promo=promotionHeader.validate(current.draftPromotionHeader??current.published?.promotionHeader);\n        sections = validate(current.draft);')
s=replace(s,'sections, welcome, navigation: nav, filters, publishedAt: now','sections, welcome, navigation: nav, filters, promotionHeader:promo, publishedAt: now')
s=replace(s,'next.draft = sections;','next.draftPromotionHeader=promo;\n        next.draft = sections;');data[n]=s.encode()
n='_discount_review/central-staff/index.js';s=data[n].decode()
s=replace(s,'const campaignId = event.queryStringParameters?.campaignId;', '''const headerOffers=event.queryStringParameters?.headerOffers==='1';
      const merchantOffer=event.queryStringParameters?.offerSource==='merchant';
      const headerConfig=headerOffers?require(process.env.LAMBDA_TASK_ROOT+'/home-promotion-settings.js').project((await get3(ctx,ctx.table,{pk:'HOME_LAYOUT',sk:'CURRENT'}))?.published?.promotionHeader):null;
      const campaignId = event.queryStringParameters?.campaignId;''')
s=replace(s,'const standalone = event.queryStringParameters?.campaigns === "1" || campaignId !== void 0;', '''const standalone = headerOffers || event.queryStringParameters?.campaigns === "1" || campaignId !== void 0;
      if(headerOffers&&(!headerConfig.enabled||headerConfig.selection?.source==='benefit'))return {campaigns:[]};''')
s=replace(s,'const rows = standalone ? campaignId ? [await get3(ctx, TABLES.campaign, { discountId: campaignId })] : await scan(ctx, TABLES.campaign) : [];', '''const rows = standalone ? campaignId ? [await get3(ctx, merchantOffer?TABLES.discount:TABLES.campaign, { discountId: campaignId })] : headerOffers ? [...(headerConfig.source!=='merchant'?await scan(ctx,TABLES.campaign):[]),...(headerConfig.source!=='platform'?await scan(ctx,TABLES.discount):[])] : await scan(ctx, TABLES.campaign) : [];''')
s=replace(s,'r7 && !r7.benefit && !r7.isDeleted && !r7.deletedAt && offerLive(r7)',"r7 && !r7.benefit && !r7.isDeleted && !r7.deletedAt && offerLive(r7) && (!headerOffers||!headerConfig.selection||(headerConfig.selection.source!=='benefit'&&headerConfig.selection.id===r7.discountId&&headerConfig.selection.source===(r7.businessId?'merchant':'platform')))")
s=replace(s,'type: r7.discountSource === "campaign" ? "campaign" : "platform"','type: r7.businessId ? "discount" : r7.discountSource === "campaign" ? "campaign" : "platform"')
s=replace(s,'!merchant || merchant.isDeleted || merchant.deletedAt || merchant.isActive === false || merchant.platformSuspended === true',"!merchant || merchant.isDeleted || merchant.deletedAt || merchant.isActive === false || merchant.platformSuspended === true || (headerOffers&&(!merchant.regionId||!ancestors.includes(merchant.regionId)))")
s=replace(s,'offerSource: s7.action.type === "discount" ? "merchant" : "platform", merchants', 'offerSource: s7.action.type === "discount" ? "merchant" : "platform", offerType:offerInfo(row).type,offerValue:offerInfo(row).value, merchants')
data[n]=s.encode();data['home-promotion-settings.js']=(r/'backend/staff-service/home-promotion-settings.js').read_bytes()
changed=[k for k,v in data.items() if k not in z.namelist() or v!=z.read(k)];assert set(changed)=={'home-taxonomy-378.js','_discount_review/central-staff/index.js','home-promotion-settings.js'}
for i,n in enumerate(changed):
 p=Path('/tmp/header411-check'+str(i)+'.cjs');p.write_bytes(data[n]);subprocess.check_call(['node','--check',str(p)])
with zipfile.ZipFile('/tmp/header411-candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
 for n,v in data.items():out.writestr(n,v)
Path('/tmp/header411-changed.json').write_text(json.dumps(changed));print('Prepared only',changed)
