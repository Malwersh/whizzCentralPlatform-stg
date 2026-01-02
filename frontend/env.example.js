// Example runtime env injection for local testing.
//
// In Amplify Hosting, `frontend/env.js` is generated during build from Amplify environment variables
// (see `amplify.yml`). For local testing, copy this file to `frontend/env.js` and fill values.

(function () {
  'use strict';

  window.__STAGE__ = 'staging';

  window.__API_BASE_URL__ = '';
  window.__PUSH_NOTIFICATION_API_URL__ = '';
  window.__AI_API_ENDPOINT__ = '';

  window.__AMAZON_CONNECT_API_BASE_URL__ = '';
  window.__AMAZON_CONNECT_WS_URL__ = '';

  window.__LIVE_CHAT_WEBSOCKET_URL__ = '';

  window.__COGNITO_REGION__ = 'us-east-1';
  window.__COGNITO_USER_POOL_ID__ = '';
  window.__COGNITO_CLIENT_ID__ = '';
  window.__COGNITO_IDENTITY_POOL_ID__ = '';

  window.__CAMPAIGNS_API_BASE_URL__ = '';
})();
