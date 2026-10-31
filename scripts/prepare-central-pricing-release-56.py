"""Overlay existing pricing implementation onto captured live packages; offline only."""
import base64, copy, hashlib, json, pathlib, subprocess, sys, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
def sha(data): return base64.b64encode(hashlib.sha256(data).digest()).decode()
def once(text, old, new):
    if text.count(old) != 1: raise ValueError('PATCH_ANCHOR_CHANGED')
    return text.replace(old, new, 1)
def archive(source, destination, changes):
    if destination.exists(): raise ValueError('DESTINATION_EXISTS')
    with zipfile.ZipFile(source) as old, zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as new:
        names = old.namelist()
        if len(set(names)) != len(names): raise ValueError('DUPLICATE_ENTRIES')
        for info in old.infolist(): new.writestr(copy.copy(info), changes.get(info.filename, old.read(info.filename)))
        for name, data in changes.items():
            if name not in names: new.writestr(name, data)
    with zipfile.ZipFile(source) as old, zipfile.ZipFile(destination) as new:
        assert all(old.read(n) == new.read(n) for n in old.namelist() if n not in changes)
    return {'codeSha256': sha(destination.read_bytes()), 'changedFiles': sorted(changes), 'preservedFiles': len(set(names)-set(changes))}
def main(directory):
    r=pathlib.Path(directory); inv=json.loads((r/'inventory.json').read_text())
    assert sha((r/'staff.zip').read_bytes())==inv['staff']['codeSha256']
    assert sha((r/'frontend.zip').read_bytes())==inv['frontend']['codeSha256']
    staff={n:(ROOT/'backend/staff-service'/n).read_bytes() for n in ['index.js','catalog.js','delivery-pricing.js','pricing-runtime/money.js','pricing-runtime/deliveryPricing.js']}
    with zipfile.ZipFile(r/'staff.zip') as z:
        live=z.read('index.js').decode(); line=next(l for l in staff['index.js'].decode().splitlines(True) if "path==='/staff/pricing'" in l)
        assert staff['index.js'].decode().replace(line,'',1)==live
    with zipfile.ZipFile(r/'frontend.zip') as z:
        changes={n:(ROOT/'frontend'/n).read_bytes() for n in ['pages/delivery-pricing.html','delivery-pricing.js']}
        nav='<li class="nav-item" data-page="pricing"><a href="delivery-pricing.html" class="nav-link" data-nav="page"><i class="fas fa-route"></i><span>Pricing &amp; Commissions</span></a></li>\n'
        for name in ['includes/sidebar.html','assets/js/navigation.js']:
            text=z.read(name).decode(); anchor='<li class="nav-item" data-page="finance">';changes[name]=once(text,anchor,nav+anchor).encode()
        name='assets/js/rbac.js';text=z.read(name).decode()
        text=once(text,"if(this.staff && !this.staff.employee.roles.includes('bootstrap_admin')) {", "if(this.staff && !this.staff.employee.roles.includes('bootstrap_admin')) {\n            if(['pricing.html','delivery-pricing.html'].includes(pageName))return this.staff.permissions.includes('pricing.read');")
        text=once(text,"const read={financial:","const read={pricing:'pricing.read',financial:")
        text=once(text,"const writes={drivers:","const writes={pricing:['pricing.request','pricing.approve'],drivers:")
        text=text.replace("text.includes('delete') || \n","text.includes('delete') ||\n")
        changes[name]=text.encode()
        name='financial-management.html';text=z.read(name).decode();start=text.index('<!-- Delivery Fees Tab -->');end=text.index('<!-- Reports Tab -->',start)
        text=text[:start]+'''<!-- Delivery Fees Tab -->
            <div id="delivery-fees-tab" class="tab-content"><h2>تسعير التوصيل وأجرة السائق</h2><p>إدارة القواعد ذات الإصدارات والمحاكاة والاعتماد من شاشة التسعير المركزية.</p><a href="/pages/delivery-pricing.html">فتح Pricing &amp; Commissions</a></div>
            '''+text[end:];changes[name]=text.encode()
        name='financial-management.js';text=z.read(name).decode()
        # Parse class methods to replace only obsolete delivery-fee entry points.
        helper="""const ts=require('./backend/wallet-service/node_modules/typescript'),fs=require('fs');const t=fs.readFileSync(0,'utf8'),s=ts.createSourceFile('f.js',t,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits=[];const names=new Set(['loadDeliveryFeeRules','createDeliveryFeeRule','editDeliveryRule','deleteDeliveryRule','calculateSampleDeliveryFee']);function walk(n){if(ts.isMethodDeclaration(n)&&names.has(n.name?.text)){const name=n.name.text;edits.push([n.getStart(s),n.end, name==='loadDeliveryFeeRules'?'async loadDeliveryFeeRules() { this.deliveryFeeRules=[]; }':name+'() { window.location.assign(\"/pages/delivery-pricing.html\"); }']);}if(ts.isBinaryExpression(n)&&n.left.getText(s)==='window.testMerchantDelivery')edits.push([n.getStart(s),n.end,'window.testMerchantDelivery = () => window.location.assign(\"/pages/delivery-pricing.html\")']);ts.forEachChild(n,walk);}walk(s);if(edits.length!==6)throw Error('LEGACY_METHOD_SET_CHANGED');let out=t;for(const [a,b,v] of edits.sort((x,y)=>y[0]-x[0]))out=out.slice(0,a)+v+out.slice(b);process.stdout.write(out);"""
        changes[name]=subprocess.run(['node','-e',helper],input=text.encode(),stdout=subprocess.PIPE,check=True,cwd=ROOT).stdout
    manifest={'account':'699561669180','region':'us-east-1','base':inv,'activation':False,
              'staff':archive(r/'staff.zip',r/'staff.candidate.zip',staff),
              'frontend':archive(r/'frontend.zip',r/'frontend.candidate.zip',changes)}
    # Keep source aligned with the live Arabic shell plus the reviewed narrow changes.
    for name,data in changes.items():
        path=ROOT/'frontend'/name;backup=r/'source-backups'/name;backup.parent.mkdir(parents=True,exist_ok=True)
        if path.exists() and not backup.exists():backup.write_bytes(path.read_bytes())
        path.write_bytes(data)
    (r/'pricing-preparation.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest))
if __name__=='__main__':main(sys.argv[1])
