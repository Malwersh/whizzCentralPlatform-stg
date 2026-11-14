// Promotion page feedback: failed reads must not look like empty data.
(function () {
    window.PromotionsUI = {
        showLoadError(kind, error, retry) {
            const discounts = kind === 'discounts';
            const table = document.getElementById(discounts ? 'merchant-discounts-tbody' : 'special-campaigns-tbody');
            if (!table) return;
            const message = String(error?.message || error || '');
            const denied = /accessdenied|not authorized|permission|forbidden/i.test(message);
            const expired = /session|sign in|expired|notauthenticated|unauthorized/i.test(message);
            const title = discounts ? 'Unable to load merchant discounts' : 'Unable to load campaigns';
            const description = denied
                ? 'Your account does not have access to this data. Ask an administrator to check your permissions.'
                : expired
                    ? 'Your session needs attention. Sign in again, then retry.'
                    : 'We could not retrieve this data. Check your connection and try again.';
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 8;
            cell.className = 'promotions-load-error';
            cell.setAttribute('role', 'status');
            const heading = document.createElement('h3');
            heading.textContent = title;
            const text = document.createElement('p');
            text.textContent = description;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-secondary';
            button.textContent = "إعادة المحاولة";
            button.addEventListener('click', async () => {
                button.disabled = true;
                button.textContent = "جارٍ إعادة المحاولة…";
                try { await retry(); }
                finally { button.disabled = false; button.textContent = "إعادة المحاولة"; }
            });
            cell.append(heading, text, button);
            row.append(cell);
            table.replaceChildren(row);
            for (const suffix of ['total', 'active']) {
                const stat = document.getElementById(`${kind}-${suffix}`);
                if (stat) stat.textContent = '—';
            }
        }
    };
})();
