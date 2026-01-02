// ThemeManager: central design tokens & theming utilities
// Phase A, D & E: theme switching, persistence, and dynamic switching
(function (global) {
  class ThemeManager {
    constructor() {
      this.themeName = 'light';
      this.tokens = this._buildLightTokens();
      this.subscribers = new Set();
    }

    _buildLightTokens() {
      return {
        color: {
          primary: '#00c2e8',
          primaryHover: '#009bb8',
          primaryMuted: '#e6f9fe',
          danger: '#dc2626',
          dangerHover: '#b91c1c',
          warning: '#f59e0b',
          success: '#10b981',
          info: '#0284c7',
          surface: '#ffffff',
          surfaceAlt: '#f8fafc',
          border: '#e2e8f0',
          borderStrong: '#cbd5e1',
          text: '#334155',
          textSoft: '#64748b',
          textFaint: '#94a3b8',
          slate600: '#475569',
          slate700: '#334155'
        },
        radius: { sm: '4px', md: '6px', lg: '8px', pill: '999px' },
        shadow: { sm: '0 1px 2px rgba(0,0,0,0.05)', md: '0 3px 6px rgba(0,0,0,0.08)', lg: '0 6px 18px rgba(0,0,0,0.12)' },
        spacing: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px' },
        font: { family: `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif`, sizeBase: '14px' }
      };
    }
    applyToDocument() {
      const r = document.documentElement;
      const t = this.tokens;
      Object.entries(t.color).forEach(([k, v]) => r.style.setProperty(`--color-${k}`, v));
      Object.entries(t.radius).forEach(([k, v]) => r.style.setProperty(`--radius-${k}`, v));
      Object.entries(t.shadow).forEach(([k, v]) => r.style.setProperty(`--shadow-${k}`, v));
      Object.entries(t.spacing).forEach(([k, v]) => r.style.setProperty(`--space-${k}`, v));
      Object.entries(t.font).forEach(([k, v]) => r.style.setProperty(`--font-${k}`, v));
    }
    _buildDarkTokens() {
      return {
        color: {
          primary: '#33cceb',
          primaryHover: '#00c2e8',
          primaryMuted: '#003440',
          danger: '#ef4444',
          dangerHover: '#dc2626',
          warning: '#f59e0b',
          success: '#10b981',
          info: '#0ea5e9',
          surface: '#0f172a',
          surfaceAlt: '#1e293b',
          border: '#334155',
          borderStrong: '#475569',
          text: '#f1f5f9',
          textSoft: '#cbd5e1',
          textFaint: '#94a3b8',
          slate600: '#cbd5e1',
          slate700: '#e2e8f0'
        },
        radius: { sm: '4px', md: '6px', lg: '8px', pill: '999px' },
        shadow: { sm: '0 1px 2px rgba(0,0,0,0.2)', md: '0 3px 6px rgba(0,0,0,0.3)', lg: '0 6px 18px rgba(0,0,0,0.4)' },
        spacing: { xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px' },
        font: { family: `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif`, sizeBase: '14px' }
      };
    }

    getToken(path) {
      const parts = path.split('.');
      return parts.reduce((acc, p) => acc && acc[p], this.tokens);
    }

    switchTheme(themeName) {
      if (themeName === this.themeName) return;
      this.themeName = themeName;
      this.tokens = themeName === 'dark' ? this._buildDarkTokens() : this._buildLightTokens();

      // Use StorageManager if available
      if (global.StorageManager) {
        global.StorageManager.saveThemePreference(themeName);
      } else {
        try {
          localStorage.setItem('supportApp.theme', themeName);
        } catch (e) {
          console.warn('Theme persistence failed:', e);
        }
      }

      this.applyToDocument();
      this._notify();
      console.log(`[ThemeManager] Switched to ${themeName} theme`);
    }

    _restoreTheme() {
      let saved = null;

      // Use StorageManager if available
      if (global.StorageManager) {
        saved = global.StorageManager.loadThemePreference();
      } else {
        try {
          saved = localStorage.getItem('supportApp.theme');
        } catch (e) {
          console.warn('Theme restoration failed:', e);
        }
      }

      if (saved && (saved === 'light' || saved === 'dark')) {
        this.switchTheme(saved);
      }
    }

    subscribe(fn) { this.subscribers.add(fn); return () => this.subscribers.delete(fn); }
    _notify() { this.subscribers.forEach(fn => { try { fn(this); } catch (e) { console.warn('Theme subscriber error', e); } }); }
  }
  global.ThemeManager = new ThemeManager();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      global.ThemeManager._restoreTheme();
      global.ThemeManager.applyToDocument();
    });
  } else {
    global.ThemeManager._restoreTheme();
    global.ThemeManager.applyToDocument();
  }
})(window);
