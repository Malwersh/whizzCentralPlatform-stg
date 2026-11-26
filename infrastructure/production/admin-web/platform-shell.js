'use strict';

const logoutButton = document.querySelector('.platform-logout');
logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  await window.Auth.logout();
});
