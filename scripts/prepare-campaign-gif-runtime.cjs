'use strict';
// Patch only image handling in the captured deployed staff bundle.
const fs=require('node:fs'),assert=require('node:assert/strict');
const [input,output]=process.argv.slice(2);let text=fs.readFileSync(input,'utf8');
function replace(from,to){assert.equal(text.split(from).length,2,'Unique runtime marker: '+from.slice(0,90));text=text.replace(from,to);}
const local=fs.readFileSync('backend/staff-service/home-slideshow.js','utf8');
const start=local.indexOf('  const gif=input.contentType'),end=local.indexOf('\n  await assets(ctx).put',start);
assert(start>0&&end>start);
const oldStart=text.indexOf('        if (typeof input.image !== "string" || input.image.length > 82e4'),oldEnd=text.indexOf('\n        await assets(ctx).put(imageKey, body);',oldStart);
assert(oldStart>0&&oldEnd>oldStart);
text=text.slice(0,oldStart)+local.slice(start,end).replaceAll('throw fail(', 'throw fail2(').replaceAll('randomUUID()', 'randomUUID2()')+text.slice(oldEnd);
const metadata=local.slice(local.indexOf('function validImageMetadata('),local.indexOf('function assets(ctx)'));
replace('    function assets(ctx) {','    '+metadata+'\n    function assets(ctx) {');
replace('Body, ContentType: "image/jpeg", CacheControl:', 'Body, ContentType: Key.endsWith(".gif") ? "image/gif" : "image/jpeg", CacheControl:');
replace('if (head.ContentType !== "image/jpeg" || head.ContentLength > 6e5)', 'if (!validImageMetadata(s7.imageKey, head))');
replace("if (head.ContentType !== 'image/jpeg' || !Number.isFinite(head.ContentLength) || head.ContentLength < 100 || head.ContentLength > 600000)","if (!require_home_slideshow().validImageMetadata(data.imageKey, head))");
replace("if(head.ContentType!=='image/jpeg'||!Number.isFinite(head.ContentLength)||head.ContentLength<100||head.ContentLength>600000)","if(!require_home_slideshow().validImageMetadata(next.imageKey,head))");
replace('module2.exports = { route, publicFeed, validate: validate2, eligible, KEY, assets };','module2.exports = { route, publicFeed, validate: validate2, eligible, KEY, assets, validImageMetadata };');
const pattern=/\/\^home-slideshow\\\/\[\\w-\]\+\\\/\[\\w-\]\+\\\.jpg\$\//g;
let count=0;text=text.replace(pattern,match=>{count++;return match.replace('\\.jpg','\\.(?:jpg|gif)');});assert.equal(count,3,'Three bundled image key validators');
fs.writeFileSync(output,text);console.log('Patched active bundled upload, S3 MIME, and campaign image validators');
