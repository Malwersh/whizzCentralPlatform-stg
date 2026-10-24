"""Prepare code-only transaction diagnostics; no financial or permission writes."""
import pathlib,json,zipfile,copy,hashlib,base64,subprocess
p=pathlib.Path('/private/tmp/merchant-dispatch-188');z=zipfile.ZipFile(p/'startwave.zip');name='dispatch-cycle-runtime.js';s=z.read(name).decode();anchor='''      } catch (error2) {
        const saved = await load(k8);
        if (saved) return receipt(saved, proposed, true);''';assert s.count(anchor)==1
body='''      } catch (error2) {
        console.error("DRIVER_OFFER_STORE_TRANSACTION_FAILED",{code:error2?.name??"Unknown",message:["ValidationException","AccessDeniedException"].includes(error2?.name)?String(error2.message).slice(0,1800):undefined,reasons:(error2?.CancellationReasons??[]).map(r=>r.Code??"None")});
        const saved = await load(k8);
        if (saved) return receipt(saved, proposed, true);''';s=s.replace(anchor,body);(p/'diagnostic-runtime.js').write_text(s);subprocess.run(['node','--check',str(p/'diagnostic-runtime.js')],check=True)
with zipfile.ZipFile(p/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
 for entry in z.infolist():out.writestr(copy.copy(entry),s.encode() if entry.filename==name else z.read(entry.filename))
with zipfile.ZipFile(p/'candidate.zip') as out:assert all(out.read(n)==z.read(n) for n in z.namelist() if n!=name)
print('Prepared diagnostics only, all other ZIP entries preserved.')
