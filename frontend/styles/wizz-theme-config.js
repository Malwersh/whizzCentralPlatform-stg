/**
 * WizzCentral Platform Theme Configuration
 * Centralized color management for easy brand color changes
 */

// Main brand color palette - Change these to update the entire platform
const WIZZ_THEME_CONFIG = {
  // Primary brand colors
  primary: '#FDC500',        // Main yellow-gold - used for primary buttons, links, focus states
  primaryLight: '#FDD633',   // Lighter variant for hover states
  primaryDark: '#E6B100',    // Darker variant for active states
  
  // Secondary brand colors  
  secondary: '#00296B',      // Secondary navy blue
  tertiary: '#7D5260',       // Tertiary brownish-purple
  
  // Accent colors for semantic meanings
  accent: {
    orange: '#FF6B35',       // Warning/caution states
    green: '#00C851',        // Success/positive states  
    blue: '#2196F3',         // Info/neutral states
    red: '#F44336',          // Error/negative states
    yellow: '#FFB300'        // Warning/attention states
  },
  
  // Neutral colors
  neutral: {
    surface: '#FFFBFE',      // Main background
    surfaceVariant: '#E7E0EC', // Variant background
    outline: '#79747E',      // Border colors
    onSurface: '#1C1B1F'     // Text on surfaces
  }
};

// Function to apply theme colors to CSS custom properties
function applyWizzTheme() {
  const root = document.documentElement;
  
  // Apply brand colors
  root.style.setProperty('--wizz-primary', WIZZ_THEME_CONFIG.primary);
  root.style.setProperty('--wizz-primary-light', WIZZ_THEME_CONFIG.primaryLight);
  root.style.setProperty('--wizz-primary-dark', WIZZ_THEME_CONFIG.primaryDark);
  root.style.setProperty('--wizz-secondary', WIZZ_THEME_CONFIG.secondary);
  root.style.setProperty('--wizz-tertiary', WIZZ_THEME_CONFIG.tertiary);
  
  // Apply accent colors
  root.style.setProperty('--wizz-accent-orange', WIZZ_THEME_CONFIG.accent.orange);
  root.style.setProperty('--wizz-accent-green', WIZZ_THEME_CONFIG.accent.green);
  root.style.setProperty('--wizz-accent-blue', WIZZ_THEME_CONFIG.accent.blue);
  root.style.setProperty('--wizz-accent-red', WIZZ_THEME_CONFIG.accent.red);
  root.style.setProperty('--wizz-accent-yellow', WIZZ_THEME_CONFIG.accent.yellow);
  
  console.log('✅ Wizz theme colors applied successfully');
}

// Function to change primary brand color on the fly
function changeWizzPrimaryColor(newColor) {
  WIZZ_THEME_CONFIG.primary = newColor;
  document.documentElement.style.setProperty('--wizz-primary', newColor);
  document.documentElement.style.setProperty('--md-sys-color-primary', newColor);
  console.log(`🎨 Primary color changed to: ${newColor}`);
}

// Function to change accent colors
function changeWizzAccentColors(newAccentColors) {
  Object.keys(newAccentColors).forEach(colorKey => {
    if (WIZZ_THEME_CONFIG.accent[colorKey]) {
      WIZZ_THEME_CONFIG.accent[colorKey] = newAccentColors[colorKey];
      document.documentElement.style.setProperty(`--wizz-accent-${colorKey}`, newAccentColors[colorKey]);
      
      // Update Material Design system colors
      switch(colorKey) {
        case 'green':
          document.documentElement.style.setProperty('--md-sys-color-success', newAccentColors[colorKey]);
          break;
        case 'red':
          document.documentElement.style.setProperty('--md-sys-color-error', newAccentColors[colorKey]);
          break;
        case 'yellow':
          document.documentElement.style.setProperty('--md-sys-color-warning', newAccentColors[colorKey]);
          break;
        case 'blue':
          document.documentElement.style.setProperty('--md-sys-color-info', newAccentColors[colorKey]);
          break;
      }
    }
  });
  console.log('🎨 Accent colors updated:', newAccentColors);
}

