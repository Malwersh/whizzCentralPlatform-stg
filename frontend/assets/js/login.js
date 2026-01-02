// WizzCentral Login Page Script (externalized for CSP compliance)
(function initLoginPage(){
  function getPostLoginUrl() {
    const cfg = window.WIZZCENTRAL_CONFIG || {};
    return cfg.DEFAULT_POST_LOGIN_PAGE || '/pages/dashboard.html';
  }

  try {
    const isAuthed = localStorage.getItem('isAuthenticated') === 'true';
    const idToken = localStorage.getItem('idToken');
    if (isAuthed && idToken) {
      window.location.replace(getPostLoginUrl());
      return; // Skip initialization if already logged in
    }
  } catch(_){}

  // Simple logger
  function log(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  // Status helper
  function showStatus(message, type = 'info') {
    const status = document.getElementById('status');
    if (!status) return;
    status.textContent = message;
    status.className = `status ${type}`;
    if (message) status.classList.add('is-visible'); else status.classList.remove('is-visible');
  }
  window.showStatus = showStatus; // expose for early errors

  // Ensure Cognito library loaded
  if (!window.AmazonCognitoIdentity) {
    console.error('Cognito library not loaded - check CSP or network');
    showStatus('❌ Auth library failed to load', 'error');
    return; // Abort further auth setup
  }

  // Cognito configuration
  const cfg = window.WIZZCENTRAL_CONFIG || {};
  const COGNITO_CONFIG = {
    region: cfg.COGNITO_REGION,
    userPoolId: cfg.COGNITO_USER_POOL_ID,
    clientId: cfg.COGNITO_CLIENT_ID
  };
  if (!COGNITO_CONFIG.region || !COGNITO_CONFIG.userPoolId || !COGNITO_CONFIG.clientId) {
    console.error('Missing Cognito config. Ensure env.js + config.js are loaded and Amplify env vars are set.');
    showStatus('❌ Missing Cognito configuration', 'error');
    return;
  }

  log('Initializing Cognito User Pool...', 'info');
  const poolData = { UserPoolId: COGNITO_CONFIG.userPoolId, ClientId: COGNITO_CONFIG.clientId };
  const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
  log('✅ User Pool initialized', 'success');

  // Login submit handler
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailEl = document.getElementById('email');
      const passwordEl = document.getElementById('password');
      const loginBtn = document.getElementById('loginBtn');
      if (!emailEl || !passwordEl || !loginBtn) return;

      const email = emailEl.value.trim();
      const password = passwordEl.value.trim();
      if (!email || !password) { showStatus('Please enter both email and password', 'error'); return; }

      loginBtn.disabled = true; loginBtn.textContent = 'Signing in...';
      showStatus('Authenticating...', 'info');
      log(`Starting authentication for: ${email}`, 'info');

      try {
        const authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({ Username: email, Password: password });
        const cognitoUser = new AmazonCognitoIdentity.CognitoUser({ Username: email, Pool: userPool });
        cognitoUser.authenticateUser(authenticationDetails, {
          onSuccess: function(result) {
            log('✅ Authentication successful!', 'success');
            const accessToken = result.getAccessToken().getJwtToken();
            const idToken = result.getIdToken().getJwtToken();
            const refreshToken = result.getRefreshToken().getToken();
            localStorage.setItem('accessToken', accessToken);
            localStorage.setItem('idToken', idToken);
            localStorage.setItem('refreshToken', refreshToken);
            localStorage.setItem('userEmail', email);
            localStorage.setItem('isAuthenticated', 'true');
            localStorage.setItem('lastLoginTime', Date.now().toString());
            showStatus('✅ Login successful! Redirecting...', 'success');
            setTimeout(() => {
              const returnUrl = localStorage.getItem('returnUrl');
              if (returnUrl) { localStorage.removeItem('returnUrl'); window.location.href = returnUrl; }
              else { window.location.href = getPostLoginUrl(); }
            }, 1500);
          },
          onFailure: function(err) {
            log(`❌ Authentication failed: ${err.code || err.name}`, 'error');
            log(`Error message: ${err.message}`, 'error');
            let errorMessage = 'Login failed';
            if (err.code === 'NotAuthorizedException') errorMessage = 'Invalid email or password';
            else if (err.code === 'UserNotConfirmedException') errorMessage = 'Please verify your email address';
            else if (err.code === 'UserNotFoundException') errorMessage = 'User not found';
            else if (err.message) errorMessage = err.message;
            showStatus(`❌ ${errorMessage}`, 'error');
            loginBtn.disabled = false; loginBtn.textContent = 'Sign In';
          },
          newPasswordRequired: function(userAttributes, requiredAttributes) {
            log('⚠️ New password required', 'warning');
            showStatus('Please set a new password to continue', 'info');
            loginForm.classList.add('hidden');
            const npForm = document.getElementById('newPasswordForm');
            if (npForm) npForm.classList.remove('hidden');
            const subtitle = document.querySelector('.subtitle');
            if (subtitle) subtitle.textContent = 'Set your new password';
            loginBtn.disabled = false; loginBtn.textContent = 'Sign In';
            window.pendingPasswordChange = { cognitoUser, userAttributes, requiredAttributes };
          }
        });
      } catch (error) {
        log(`❌ Unexpected error: ${error}`, 'error');
        showStatus('❌ An unexpected error occurred', 'error');
        loginBtn.disabled = false; loginBtn.textContent = 'Sign In';
      }
    });
  }

  // New password form handler
  const newPasswordForm = document.getElementById('newPasswordForm');
  if (newPasswordForm) {
    newPasswordForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const newPasswordEl = document.getElementById('newPassword');
      const confirmPasswordEl = document.getElementById('confirmPassword');
      const btn = document.getElementById('changePasswordBtn');
      if (!newPasswordEl || !confirmPasswordEl || !btn) return;
      const newPassword = newPasswordEl.value.trim();
      const confirmPassword = confirmPasswordEl.value.trim();
      if (newPassword !== confirmPassword) { showStatus('❌ Passwords do not match', 'error'); return; }
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
      if (!passwordRegex.test(newPassword)) { showStatus('❌ Password must meet complexity requirements', 'error'); return; }
      btn.disabled = true; btn.textContent = 'Changing Password...'; showStatus('Changing password...', 'info');
      try {
        const pending = window.pendingPasswordChange;
        if (!pending) { showStatus('❌ Password change context missing', 'error'); btn.disabled = false; btn.textContent = 'Change Password'; return; }
        const { cognitoUser, userAttributes } = pending;
        const userEmail = userAttributes.email;
        delete userAttributes.email_verified; delete userAttributes.email;
        cognitoUser.completeNewPasswordChallenge(newPassword, userAttributes, {
          onSuccess: function(result) {
            log('✅ Password changed successfully!', 'success');
            localStorage.setItem('accessToken', result.getAccessToken().getJwtToken());
            localStorage.setItem('idToken', result.getIdToken().getJwtToken());
            localStorage.setItem('refreshToken', result.getRefreshToken().getToken());
            localStorage.setItem('userEmail', userEmail);
            localStorage.setItem('isAuthenticated', 'true');
            localStorage.setItem('lastLoginTime', Date.now().toString());
            showStatus('✅ Password changed! Redirecting to dashboard...', 'success');
            delete window.pendingPasswordChange;
            setTimeout(() => { window.location.href = getPostLoginUrl(); }, 1500);
          },
          onFailure: function(err) {
            log(`❌ Password change failed: ${err.code || err.name}`, 'error');
            log(`Error message: ${err.message}`, 'error');
            const msg = err.message || 'Failed to change password';
            showStatus(`❌ ${msg}`, 'error'); btn.disabled = false; btn.textContent = 'Change Password';
          }
        });
      } catch (error) {
        log(`❌ Unexpected error during password change: ${error}`, 'error');
        showStatus('❌ An unexpected error occurred', 'error'); btn.disabled = false; btn.textContent = 'Change Password';
      }
    });
  }

  // Cancel button logic
  const cancelBtn = document.getElementById('cancelBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      const npForm = document.getElementById('newPasswordForm');
      const loginForm = document.getElementById('loginForm');
      if (npForm) npForm.classList.add('hidden');
      if (loginForm) loginForm.classList.remove('hidden');
      const subtitle = document.querySelector('.subtitle');
      if (subtitle) subtitle.textContent = 'Sign in to your account';
      const np = document.getElementById('newPassword');
      const cp = document.getElementById('confirmPassword');
      if (np) np.value=''; if (cp) cp.value='';
      delete window.pendingPasswordChange;
      showStatus('', 'info');
    });
  }

  log('✅ Login page ready', 'success');
})();
