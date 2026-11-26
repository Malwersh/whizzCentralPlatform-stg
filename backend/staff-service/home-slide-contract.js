'use strict';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const id=v=>typeof v==='string'&&/^[\w-]{1,150}$/.test(v);

function validate(s,{allowAnnouncement=false}={}){
 if(!s||typeof s.title!=='string'||!s.title.trim()||s.title.length>100||/[<>\u0000-\u001F]/.test(s.title))throw fail('Enter a slide title (up to 100 characters).');
 if(!id(s.id)||!['draft','published','paused'].includes(s.status))throw fail('Invalid slide or status.');
 if(!['all','registered','guests'].includes(s.audience))throw fail('Choose a valid audience.');
 if(!Array.isArray(s.regionIds)||s.regionIds.length>50||s.regionIds.some(r=>!id(r)))throw fail('Choose valid regions.');
 if(!Number.isInteger(s.displayOrder)||s.displayOrder<0||s.displayOrder>999)throw fail('Display order must be between 0 and 999.');
 if(!['merchant','campaign','category','discount','platform',...(allowAnnouncement?['announcement']:[])].includes(s.action?.type)||!id(s.action?.id))throw fail('Choose a tap destination.');
 if(s.action.type==='category'&&!id(s.action.merchantId))throw fail('Choose the category merchant.');
 const date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
 if(!date(s.startAt)||!date(s.endAt)||Date.parse(s.endAt)<=Date.parse(s.startAt))throw fail('End time must be after the start time.');
 if(typeof s.imageKey!=='string'||!/^home-slideshow\/[\w-]+\/[\w-]+\.(?:jpg|gif)$/.test(s.imageKey))throw fail('Upload an image first.');
 return {id:s.id,title:s.title.trim(),status:s.status,audience:s.audience,regionIds:[...new Set(s.regionIds)],displayOrder:s.displayOrder,startAt:s.startAt,endAt:s.endAt,imageKey:s.imageKey,action:{type:s.action.type,id:s.action.id,...(s.action.type==='category'?{merchantId:s.action.merchantId}:{})}};
}
function eligible(s,{now=Date.now(),signedIn=false,regionIds=[]}={}){
 return s.status==='published'&&Date.parse(s.startAt)<=now&&now<Date.parse(s.endAt)&&
  (s.audience==='all'||s.audience===(signedIn?'registered':'guests'))&&
  (!s.regionIds.length||s.regionIds.some(id=>regionIds.includes(id)));
}
function validImageMetadata(key,head){
 const gif=key.endsWith('.gif');
 return head.ContentType===(gif?'image/gif':'image/jpeg')&&Number.isFinite(head.ContentLength)&&head.ContentLength>=(gif?35:100)&&head.ContentLength<=(gif?3*1024*1024:600000);
}
function decodeImage(input){
  const gif=input.contentType==='image/gif'||(typeof input.image==='string'&&/^(R0lGODdh|R0lGODlh)/.test(input.image)),limit=gif?3*1024*1024:600000;
  if(input.contentType&&!['image/jpeg','image/gif'].includes(input.contentType))throw fail('Upload a JPEG or GIF image.');
  if(typeof input.image!=='string'||input.image.length>Math.ceil(limit/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.image))throw fail('Upload a JPEG smaller than 600 KB or GIF smaller than 3 MB.');
  const body=Buffer.from(input.image,'base64');
  if(body.length>limit)throw fail('Image is too large.');
  if(gif){
   if(body.length<35||!['GIF87a','GIF89a'].includes(body.toString('ascii',0,6))||body.at(-1)!==0x3b)throw fail('Invalid GIF image.');
   const width=body.readUInt16LE(6),height=body.readUInt16LE(8);
   if(!width||!height||width*height>40000000)throw fail('Invalid GIF dimensions.');
  }else if(body.length<100||body[0]!==255||body[1]!==216||body[2]!==255||body.at(-2)!==255||body.at(-1)!==217)throw fail('Invalid JPEG image.');
 return {body,extension:gif?'gif':'jpg'};
}

module.exports={validate,eligible,validImageMetadata,decodeImage};
