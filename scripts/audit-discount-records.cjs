'use strict';
// Read-only pre-migration report. Accept an export; never guess which conflicting term wins.
const fs=require('node:fs');
const {patchTerms,supported,removed,instant}=require('../backend/src/utils/discount-contract');
const engine=require('../backend/src/utils/discount-engine');
function audit(rows){
 if(!Array.isArray(rows))throw Error('Expected an array of exported discount records');
 const issues=[],codes=new Map();
 for(const row of rows){
  const source=row.businessId?'merchant':'platform',id=row.discountId;
  const report=code=>issues.push({discountId:id,source,code});
  try{patchTerms(null,row,source);}catch(e){report(e.message);}
  if(!supported(row))report('UNSUPPORTED_REDEMPTION_RULE');
  try{const d=source==='merchant'?engine.normalizeDiscount(row):engine.normalizePlatformPromo(row);if(!engine.validShape(d,Number.MAX_SAFE_INTEGER))report('INVALID_DISCOUNT_TERMS');}catch(e){report('INVALID_DISCOUNT_TERMS');}
  if(['validFrom','validTo','valid_from','valid_to','startDate','endDate'].some(k=>typeof row[k]==='string'&&/T/.test(row[k])&&!/(Z|[+-]\d{2}:\d{2})$/.test(row[k])))report('LEGACY_BAGHDAD_DATE_REQUIRES_REVIEW');
  if(row.version===undefined)report('LEGACY_VERSION_REQUIRES_ADOPTION');
  if(source==='platform'&&row.code){const code=row.code.trim().toUpperCase(),previous=codes.get(code);if(previous&&previous!==id){report('DUPLICATE_CODE');issues.push({discountId:previous,source,code:'DUPLICATE_CODE'});}codes.set(code,id);if(row.code!==code)report('LEGACY_CODE_CASE_REQUIRES_REVIEW');}
  if(removed(row)&&row.status==='active')report('DELETED_RECORD_MARKED_ACTIVE');
 }
 return {readOnly:true,records:rows.length,issues};
}
if(require.main===module){if(!process.argv[2]){console.error('Usage: node scripts/audit-discount-records.cjs exported-records.json');process.exitCode=1;}else console.log(JSON.stringify(audit(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2));}
module.exports={audit};
