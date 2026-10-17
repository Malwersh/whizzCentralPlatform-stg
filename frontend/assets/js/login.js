// WizzCentral Login Page Script (externalized for CSP compliance)
(async function initLoginPage(){
  function readStorageItem(key) {
    try {
      const v = localStorage.getItem(key);
      if (v !== null && v !== undefined && v !== '') return v;
    } catch (_) {}
    try { return sessionStorage.getItem(key); } catch (_) { return null; }
  }

  function writeStorageItem(key, value) {
    try { sessionStorage.setItem(key, value); } catch (_) {}
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function removeStorageItem(key) {
    try { sessionStorage.removeItem(key); } catch (_) {}
    try { localStorage.removeItem(key); } catch (_) {}
  }

  function getPostLoginUrl() {
    const cfg = window.WIZZCENTRAL_CONFIG || {};
    return cfg.DEFAULT_POST_LOGIN_PAGE || '/pages/dashboard.html';
  }

  async function landingUrl() {
    const base=window.WIZZCENTRAL_CONFIG?.STAFF_API_BASE_URL;
    if(!base)return getPostLoginUrl();
    const response=await fetch(base+'/staff/me',{headers:{Authorization:'Bearer '+readStorageItem('accessToken')}});
    if(!response.ok)throw Error('حساب الموظف غير متاح. تواصل مع مسؤول المنصة.');
    const profile=await response.json(),prefix=getPostLoginUrl().replace(/[^/]+$/,'');
    if(profile.activationRequired)return prefix+'account-security.html';
    if(profile.employee.roles.includes('bootstrap_admin'))return getPostLoginUrl();
    if(profile.permissions.includes('staff.read'))return prefix+'staff.html';
    if(profile.permissions.includes('settings.read'))return prefix+'settings.html';
    if(profile.permissions.includes('finance.read'))return prefix+'finance.html';
    if(profile.permissions.includes('drivers.read'))return prefix+'drivers.html';
    return prefix+'account-security.html';
  }
  try {
    const isAuthed = readStorageItem('isAuthenticated') === 'true';
    const idToken = readStorageItem('idToken');
    if (isAuthed && idToken && window.Auth?._validIdToken(idToken)) {
      window.location.replace(await landingUrl());
      return; // Skip initialization if already logged in
    }
  } catch(_){}

  // User is not being auto-redirected -> show login UI
  try { document.body.style.visibility = 'visible'; } catch (_) {}

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
    try { document.body.style.visibility = 'visible'; } catch (_) {}
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

  let pendingMfa = null;
  function mfaChallenge(user, callbacks) {
    pendingMfa = {user, callbacks};
    document.getElementById('loginForm')?.classList.add('hidden');
    document.getElementById('newPasswordForm')?.classList.add('hidden');
    document.getElementById('mfaForm')?.classList.remove('hidden');
    showStatus('أدخل رمز تطبيق التحقق لإكمال تسجيل الدخول.', 'info');
  }
  document.getElementById('mfaForm')?.addEventListener('submit', event => {
    event.preventDefault();
    const code = document.getElementById('mfaCode').value.trim();
    if (!pendingMfa || !/^\d{6}$/.test(code)) { showStatus('أدخل رمزًا من ستة أرقام.', 'error'); return; }
    const button = document.getElementById('mfaSubmit');
    button.disabled = true;
    const {user, callbacks} = pendingMfa;
    user.sendMFACode(code, {
      ...callbacks,
      onSuccess(result) { pendingMfa = null; document.getElementById('mfaCode').value = ''; callbacks.onSuccess(result); },
      onFailure(error) { button.disabled = false; showStatus('رمز التحقق غير صحيح أو انتهت صلاحيته. أعد المحاولة.', 'error'); }
    }, 'SOFTWARE_TOKEN_MFA');
  });
  document.getElementById('mfaCancel')?.addEventListener('click', () => {
    pendingMfa?.user.signOut(); pendingMfa = null;
    document.getElementById('mfaCode').value = '';
    document.getElementById('mfaSubmit').disabled = false;
    document.getElementById('mfaForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
    const button = document.getElementById('loginBtn'); button.disabled = false; button.textContent = 'Sign In';
    delete window.pendingPasswordChange;
    showStatus('', 'info');
  });

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
      const password = passwordEl.value;
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
            writeStorageItem('accessToken', accessToken);
            writeStorageItem('idToken', idToken);
            writeStorageItem('refreshToken', refreshToken);
            writeStorageItem('userEmail', email);
            writeStorageItem('isAuthenticated', 'true');
            writeStorageItem('lastLoginTime', Date.now().toString());
            showStatus('✅ Login successful! Redirecting...', 'success');
            setTimeout(async () => {
              let landing;try{landing=await landingUrl();}catch(error){showStatus(error.message,'error');loginBtn.disabled=false;return;}
              const returnUrl = readStorageItem('returnUrl');
              if (returnUrl && !landing.endsWith('/account-security.html')) { removeStorageItem('returnUrl'); window.location.href = returnUrl; }
              else { window.location.href = landing; }
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
          totpRequired: function() { mfaChallenge(cognitoUser, this); },
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
      const newPassword = newPasswordEl.value;
      const confirmPassword = confirmPasswordEl.value;
      if (newPassword !== confirmPassword) { showStatus('❌ Passwords do not match', 'error'); return; }
      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
      if (!passwordRegex.test(newPassword)) { showStatus('❌ Password must meet complexity requirements', 'error'); return; }
      btn.disabled = true; btn.textContent = 'Changing Password...'; showStatus('Changing password...', 'info');
      try {
        const pending = window.pendingPasswordChange;
        if (!pending) { showStatus('❌ Password change context missing', 'error'); btn.disabled = false; btn.textContent = 'Change Password'; return; }
        const { cognitoUser, userAttributes } = pending;
        const userEmail = userAttributes.email;
        delete userAttributes.email_verified; delete userAttributes.email;
        cognitoUser.completeNewPasswordChallenge(newPassword, userAttributes, {
          totpRequired: function() { mfaChallenge(cognitoUser, this); },
          onSuccess: function(result) {
            log('✅ Password changed successfully!', 'success');
            writeStorageItem('accessToken', result.getAccessToken().getJwtToken());
            writeStorageItem('idToken', result.getIdToken().getJwtToken());
            writeStorageItem('refreshToken', result.getRefreshToken().getToken());
            writeStorageItem('userEmail', userEmail);
            writeStorageItem('isAuthenticated', 'true');
            writeStorageItem('lastLoginTime', Date.now().toString());
            showStatus('✅ Password changed! Redirecting to dashboard...', 'success');
            delete window.pendingPasswordChange;
            setTimeout(async () => {try{window.location.href=await landingUrl();}catch(error){showStatus(error.message,'error');}}, 1500);
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
