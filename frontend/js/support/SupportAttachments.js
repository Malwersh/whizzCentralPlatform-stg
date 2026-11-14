(function (global) {
    'use strict';
    const MAX_BYTES = 2 * 1024 * 1024;
    function createPreview(attachment, sessionId) {
        const container = document.createElement('div');
        container.className = 'support-attachment';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'عرض الصورة';
        container.appendChild(button);
        button.addEventListener('click', async () => {
            button.disabled = true;
            button.textContent = 'جارٍ تحميل الصورة…';
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15000);
            try {
                const endpoint = new URL(global.WIZZCENTRAL_CONFIG?.SUPPORT_ATTACHMENTS_API_URL || '');
                if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw Error('Invalid endpoint');
                await global.Auth.ensureSession();
                if (!container.isConnected) return;
                endpoint.searchParams.set('sessionId', sessionId);
                endpoint.searchParams.set('attachmentId', attachment.attachmentId);
                const response = await fetch(endpoint.toString(), {signal: controller.signal, cache: 'no-store', headers: {
                    Authorization: 'Bearer ' + global.Auth.getToken('idToken'), 'X-Support-User-Type': 'support'
                }});
                if (!response.ok || Number(response.headers.get('content-length')) > 3 * 1024 * 1024) throw Error('Unavailable');
                const body = await response.text();
                if (body.length > 3 * 1024 * 1024) throw Error('Invalid size');
                const payload = JSON.parse(body);
                if (payload.attachmentId !== attachment.attachmentId || !['image/png', 'image/jpeg'].includes(payload.contentType) ||
                    typeof payload.dataBase64 !== 'string' || payload.dataBase64.length > 4 * Math.ceil(MAX_BYTES / 3)) throw Error('Invalid image');
                const binary = atob(payload.dataBase64);
                if (!binary.length || binary.length > MAX_BYTES) throw Error('Invalid size');
                if (!container.isConnected) return;
                const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
                const url = URL.createObjectURL(new Blob([bytes], {type: payload.contentType}));
                const img = document.createElement('img');
                img.className = 'support-attachment-image';
                img.alt = 'صورة مرفقة بالمحادثة';
                img.onload = () => URL.revokeObjectURL(url);
                img.onerror = () => { URL.revokeObjectURL(url); img.remove(); button.hidden = false; button.textContent = 'تعذر عرض الصورة؛ إعادة المحاولة'; };
                img.src = url;
                button.hidden = true;
                container.appendChild(img);
            } catch (_) {
                button.textContent = 'تعذر تحميل الصورة؛ إعادة المحاولة';
            } finally {
                clearTimeout(timer);
                button.disabled = false;
            }
        });
        return container;
    }
    global.SupportAttachments = {createPreview};
})(window);
