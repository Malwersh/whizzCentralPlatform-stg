'use strict';
// Run before packaging: a full frontend deployment must retain the complete pricing UI.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
function verify(root){const read=file=>fs.readFileSync(path.join(root,file),'utf8');const html=read('pages/delivery-pricing.html');assert.match(html,/data-pricing-ui="340"/,'Pricing page is older than the reviewed release');
 const assets={'delivery-pricing.js':'function ruleCard','pricing-workspace.js':'pricing-workspace-nav','pricing-region-picker.js':'class PricingRegionPicker','pricing-field-help.js':'function attachDriverHelp','cash-rounding.js':'minimumServiceFeeIqd','styles/pricing-layout.css':'.pricing-choice-grid'};
 for(const [file,marker]of Object.entries(assets)){assert.ok(html.includes('../'+file+'?v='),'Missing pricing page dependency: '+file);assert.ok(read(file).includes(marker),'Stale or incomplete pricing dependency: '+file);}
 assert.ok(html.indexOf('pricing-region-picker.js')<html.indexOf('delivery-pricing.js'),'Region picker must load before editor');assert.ok(html.indexOf('pricing-field-help.js')<html.indexOf('delivery-pricing.js'),'Field help must load before editor');assert.ok(!html.includes('pricing-sample'),'Obsolete branch sample tool must not return');return true;}
module.exports={verify};if(require.main===module){verify(path.resolve(process.argv[2]||'frontend'));console.log('PASS: complete reviewed pricing UI and dependencies retained.');}
