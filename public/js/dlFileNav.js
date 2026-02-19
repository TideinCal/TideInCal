async function refreshNavUser() {
  const navLoginBtn = document.getElementById('navLoginBtn');
  const navLogoutBtn = document.getElementById('navLogoutBtn');
  const navAccountLink = document.getElementById('navAccountLink');
  const navUserGreeting = document.getElementById('navUserGreeting');
  const navUserName = document.getElementById('navUserName');
  const menuLoginBtn = document.getElementById('menuLoginBtn');
  const menuLogoutContainer = document.getElementById('menuLogoutContainer');
  const menuAccountLink = document.getElementById('menuAccountLink');
  const menuUserName = document.getElementById('menuUserName');

  try {
    const response = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
    if (response.ok) {
      const { user } = await response.json();
      const displayName = user?.firstName || user?.email?.split('@')[0] || 'there';

      navLoginBtn?.classList.add('d-none');
      if (navAccountLink) navAccountLink.style.display = 'block';
      if (navLogoutBtn) navLogoutBtn.style.display = 'block';
      if (navUserGreeting) navUserGreeting.style.display = 'block';
      if (navUserName) navUserName.textContent = displayName;

      if (menuLoginBtn) menuLoginBtn.style.display = 'none';
      if (menuAccountLink) menuAccountLink.style.display = 'block';
      if (menuLogoutContainer) menuLogoutContainer.style.display = 'flex';
      if (menuUserName) menuUserName.textContent = displayName;
      return;
    }
  } catch (error) {
    console.warn('Nav auth check failed:', error);
  }

  // Not logged in
  navLoginBtn?.classList.remove('d-none');
  if (navAccountLink) navAccountLink.style.display = 'none';
  if (navLogoutBtn) navLogoutBtn.style.display = 'none';
  if (navUserGreeting) navUserGreeting.style.display = 'none';

  if (menuLoginBtn) menuLoginBtn.style.display = 'block';
  if (menuAccountLink) menuAccountLink.style.display = 'none';
  if (menuLogoutContainer) menuLogoutContainer.style.display = 'none';
}

async function logoutNav() {
  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    });
    if (response.ok) {
      window.location.href = '/';
      return;
    }
  } catch (error) {
    console.error('Logout failed:', error);
  }
  showNavBanner('Logout failed. Please try again.');
}

function showNavBanner(message) {
  const banner = document.getElementById('navBanner');
  const bannerMessage = document.getElementById('navBannerMessage');
  if (!banner || !bannerMessage) return;
  bannerMessage.textContent = message;
  banner.classList.remove('d-none');
  banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideNavBanner() {
  const banner = document.getElementById('navBanner');
  if (!banner) return;
  banner.classList.add('d-none');
}

document.getElementById('navLoginBtn')?.addEventListener('click', () => {
  window.location.href = '/';
});
document.getElementById('menuLoginBtn')?.addEventListener('click', () => {
  window.location.href = '/';
});
document.getElementById('navLogoutBtn')?.addEventListener('click', logoutNav);
document.getElementById('menuLogoutBtn')?.addEventListener('click', logoutNav);
document.getElementById('navBannerDismiss')?.addEventListener('click', hideNavBanner);

function scheduleNavRefresh() {
  refreshNavUser();
  // Retry shortly in case session store is still warming up
  setTimeout(refreshNavUser, 800);
  setTimeout(refreshNavUser, 2500);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshNavUser();
  }
});
window.addEventListener('focus', refreshNavUser);

scheduleNavRefresh();