// Predefined color schemes for easy switching
const WIZZ_COLOR_SCHEMES = {
  default: {
    primary: '#00C2E8',
    accent: {
      orange: '#FF6B35',
      green: '#00C851', 
      blue: '#2196F3',
      red: '#F44336',
      yellow: '#FFB300'
    }
  },
  
  // Alternative color scheme - Blue theme
  blue: {
    primary: '#1976D2',
    accent: {
      orange: '#FF8A50',
      green: '#4CAF50',
      blue: '#03DAC6', 
      red: '#F44336',
      yellow: '#FFC107'
    }
  },
  
  // Alternative color scheme - Green theme  
  green: {
    primary: '#388E3C',
    accent: {
      orange: '#FF7043',
      green: '#66BB6A',
      blue: '#42A5F5',
      red: '#E57373', 
      yellow: '#FFCA28'
    }
  },
  
  // Dark theme variant
  dark: {
    primary: '#BB86FC',
    accent: {
      orange: '#CF6679',
      green: '#03DAC6',
      blue: '#82B1FF',
      red: '#CF6679',
      yellow: '#FFD54F'
    }
  }
};

// Function to apply a complete color scheme
function applyWizzColorScheme(schemeName) {
  const scheme = WIZZ_COLOR_SCHEMES[schemeName];
  if (!scheme) {
    console.error(`❌ Color scheme "${schemeName}" not found`);
    return;
  }
  
  changeWizzPrimaryColor(scheme.primary);
  changeWizzAccentColors(scheme.accent);
  console.log(`🎨 Applied color scheme: ${schemeName}`);
}

// Function to generate CSS custom properties from current theme
function generateWizzThemeCSS() {
  return `
/* Generated Wizz Theme CSS */
:root {
  --wizz-primary: ${WIZZ_THEME_CONFIG.primary};
  --wizz-primary-light: ${WIZZ_THEME_CONFIG.primaryLight};
  --wizz-primary-dark: ${WIZZ_THEME_CONFIG.primaryDark};
  --wizz-secondary: ${WIZZ_THEME_CONFIG.secondary};
  --wizz-tertiary: ${WIZZ_THEME_CONFIG.tertiary};
  
  --wizz-accent-orange: ${WIZZ_THEME_CONFIG.accent.orange};
  --wizz-accent-green: ${WIZZ_THEME_CONFIG.accent.green};
  --wizz-accent-blue: ${WIZZ_THEME_CONFIG.accent.blue};
  --wizz-accent-red: ${WIZZ_THEME_CONFIG.accent.red};
  --wizz-accent-yellow: ${WIZZ_THEME_CONFIG.accent.yellow};
}
  `.trim();
}

// Auto-apply theme on load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', applyWizzTheme);
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WIZZ_THEME_CONFIG,
    WIZZ_COLOR_SCHEMES,
    applyWizzTheme,
    changeWizzPrimaryColor,
    changeWizzAccentColors,
    applyWizzColorScheme,
    generateWizzThemeCSS
  };
}

// For browser global usage
if (typeof window !== 'undefined') {
  window.WizzTheme = {
    config: WIZZ_THEME_CONFIG,
    schemes: WIZZ_COLOR_SCHEMES,
    apply: applyWizzTheme,
    changePrimary: changeWizzPrimaryColor,
    changeAccents: changeWizzAccentColors,
    applyScheme: applyWizzColorScheme,
    generateCSS: generateWizzThemeCSS
  };
  
  // Development helper - expose theme controls to console
  console.log(`
🎨 Wizz Theme Controls Available:
- WizzTheme.changePrimary('#YOUR_COLOR')
- WizzTheme.applyScheme('blue|green|dark|default')
- WizzTheme.changeAccents({green: '#00FF00', red: '#FF0000'})
- WizzTheme.generateCSS() // Get current theme as CSS
  `);
}

// Global logout function for sidebar
window.logout = function() {
  // Clear all session data
  sessionStorage.clear();
  localStorage.clear();
  
  // Show logout message
  if (window.showNotification) {
    window.showNotification('Logged out successfully', 'success');
  }
  
  // Redirect to login page
  setTimeout(() => {
    window.location.href = 'login.html';
  }, 1000);
};
