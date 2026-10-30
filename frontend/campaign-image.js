(function () {
  'use strict';
  const el = id => document.getElementById(id);
  let uploading = false, generation = 0;
  async function api(path, body) {
    await window.Auth.ensureSession();
    const token = window.Auth.getToken('accessToken');
    const r = await fetch(window.WIZZCENTRAL_CONFIG.STAFF_API_BASE_URL + '/staff/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(30000)
    });
    const result = await r.json();
    if (window.Auth.getToken('accessToken') !== token) throw Error('تغيرت جلسة الدخول. أعد تحميل الصفحة.');
    if (!r.ok) throw Error(result.error || 'تعذر تحميل صورة الحملة');
    return result;
  }
  function show(key, url) {
    el('campaign_imageKey').value = key || '';
    el('campaign_imagePreview').hidden = !url;
    if (url) el('campaign_imagePreview').src = url;
    else el('campaign_imagePreview').removeAttribute('src');
  }
  window.CampaignImage = {
    get uploading() { return uploading; },
    reset() { generation++; if (!el('campaign_imageKey')) return; show('', ''); el('campaign_image').value = ''; el('campaign_imageStatus').textContent = ''; },
    async load(id) {
      const n = ++generation;
      const result = await api('promotions?source=PLATFORM&discountId=' + encodeURIComponent(id));
      if (n === generation) show(result.campaign.imageKey, result.campaign.imageUrl);
    }
  };
  function init() {
    if (!el('campaign_image')) return;
    el('campaign_imageRemove').onclick = () => window.CampaignImage.reset();
    el('campaign_image').onchange = async () => {
      const file = el('campaign_image').files[0]; if (!file || uploading) return;
      const isGif = file.type === 'image/gif' || /\.gif$/i.test(file.name || '');
      const n = ++generation, url = URL.createObjectURL(file);
      const submit = el('simplifiedCampaignForm').querySelector('[type=submit]');
      uploading = true; submit.disabled = true; el('campaign_image').disabled = true; el('campaign_imageRemove').disabled = true;
      el('campaign_imageStatus').textContent = 'جارٍ رفع الصورة…';
      try {
        if ((!isGif && !['image/jpeg','image/png','image/webp'].includes(file.type)) || file.size > 10*1024*1024) throw Error('اختر JPG أو PNG أو WebP حتى 10 MB، أو GIF حتى 3 MB.');
        const img = new Image(); img.src = url; await img.decode();
        if (img.naturalWidth*img.naturalHeight > 40000000) throw Error('اختر صورة أقل من 40 ميغابكسل.');
        let image;
        if (isGif) {
          if (file.size > 3*1024*1024) throw Error('اختر GIF بحجم أقل من 3 MB.');
          // Send the original bytes: drawing to canvas removes animation frames.
          image = await new Promise((resolve,reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = () => reject(Error('تعذر قراءة الصورة.'));
            reader.readAsDataURL(file);
          });
        } else {
          const canvas = document.createElement('canvas'), ratio = Math.min(1,1600/img.naturalWidth,1600/img.naturalHeight);
          canvas.width = Math.max(1,Math.round(img.naturalWidth*ratio)); canvas.height = Math.max(1,Math.round(img.naturalHeight*ratio));
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height);
          for (const quality of [.85,.7,.55,.4]) { image = canvas.toDataURL('image/jpeg',quality).split(',')[1]; if (image.length < 790000) break; }
          if (image.length >= 790000) throw Error('اختر صورة أصغر.');
        }
        const result = await api('slideshow/upload',{image,contentType:isGif ? 'image/gif' : 'image/jpeg'});
        if (n !== generation) return;
        show(result.imageKey,result.imageUrl); el('campaign_imageStatus').textContent = 'الصورة جاهزة. احفظ الحملة لتثبيتها.';
      } catch(e) { if(n === generation) el('campaign_imageStatus').textContent = e.message; }
      finally { URL.revokeObjectURL(url); uploading = false; submit.disabled = false; el('campaign_image').disabled = false; el('campaign_imageRemove').disabled = false; }
    };
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
