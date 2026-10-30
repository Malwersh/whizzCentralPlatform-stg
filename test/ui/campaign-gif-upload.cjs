const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('campaign GIF upload sends original bytes without flattening to canvas',async()=>{
 const bytes='R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAKAAAALAAAAAABAAEAAAICTAEAOw==';
 const nodes={},submit={};for(const id of ['campaign_image','campaign_imageRemove','campaign_imageKey','campaign_imageStatus','campaign_imagePreview'])nodes[id]={};
 nodes.simplifiedCampaignForm={querySelector:()=>submit};nodes.campaign_image.files=[{type:'image/gif',size:85}];let payload;
 const context={document:{readyState:'complete',getElementById:id=>nodes[id],createElement:()=>{throw Error('GIF must not use canvas');}},window:{Auth:{ensureSession:async()=>{},getToken:()=> 'token'},WIZZCENTRAL_CONFIG:{STAFF_API_BASE_URL:'https://api.example'}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},AbortSignal,Image:class{naturalWidth=1;naturalHeight=1;async decode(){}},FileReader:class{readAsDataURL(){this.result='data:image/gif;base64,'+bytes;this.onload();}},fetch:async(url,options)=>{payload=JSON.parse(options.body);return {ok:true,json:async()=>({imageKey:'home-slideshow/admin/test.gif',imageUrl:'https://example.com/test.gif'})};}};
 vm.runInNewContext(fs.readFileSync('frontend/campaign-image.js','utf8'),context);
 await nodes.campaign_image.onchange();assert.equal(payload.contentType,'image/gif');assert.equal(payload.image,bytes);assert.equal(nodes.campaign_imageKey.value,'home-slideshow/admin/test.gif');assert.equal(submit.disabled,false);
 nodes.campaign_image.files=[{type:'',name:'animated.gif',size:85}];payload=null;await nodes.campaign_image.onchange();assert.equal(payload.contentType,'image/gif');assert.equal(payload.image,bytes);
});
test('slideshow uploader preserves GIF frames and declares image/gif',async()=>{
 const nodes={};for(const id of ['slide-image','slide-save','slide-upload-message','slide-preview','slide-preview-empty'])nodes[id]={};nodes['slide-image'].files=[{type:'image/gif',name:'test.gif',size:85}];let payload;
 const source=fs.readFileSync('frontend/home-slideshow.js','utf8'),start=source.indexOf('async function upload()'),end=source.indexOf("el('slide-form').onsubmit",start);
 const context={el:id=>nodes[id],uploading:false,imageKey:'',URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},Image:class{naturalWidth=1;naturalHeight=1;async decode(){}},FileReader:class{readAsDataURL(){this.result='data:image/gif;base64,R0lGODlh';this.onload();}},document:{createElement:()=>{throw Error('Animation must not be flattened');}},window:{WizzLocale:{error:m=>m}},api:async(path,body)=>{payload=body;return {imageKey:'test.gif',imageUrl:'https://example.com/test.gif'};}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);await context.upload();assert.equal(payload.contentType,'image/gif');assert.equal(payload.image,'R0lGODlh');assert.equal(nodes['slide-preview'].hidden,false);
});
