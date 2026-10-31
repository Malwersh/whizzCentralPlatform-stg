'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:750}});
  await page.setContent(`<html lang="ar" dir="rtl"><style>body{font:18px Arial;background:white;padding:30px}button{margin:10px;padding:16px;border:0;border-radius:12px;font:inherit}.navy{background:#00296b;color:#000!important}.gold{background:#fdc500;color:white}.hover{background:#fdc500;color:white}.hover:hover{background:#00296b}.light{background:#edf2fa;color:#fdc500}button span{color:black!important}.gradient{background:linear-gradient(45deg,#00296b,#00509d);color:black}</style><body><h2>فحص تباين النصوص والأيقونات</h2><button id="navy" class="navy">نص أبيض فوق الكحلي</button><button id="gold" class="gold">نص كحلي فوق الذهبي</button><button id="light" class="light">نص واضح فوق خلفية فاتحة</button><button id="nested" class="navy"><span>نص داخلي</span></button><button id="gradient" class="gradient">خلفية متدرجة</button><button id="hover" class="hover">التمرير والتركيز</button></body></html>`);
  await page.addScriptTag({path:'frontend/assets/js/contrast-controls.js'});
  async function check(id,min=4.5){const r=await page.locator(id).evaluate(el=>{const c=getComputedStyle(el),api=window.WizzControlContrast;let n=el,b;while(n){b=api.parse(getComputedStyle(n).backgroundColor);if(b?.[3]===1)break;n=n.parentElement;}return {fore:c.color,background:b,ratio:b?api.ratio(api.parse(c.color),b):null};});if(r.ratio!=null)assert(r.ratio>=min,JSON.stringify({id,...r}));return r;}
  for(const id of ['#navy','#gold','#light','#nested','#nested span'])await check(id);
  assert.equal(await page.locator('#gradient').evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
  await page.evaluate(()=>{const b=document.createElement('button');b.id='dynamic';b.className='navy';b.innerHTML='<span>عنصر مضاف لاحقًا</span>';document.body.appendChild(b);});
  await page.waitForTimeout(80);await check('#dynamic');await check('#dynamic span');
  await page.locator('#hover').hover();await page.waitForTimeout(80);await check('#hover');await page.mouse.move(0,0);await page.waitForTimeout(80);await check('#hover');
  await page.locator('#gold').evaluate(el=>{el.className='navy';});await page.waitForTimeout(80);await check('#gold');
  await page.screenshot({path:'/private/tmp/contrast-controls-337.png'});
  console.log(JSON.stringify({status:'PASS',checks:11,dynamicControls:true,nestedText:true,hover:true,gradient:true,screenshot:'/private/tmp/contrast-controls-337.png'}));
 }finally{await browser.close();}
})();
