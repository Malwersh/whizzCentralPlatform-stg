'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const dir=process.argv[2],entry=path.join(dir,'runtime/_discount_review/central-staff/index.js');
Object.assign(process.env,JSON.parse(fs.readFileSync(path.join(dir,'environment.private.json'))));process.env.LAMBDA_TASK_ROOT=path.join(dir,'runtime');
const employeeId='74584478-f091-706b-72fc-830746899672',actor={employeeId,status:'ACTIVE',version:1,roles:['bootstrap_admin'],scope:{allRegions:true},mfaRequired:true};
const image='R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAKAAAALAAAAAABAAEAAAICTAEAOw==';
const db={send:async c=>{if(c.input.Key?.pk==='EMPLOYEE#'+employeeId)return {Item:actor};return {};}};
function load(file){
 const m=new Module(entry,module);m.filename=entry;m.paths=Module._nodeModulePaths(path.dirname(entry));
 m._compile(fs.readFileSync(path.join(dir,file),'utf8')+`\nmodule.exports.__set=(d,c,v,a)=>{db=d;cognito=c;verifier=v;const home=require_home_slideshow();const route=home.route;home.route=(ctx,...args)=>route({...ctx,assets:a},...args);};module.exports.__home=()=>require_home_slideshow();`,entry);
 const uploads=[];m.exports.__set(db,{send:async()=>({Enabled:true,UserAttributes:[{Name:'sub',Value:employeeId}],UserMFASettingList:['SOFTWARE_TOKEN_MFA']})},{verify:async()=>({sub:employeeId,username:'offline-fixture',auth_time:Math.floor(Date.now()/1000)})},{put:async(key,body)=>uploads.push({key,body}),url:async key=>'https://example.com/'+key,head:async()=>({ContentType:'image/gif',ContentLength:85})});return {api:m.exports,uploads};
}
(async()=>{
 const event=body=>({httpMethod:'POST',path:'/staff/slideshow/upload',headers:{Authorization:'Bearer SYNTHETIC_OFFLINE'},body:JSON.stringify(body)});
 const old=load('index.js');const failed=await old.api.handler(event({image,contentType:'image/gif'}));assert.equal(failed.statusCode,400);assert.match(JSON.parse(failed.body).error,/JPEG/);assert.equal(old.uploads.length,0);
 const fixed=load('candidate.js');
 for(const body of [{image,contentType:'image/gif'},{image}]){const r=await fixed.api.handler(event(body));assert.equal(r.statusCode,200,r.body);assert.match(JSON.parse(r.body).imageKey,/\.gif$/);}
 assert.equal(fixed.uploads.length,2);assert.deepEqual(fixed.uploads[0].body,Buffer.from(image,'base64'));
 assert.equal(fixed.api.__home().validImageMetadata('image.gif',{ContentType:'image/gif',ContentLength:85}),true);
 console.log('PASS actual authenticated Lambda handler: baseline reproduces JPEG error; candidate preserves GIF with/without MIME, no production writes');
})().catch(e=>{console.error(e);process.exitCode=1;});
