import {readMoney,moneyFromMinor} from './money';
import {quoteCanonical} from './deliveryQuoteRecord';
type Row=Record<string,any>;
const fail=():never=>{throw Error('INVALID_DELIVERY_FUNDING_COMPOSITION');};
export function composeDeliveryFunding(agreement:Row,promotion:Row) {
 if(agreement?.allocation?.schemaVersion!==2||promotion?.allocation?.schemaVersion!==1||agreement.components||promotion.components)return fail();
 const a=agreement.allocation,p=promotion.allocation;
 const n=(v:unknown)=>{const m=readMoney(v);if(m.minorAmount<0)return fail();return m.minorAmount;};
 for(const f of [agreement,promotion]){if(Object.keys(f).sort().join(',')!=='allocation,policyPin'||Object.keys(f.policyPin??{}).sort().join(',')!=='policyId,termsHash,version'||typeof f.policyPin.policyId!=='string'||!Number.isSafeInteger(f.policyPin.version)||f.policyPin.version<1||!/^[a-f0-9]{64}$/.test(f.policyPin.termsHash))return fail();const x=f.allocation;if(Object.keys(x).sort().join(',')!=='customerFee,merchantShare,platformShare,referenceFee,schemaVersion,subsidy')return fail();const ref=n(x.referenceFee),fee=n(x.customerFee),sub=n(x.subsidy);if(sub!==(x.schemaVersion===2?Math.max(0,ref-fee):ref-fee)||n(x.merchantShare)+n(x.platformShare)!==sub)return fail();}
 if(n(a.customerFee)!==n(p.referenceFee)||n(p.subsidy)<=0)return fail();
 const sum=(key:string)=>{const value=n(a[key])+n(p[key]);if(!Number.isSafeInteger(value))return fail();return moneyFromMinor(value);};
 return {policyPin:agreement.policyPin,allocation:{schemaVersion:3,referenceFee:a.referenceFee,customerFee:p.customerFee,subsidy:sum('subsidy'),merchantShare:sum('merchantShare'),platformShare:sum('platformShare')},components:[agreement,promotion]};
}
export function verifyDeliveryFundingComposition(value:Row) {
 if(!Array.isArray(value?.components)||value.components.length!==2)return fail();
 const rebuilt=composeDeliveryFunding(value.components[0],value.components[1]);
 if(quoteCanonical(value)!==quoteCanonical(rebuilt))return fail();return rebuilt;
}
