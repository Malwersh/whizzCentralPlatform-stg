"""Build an inactive production customer enrollment artifact from tested source."""
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent

def build():
    source = ROOT.parents[2] / 'wizzuser-stg/backend/phone-auth'
    names = ['index', 'iraqi-phone', 'challenge-policy', 'login-proof', 'profile-policy', 'lifecycle-fence', 'customer-legal-contract-344']
    modules = {}; evidence = []
    for name in names:
        raw = (source / (name + '.js')).read_text(); text = raw
        if name == 'index':
            old = "process.env.ENVIRONMENT!=='staging'"
            assert text.count(old) == 1
            text = text.replace(old, "process.env.ENVIRONMENT!=='production'")
        if name == 'lifecycle-fence':
            assert text.count("'staging-AccountDeletion'") == 1
            text = text.replace("'staging-AccountDeletion'", "'wizz-production-AccountDeletion'")
        assert 'staging' not in text
        modules[name] = text
        evidence.append({'module': name, 'sourceSha256': hashlib.sha256(raw.encode()).hexdigest(), 'packagedSha256': hashlib.sha256(text.encode()).hexdigest()})
    for audience in ['customer', 'driver', 'merchant']:
        name = audience + '-legal-defaults-344.json'
        modules[name] = 'module.exports=' + json.dumps(json.loads((source / name).read_text())) + ';'
    code = "'use strict';\nconst nativeRequire=require;\nconst factories={\n"
    for name, text in modules.items(): code += json.dumps(name) + ':function(module,exports,require){\n' + text + '\n},\n'
    code += """};
const cache={};
function load(name){
 if(!name.startsWith('./'))return nativeRequire(name);
 const id=name.slice(2);if(!Object.hasOwn(factories,id))throw Error('Unknown module');
 if(!cache[id]){const m={exports:{}};cache[id]=m;factories[id](m,m.exports,load);}return cache[id].exports;
}
exports.handler=async event=>{
 const env=process.env;
 const expected={ENVIRONMENT:'production',USER_POOL_ID:'us-east-1_rNtNKVsVf',CLIENT_ID:'3e8p0ouglrprpd0a3pc91du0hg',OTP_TABLE:'wizz-production-CustomerPhoneAuth',USERS_TABLE:'wizz-production-Customers',DELETION_TABLE:'wizz-production-AccountDeletion',WALLETS_TABLE:'wizz-production-Wallets',LEGAL_SETTINGS_TABLE:'wizz-production-PlatformStaff'};
 if(env.OTP_ENABLED!=='true'||Object.entries(expected).some(([k,v])=>env[k]!==v)||!/^arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz\\/production\\/customer\\/otp-/.test(env.OTP_SECRET_ARN||'')||env.REVIEW_TEST_PHONE||env.REVIEW_TEST_CODE)
  return {statusCode:503,body:JSON.stringify({code:'PRODUCTION_REGISTRATION_UNAVAILABLE',message:'التسجيل غير متاح حاليًا'})};
 return load('./index').handler(event);
};
"""
    return code, {'accountId':'746727375268','status':'LOCAL_ARTIFACT_NOT_DEPLOYED','otpEnabled':False,'sourceEvidence':evidence,'activationRequirements':['Published production legal documents','Scoped enrollment role and API throttling','Production provider credential','End-to-end enrollment, lifecycle and zero-wallet retry tests'], 'driverRemaining':['Replace source wallet-trigger binding with production service','Verify legal acceptance and lifecycle protection before activation']}

if __name__ == '__main__':
    code, mapping=build()
    (ROOT/'phone-auth/customer-registration.bundle.cjs').write_text(code)
    (ROOT/'customer-registration-readiness.json').write_text(json.dumps(mapping,ensure_ascii=False,indent=2)+'\n')
