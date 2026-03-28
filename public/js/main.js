// Define the custom icon for tide stations
const tideIcon = L.icon({
  iconUrl: '/img/tideStations.png',
  iconSize: [55, 65],
  iconAnchor: [22, 50],
  clickable: true,
  title: 'Tide Station',
  zIndexOffset: 0,
  riseOnHover: true,
  riseOffset: 250,
});

// Define the custom icon for the user location
const myIcon = L.icon({
  iconUrl: '/img/homeIcon.png',
  iconSize: [55, 65],
  iconAnchor: [22, 50],
  clickable: true,
  title: 'Current Location',
  zIndexOffset: 1000,
  riseOnHover: true,
  riseOffset: 500,
});

let csrfToken = null;

async function getCsrfToken() {
  if (csrfToken) return csrfToken;
  const response = await fetch('/api/csrf', { credentials: 'include' });
  if (!response.ok) {
    throw new Error('Unable to fetch CSRF token');
  }
  const data = await response.json();
  csrfToken = data.csrfToken;
  return csrfToken;
}

async function refreshAuthUI() {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    let user = null;

    if (r.ok) {
      const data = await r.json();
      user = data.user;
    }

                const navLoginBtn    = document.getElementById('navLoginBtn');
                const navLogoutBtn   = document.getElementById('navLogoutBtn');
                const navAccountLink = document.getElementById('navAccountLink');
                const navUserGreeting = document.getElementById('navUserGreeting');
                const navUserName    = document.getElementById('navUserName');
                const menuLoginBtn   = document.getElementById('menuLoginBtn');
                const menuLogoutBtn  = document.getElementById('menuLogoutBtn');
                const menuLogoutContainer = document.getElementById('menuLogoutContainer');
                const menuAccountLink= document.getElementById('menuAccountLink');
                const menuUserName = document.getElementById('menuUserName');

                if (user) {
                  // User is logged in - hide login, show logout and greeting
                  // Desktop navigation
                  navLoginBtn?.classList.add('d-none');
                  if (navAccountLink) navAccountLink.style.display = 'block';
                  if (navLogoutBtn) navLogoutBtn.style.display = 'block';
                  if (navUserGreeting) navUserGreeting.style.display = 'block';
                  if (navUserName) {
                    const displayName = user.firstName || user.email.split('@')[0];
                    navUserName.textContent = displayName;
                  }

                  // Mobile navigation
                  if (menuLoginBtn) menuLoginBtn.style.display = 'none';
                  if (menuLogoutContainer) {
                    menuLogoutContainer.style.display = 'flex';
                    menuLogoutContainer.classList.add('show');
                  }
                  if (menuAccountLink) menuAccountLink.style.display = 'block';
                  if (menuUserName) {
                    const displayName = user.firstName || user.email.split('@')[0];
                    menuUserName.textContent = displayName;
                  }
                } else {
                  // User is not logged in - show login, hide logout and greeting
                  // Desktop navigation
                  navLoginBtn?.classList.remove('d-none');
                  if (navAccountLink) navAccountLink.style.display = 'none';
                  if (navLogoutBtn) navLogoutBtn.style.display = 'none';
                  if (navUserGreeting) navUserGreeting.style.display = 'none';

                  // Mobile navigation
                  if (menuLoginBtn) menuLoginBtn.style.display = 'block';
                  if (menuLogoutContainer) {
                    menuLogoutContainer.style.display = 'none';
                    menuLogoutContainer.classList.remove('show');
                  }
                  if (menuAccountLink) menuAccountLink.style.display = 'none';
                }
  } catch (e) {
    console.warn('[refreshAuthUI] Auth state check failed:', e);
                // On error, assume not logged in
                const navLoginBtn    = document.getElementById('navLoginBtn');
                const navLogoutBtn   = document.getElementById('navLogoutBtn');
                const navAccountLink = document.getElementById('navAccountLink');
                const navUserGreeting = document.getElementById('navUserGreeting');
                const menuLoginBtn   = document.getElementById('menuLoginBtn');
                const menuLogoutContainer = document.getElementById('menuLogoutContainer');
                const menuAccountLink= document.getElementById('menuAccountLink');

                // Desktop navigation
                navLoginBtn?.classList.remove('d-none');
                if (navAccountLink) navAccountLink.style.display = 'none';
                if (navLogoutBtn) navLogoutBtn.style.display = 'none';
                if (navUserGreeting) navUserGreeting.style.display = 'none';

                // Mobile navigation
                if (menuLoginBtn) menuLoginBtn.style.display = 'block';
                if (menuLogoutContainer) {
                  menuLogoutContainer.style.display = 'none';
                  menuLogoutContainer.classList.remove('show');
                }
                if (menuAccountLink) menuAccountLink.style.display = 'none';
  }
}

// Auth modal functions
function openAuthModal(mode = 'signup') {
  const modal = document.getElementById('authModal');
  if (!modal) {
    console.error('Auth modal not found');
    return;
  }

  // Set active tab
  const loginTab = document.getElementById('loginTab');
  const signupTab = document.getElementById('signupTab');
  const loginPane = document.getElementById('loginPane');
  const signupPane = document.getElementById('signupPane');

  if (mode === 'login') {
    loginTab.classList.add('active');
    signupTab.classList.remove('active');
    loginPane.classList.add('active', 'show');
    signupPane.classList.remove('active', 'show');
  } else {
    signupTab.classList.add('active');
    loginTab.classList.remove('active');
    signupPane.classList.add('active', 'show');
    loginPane.classList.remove('active', 'show');
  }

  resetForgotPasswordUI();

  // Show modal
  if (window.bootstrap?.Modal) {
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
  } else {
    modal.style.display = 'block';
    modal.classList.add('show');
  }
}

function resetForgotPasswordUI() {
  const loginForm = document.getElementById('loginForm');
  const forgotForm = document.getElementById('forgotPasswordForm');
  const message = document.getElementById('forgotPasswordMessage');

  if (loginForm) loginForm.classList.remove('d-none');
  if (forgotForm) forgotForm.classList.add('d-none');
  if (message) {
    message.classList.add('d-none');
    message.textContent = '';
  }
}

async function handleAuth(formData, isSignup = false) {
  try {
    const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
      credentials: 'include'
    });

    if (!response.ok) {
      let errorMessage = 'Authentication failed';

      if (response.status === 429) {
        errorMessage = 'Too many requests. Please wait a moment and try again.';
      } else {
        try {
          const error = await response.json();
          errorMessage = error.error || 'Authentication failed';
        } catch (e) {
          errorMessage = `Server error (${response.status})`;
        }
      }

      throw new Error(errorMessage);
    }

    const { user } = await response.json();

    // New session: clear cached CSRF so logout/checkout get a token for this session
    csrfToken = null;

    // Close modal: move focus out first to avoid aria-hidden + focused descendant
    const modal = document.getElementById('authModal');
    if (modal?.contains(document.activeElement)) {
      document.activeElement?.blur();
      document.body.focus();
    }
    if (window.bootstrap?.Modal) {
      const bsModal = bootstrap.Modal.getInstance(modal);
      bsModal?.hide();
    } else if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('show');
    }

    // Refresh auth UI
    refreshAuthUI();

    // If we have pending station context, show plan chooser
    if (pendingStationContext) {
      setTimeout(() => {
        openPlanModal();
      }, 300); // Small delay to ensure modal closes properly
    }

    return true;
  } catch (error) {
    console.error('Authentication error:', error);
    setVerificationBannerState({
      title: 'Unable to sign in',
      message: error.message || 'Please try again.',
      variant: 'danger',
      showResend: false,
      showContinue: false,
      showSelectLink: false,
      showDismiss: true
    });
    return false;
  }
}

// click handlers
document.getElementById('navLoginBtn')?.addEventListener('click', () => openAuthModal('login'));
document.getElementById('menuLoginBtn')?.addEventListener('click', () => openAuthModal('login'));

// Desktop logout button
document.getElementById('navLogoutBtn')?.addEventListener('click', async () => {
  const token = await getCsrfToken();
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': token }
  });
  csrfToken = null;
  refreshAuthUI();
});

// Mobile logout button
document.getElementById('menuLogoutBtn')?.addEventListener('click', async () => {
  const token = await getCsrfToken();
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': token }
  });
  csrfToken = null;
  refreshAuthUI();
});

// Auth form handlers
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = {
    email: formData.get('email'),
    password: formData.get('password')
  };
  await handleAuth(data, false);
});

function attachPasswordToggles(root = document) {
  const toggleButtons = root.querySelectorAll('[data-password-toggle]');
  toggleButtons.forEach((btn) => {
    const targetId = btn.getAttribute('data-target');
    if (!targetId) return;
    const input = document.getElementById(targetId);
    if (!input) return;
    btn.addEventListener('click', () => {
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      const icon = btn.querySelector('i');
      if (icon) {
        icon.classList.toggle('bi-eye', !isHidden);
        icon.classList.toggle('bi-eye-slash', isHidden);
      }
      btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    });
  });
}

const forgotPasswordLink = document.getElementById('forgotPasswordLink');
const forgotPasswordForm = document.getElementById('forgotPasswordForm');
const forgotPasswordBack = document.getElementById('forgotPasswordBack');
const forgotPasswordMessage = document.getElementById('forgotPasswordMessage');
const loginForm = document.getElementById('loginForm');

const setForgotState = (show) => {
  if (loginForm) loginForm.classList.toggle('d-none', show);
  if (forgotPasswordForm) forgotPasswordForm.classList.toggle('d-none', !show);
  if (forgotPasswordMessage) {
    forgotPasswordMessage.classList.add('d-none');
    forgotPasswordMessage.textContent = '';
  }
};

forgotPasswordLink?.addEventListener('click', () => setForgotState(true));
forgotPasswordBack?.addEventListener('click', () => setForgotState(false));

forgotPasswordForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const email = formData.get('email');

  try {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email })
    });

    let message = 'If that email exists, we sent a reset link.';
    if (!response.ok) {
      try {
        const data = await response.json();
        message = data.error || message;
      } catch (e) {
        message = `Unable to send reset link (${response.status}).`;
      }
    }

    if (forgotPasswordMessage) {
      forgotPasswordMessage.textContent = message;
      forgotPasswordMessage.classList.remove('d-none');
    }
  } catch (error) {
    if (forgotPasswordMessage) {
      forgotPasswordMessage.textContent = 'Unable to send reset link. Please try again.';
      forgotPasswordMessage.classList.remove('d-none');
    }
  }
});

document.getElementById('signupForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = {
    email: formData.get('email'),
    password: formData.get('password'),
    firstName: formData.get('firstName') || undefined,
    lastName: formData.get('lastName') || undefined
  };
  await handleAuth(data, true);
});

// initial paint
document.addEventListener('DOMContentLoaded', refreshAuthUI);
document.addEventListener('DOMContentLoaded', () => attachPasswordToggles());
document.addEventListener('DOMContentLoaded', maybeResumeCheckoutAfterVerification);
document.addEventListener('DOMContentLoaded', () => {
  const resendBtn = document.getElementById('verificationResendBtn');
  const continueBtn = document.getElementById('verificationContinueBtn');
  const dismissBtn = document.getElementById('verificationDismissBtn');

  resendBtn?.addEventListener('click', async () => {
    try {
      await resendVerificationEmail();
      setVerificationBannerState({
        title: 'Verification email sent',
        message: 'Please check your inbox for the verification link.',
        variant: 'success',
        showResend: false,
        showContinue: true,
        showSelectLink: false,
        showDismiss: true
      });
    } catch (error) {
      console.error('[checkout] Resend verification error:', error);
      setVerificationBannerState({
        title: 'Unable to resend email',
        message: error.message || 'Please try again later.',
        variant: 'danger',
        showResend: true,
        showContinue: true,
        showSelectLink: false,
        showDismiss: true
      });
    }
  });

  continueBtn?.addEventListener('click', () => {
    attemptResumeCheckout();
  });

  dismissBtn?.addEventListener('click', () => {
    hideVerificationBanner();
  });
});

// Offcanvas: close on click; smooth-scroll to anchors AFTER it closes
window.addEventListener('DOMContentLoaded', () => {
  const offcanvasEl = document.getElementById('mainOffcanvas');
  if (!offcanvasEl) return;

  const NAV_OFFSET = 56; // your fixed navbar height

  // 1) Force-close on any link/button inside the offcanvas
  offcanvasEl.addEventListener('click', (e) => {
    const item = e.target.closest('a,button');
    if (!item) return;

    // If it's a hash link, we'll handle scroll below.
    const href = item.getAttribute('href') || '';
    const isHash = href.startsWith('#');
    console.log('[offcanvas] Clicked:', href, 'isHash:', isHash, 'target:', item);

    // For non-hash links (like /account), navigate explicitly
    if (!isHash && href && href !== '') {
      console.log('[offcanvas] Non-hash link detected, navigating to:', href);
      e.preventDefault(); // Prevent any default behavior
      e.stopPropagation(); // Stop event bubbling

      // Close offcanvas first, then navigate
      const hideAndNavigate = () => {
        if (window.bootstrap?.Offcanvas) {
          const oc = bootstrap.Offcanvas.getInstance(offcanvasEl) || new bootstrap.Offcanvas(offcanvasEl);
          offcanvasEl.addEventListener('hidden.bs.offcanvas', () => {
            window.location.href = href;
          }, { once: true });
          oc.hide();
        } else {
          offcanvasEl.classList.remove('show');
          window.location.href = href;
        }
      };

      hideAndNavigate();
      return;
    }

    // Use Bootstrap API if available; otherwise fall back to removing classes
    const hideOffcanvas = () => {
      if (window.bootstrap?.Offcanvas) {
        const oc = bootstrap.Offcanvas.getInstance(offcanvasEl) || new bootstrap.Offcanvas(offcanvasEl);
        oc.hide();
      } else {
        offcanvasEl.classList.remove('show');
        document.body.classList.remove('offcanvas-backdrop'); // best-effort fallback
      }
    };

    // If it’s a hash link, we prevent default and scroll after hidden
    if (isHash) {
      e.preventDefault();
      const id = href.slice(1);
      const target = document.getElementById(id);
      if (!target) { hideOffcanvas(); return; }

      const onHidden = () => {
        offcanvasEl.removeEventListener('hidden.bs.offcanvas', onHidden);
        const y = target.getBoundingClientRect().top + window.pageYOffset - NAV_OFFSET;
        window.scrollTo({ top: y, behavior: 'smooth' });
      };

      offcanvasEl.addEventListener('hidden.bs.offcanvas', onHidden);
      hideOffcanvas();
      return;
    }

    // For buttons without href (like logout), just close the offcanvas
    hideOffcanvas();
  });
});



// Declare the map variable at a global scope so it’s accessible throughout the file
let map;

// Entitlements cache (used to show Pro-only UI like Golden Hour checkbox on tide popup)
let isUnlimitedProUser = false;
(async function initEntitlementsForMap() {
  try {
    const res = await fetch('/api/auth/me/entitlements', { credentials: 'include' });
    if (res.ok) {
      const { unlimited } = await res.json();
      isUnlimitedProUser = !!unlimited;
    }
  } catch (e) {
    // Ignore; non-auth users simply won't see Pro-only UI
  }
})();

// Dynamically load the popup once a tide icon is selected (bootstrap Card)
const renderModalContent = (title, id, region, lat, lon, type) => {
  localStorage.setItem('region', region);
  localStorage.setItem('stationTitle', title);
  localStorage.setItem('stationID', id);
  localStorage.setItem('latitude', lat);
  localStorage.setItem('longitude', lon);

  return `
     <div class="card">
      <div class="card-body">
        <p class="card-label">Tide Station:</p>
        <h2 class="fw-bolder" id="title">${title}</h2>
        <h6 class="card-text">
          Select "Download File" to get 1 Year Of Tide Data To Your Calendar from this station
        </h6>
        <button class="btn download-btn" onclick="handleDownloadClick('${id}', '${title.replace(/'/g, "\\'")}', '${region}')">
          <img src="/img/whiteLogo.png" alt="calendar icon">Download File
        </button>
        <div class="mt-3 d-none" id="proGoldenWrap-${id}">
          <div class="form-check d-flex align-items-center justify-content-center gap-2">
            <input class="form-check-input pro-golden-checkbox" type="checkbox" id="proGoldenCheckbox-${id}">
            <label class="form-check-label mb-0" for="proGoldenCheckbox-${id}">
              Add Golden Hour To This Location
            </label>
          </div>
        </div>
      </div>
    </div>`;
};

// Handle download button click
// Global variables to store station context for plan chooser
let pendingStationContext = null;
/** 'tide' | 'golden_only' - whether planModal was opened from a tide station or a Golden Hour–only location */
let pendingContextType = 'tide';
/** For Golden Hour–only flow: { lat, lng, label }. Set when opening from search marker or current location. */
let pendingGoldenLocation = null;
/** Last clicked tide station coords so we can add them to pendingStationContext (for tide+golden). */
let lastClickedStationLatLon = null;

/** User timezone for Golden Hour (and other) flows. Prefer real timezone; fallback UTC. */
function getUserTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === 'string') return tz;
  } catch (e) {}
  return 'UTC';
}

const PENDING_CHECKOUT_KEY = 'pendingCheckout';
const EMAIL_VERIFIED_FLAG = 'emailVerifiedJustNow';

function setVerificationBannerState({
  title,
  message,
  variant = 'info',
  showResend = true,
  showContinue = true,
  showSelectLink = false,
  showDismiss = true
}) {
  const banner = document.getElementById('verificationBanner');
  if (!banner) return;

  const titleEl = document.getElementById('verificationBannerTitle');
  const messageEl = document.getElementById('verificationBannerMessage');
  const resendBtn = document.getElementById('verificationResendBtn');
  const continueBtn = document.getElementById('verificationContinueBtn');
  const selectLink = document.getElementById('verificationSelectLink');
  const dismissBtn = document.getElementById('verificationDismissBtn');

  if (titleEl && title) titleEl.textContent = title;
  if (messageEl && message) messageEl.textContent = message;

  if (resendBtn) resendBtn.classList.toggle('d-none', !showResend);
  if (continueBtn) continueBtn.classList.toggle('d-none', !showContinue);
  if (selectLink) selectLink.classList.toggle('d-none', !showSelectLink);
  if (dismissBtn) dismissBtn.classList.toggle('d-none', !showDismiss);

  banner.classList.remove('alert-info', 'alert-warning', 'alert-danger', 'alert-success');
  banner.classList.add(`alert-${variant}`);
  banner.classList.remove('d-none');
}

function hideVerificationBanner() {
  const banner = document.getElementById('verificationBanner');
  if (!banner) return;
  banner.classList.add('d-none');
}

function storePendingCheckout(data) {
  try {
    localStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify({
      ...data,
      createdAt: Date.now()
    }));
  } catch (error) {
    console.warn('[checkout] Unable to store pending checkout:', error);
  }
}

function readPendingCheckout() {
  try {
    const raw = localStorage.getItem(PENDING_CHECKOUT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('[checkout] Unable to read pending checkout:', error);
    return null;
  }
}

function clearPendingCheckout() {
  try {
    localStorage.removeItem(PENDING_CHECKOUT_KEY);
  } catch (error) {
    console.warn('[checkout] Unable to clear pending checkout:', error);
  }
}

async function resendVerificationEmail() {
  const response = await fetch('/api/auth/resend-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({})
  });

  if (!response.ok) {
    let errorMessage = 'Failed to resend verification email.';
    try {
      const error = await response.json();
      errorMessage = error.error || errorMessage;
    } catch (e) {
      errorMessage = `Failed to resend verification email (${response.status}).`;
    }
    throw new Error(errorMessage);
  }
}

async function handleVerificationRequired(checkoutData) {
  storePendingCheckout(checkoutData);

  setVerificationBannerState({
    title: 'Email verification required',
    message: 'Please verify your email before checking out. Check your inbox for the verification link.',
    variant: 'warning',
    showResend: true,
    showContinue: true,
    showSelectLink: false,
    showDismiss: true
  });
}

async function startCheckoutSession(checkoutData) {
  const token = await getCsrfToken();
  const response = await fetch('/api/checkout/session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token
    },
    body: JSON.stringify(checkoutData),
    credentials: 'include'
  });

  let responseData = null;
  if (!response.ok) {
    try {
      responseData = await response.json();
    } catch (e) {
      responseData = null;
    }

    if (response.status === 403 && responseData?.needsVerification) {
      setCheckoutButtonsLoading(false);
      await handleVerificationRequired(checkoutData);
      return;
    }

    throw new Error(responseData?.error || 'Failed to create checkout session');
  }

  responseData = responseData || await response.json();

  if (responseData.success && responseData.message?.includes('Free download')) {
    clearPendingCheckout();
    window.location.href = '/account';
    return;
  }

  const { url } = responseData;
  if (url) {
    clearPendingCheckout();
    window.location.href = url;
    return;
  }

  throw new Error('No checkout URL received');
}

async function maybeResumeCheckoutAfterVerification() {
  const verifiedFlag = localStorage.getItem(EMAIL_VERIFIED_FLAG);
  if (!verifiedFlag) return;
  localStorage.removeItem(EMAIL_VERIFIED_FLAG);

  let user = null;
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    if (response.ok) {
      const data = await response.json();
      user = data.user;
    }
  } catch (error) {
    console.warn('[checkout] Unable to confirm verification status:', error);
  }

  if (!user?.emailVerifiedAt) {
    return;
  }

  const pending = readPendingCheckout();
  if (!pending) {
    setVerificationBannerState({
      title: 'Email verified',
      message: 'Please select your location again to continue checkout.',
      variant: 'warning',
      showResend: false,
      showContinue: false,
      showSelectLink: true,
      showDismiss: true
    });
    return;
  }

  setVerificationBannerState({
    title: 'Email verified',
    message: 'Continue to checkout when you are ready.',
    variant: 'success',
    showResend: false,
    showContinue: true,
    showSelectLink: false,
    showDismiss: true
  });
}

async function attemptResumeCheckout() {
  const pending = readPendingCheckout();
  if (!pending) {
    setVerificationBannerState({
      title: 'Email verified',
      message: 'Please select your location again to continue checkout.',
      variant: 'warning',
      showResend: false,
      showContinue: false,
      showSelectLink: true,
      showDismiss: true
    });
    return;
  }

  let user = null;
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    if (response.ok) {
      const data = await response.json();
      user = data.user;
    }
  } catch (error) {
    console.warn('[checkout] Unable to confirm verification status:', error);
  }

  if (!user?.emailVerifiedAt) {
    setVerificationBannerState({
      title: 'Email not verified yet',
      message: 'Please verify your email before continuing checkout.',
      variant: 'warning',
      showResend: true,
      showContinue: false,
      showSelectLink: false,
      showDismiss: true
    });
    return;
  }

  try {
    await startCheckoutSession(pending);
  } catch (error) {
    console.error('[checkout] Resume checkout error:', error);
    setVerificationBannerState({
      title: 'Unable to continue checkout',
      message: error.message || 'Please try again in a moment.',
      variant: 'danger',
      showResend: false,
      showContinue: true,
      showSelectLink: false,
      showDismiss: true
    });
  }
}

async function handleDownloadClick(stationID, stationTitle, country) {
  try {
    pendingContextType = 'tide';
    pendingGoldenLocation = null;
    pendingStationContext = {
      stationID,
      stationTitle,
      country,
      lat: lastClickedStationLatLon?.lat,
      lon: lastClickedStationLatLon?.lon
    };

    // Check if user is authenticated
    const authResponse = await fetch('/api/auth/me', { credentials: 'include' });

    if (authResponse.status === 429) {
      setVerificationBannerState({
        title: 'Too many requests',
        message: 'Please wait a moment and try again.',
        variant: 'warning',
        showResend: false,
        showContinue: false,
        showSelectLink: false,
        showDismiss: true
      });
      return;
    }
    if (!authResponse.ok) {
      // User not authenticated, show auth modal
      openAuthModal('signup');
      return;
    }

    const { user } = await authResponse.json();

    if (!user) {
      // User not authenticated, show auth modal
      openAuthModal('signup');
      return;
    }

    // Check entitlements to see if user is Pro (unlimited)
    try {
      const entRes = await fetch('/api/auth/me/entitlements', { credentials: 'include' });
      if (entRes.ok) {
        const { unlimited } = await entRes.json();
        isUnlimitedProUser = !!unlimited;
        if (unlimited) {
          // For Pro users, use tide -> dlFile flow directly, with optional Golden Hour add-on for this station
          const checkbox = document.getElementById(`proGoldenCheckbox-${stationID}`);
          const includeGoldenHour = checkbox?.checked === true;
          const params = new URLSearchParams({
            stationID,
            stationTitle,
            country
          });
          if (includeGoldenHour && lastClickedStationLatLon) {
            params.set('includeGoldenHour', 'true');
            params.set('goldenLat', String(lastClickedStationLatLon.lat));
            params.set('goldenLng', String(lastClickedStationLatLon.lon));
            params.set('goldenLocationName', stationTitle);
          }
          window.location.href = `/dlFile.html?${params.toString()}`;
          return;
        }
      }
    } catch (e) {
      console.warn('Failed to read user entitlements for tide download:', e);
    }

    // Non-Pro users: show plan chooser as before
    openPlanModal();

  } catch (error) {
    console.error('Download error:', error);
    setVerificationBannerState({
      title: 'Checkout unavailable',
      message: 'Failed to start checkout process. Please try again.',
      variant: 'danger',
      showResend: false,
      showContinue: false,
      showSelectLink: false,
      showDismiss: true
    });
  }
}

// Make handleDownloadClick globally available
window.handleDownloadClick = handleDownloadClick;

/** Golden Hour search marker: one at a time, state for lat/lng/label */
let goldenSearchMarker = null;
let goldenSearchLocation = null;

/** Called when user clicks "Create Golden Hour Calendar" on the Golden Hour search marker. Opens planModal (or Pro direct download). */
async function handleGoldenHourLocationClick() {
  if (!goldenSearchLocation) return;
  const customLabel = document.getElementById('goldenSearchLabel')?.value?.trim() || goldenSearchLocation.label;
  pendingGoldenLocation = { ...goldenSearchLocation, label: customLabel };
  pendingContextType = 'golden_only';
  pendingStationContext = null;
  const authResponse = await fetch('/api/auth/me', { credentials: 'include' });
  if (!authResponse.ok) {
    openAuthModal('signup');
    return;
  }
  const { user } = await authResponse.json();
  if (!user) {
    openAuthModal('signup');
    return;
  }
  openPlanModal();
}
window.handleGoldenHourLocationClick = handleGoldenHourLocationClick;

// Pro: generate Golden Hour for current context (search marker or current location) and download
async function generateGoldenHourProAndDownload() {
  if (!pendingGoldenLocation) return;
  const { lat, lng, label } = pendingGoldenLocation;
  try {
    const token = await getCsrfToken();
    const res = await fetch('/api/downloads/golden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      credentials: 'include',
      body: JSON.stringify({ lat, lng, locationName: label || 'Location', userTimezone: getUserTimezone() })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || 'Failed to generate Golden Hour');
    }
    const blob = await res.blob();
    const filename = res.headers.get('Content-Disposition')?.match(/filename="?([^"]+)"?/)?.[1] || 'golden-hour.ics';
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Golden Hour generation error:', e);
    setVerificationBannerState({
      title: 'Golden Hour unavailable',
      message: e.message || 'Failed to generate Golden Hour calendar. Please try again.',
      variant: 'danger',
      showResend: false,
      showContinue: false,
      showSelectLink: false,
      showDismiss: true
    });
  }
}

// Plan chooser modal functions
async function openPlanModal() {
  setCheckoutButtonsLoading(false);
  try {
    const response = await fetch('/api/auth/me/entitlements', { credentials: 'include' });
    if (response.ok) {
      const { unlimited, oneTimePurchases } = await response.json();

      if (unlimited) {
        if (pendingGoldenLocation) {
          await generateGoldenHourProAndDownload();
          return;
        }
        if (!pendingStationContext) {
          console.error('Station context missing for unlimited download');
          return;
        }
        const { stationID, stationTitle, country } = pendingStationContext;
        const params = new URLSearchParams({
          stationID,
          stationTitle,
          country
        });
        window.location.href = `/dlFile.html?${params.toString()}`;
        return;
      }

      // Show upsell on 2nd, 3rd, … purchase attempt (when user has 1+ one-time purchases, no subscription)
      const purchaseCount = oneTimePurchases ? oneTimePurchases.length : 0;
      if (purchaseCount >= 1) {
        // Show upsell modal
        const upsellModal = document.getElementById('upsellModal');
        if (upsellModal) {
          // Calculate savings (limited-time offer price shown in upsell)
          const totalSpent = purchaseCount * 5; // $5 per purchase
          const offerPrice = 19.99; // $19.99 while countdown is active
          const savings = totalSpent - offerPrice;
          const stationWord = purchaseCount === 1 ? 'station' : 'stations';

          // Store for timer-end update (savings text switches to $24.99)
          upsellModal.dataset.purchaseCount = String(purchaseCount);
          upsellModal.dataset.totalSpent = String(totalSpent);

          // Update upsell modal content
          const savingsText = document.getElementById('upsellSavings');
          if (savingsText) {
            savingsText.textContent = `You've spent $${Number(totalSpent).toFixed(2)} on ${purchaseCount} ${stationWord}. Upgrade to Pro for $${Number(offerPrice).toFixed(2)} (save $${Math.abs(savings).toFixed(2)} more!)`;
          }

          if (window.bootstrap?.Modal) {
            const bsModal = new bootstrap.Modal(upsellModal);
            bsModal.show();
            startUpsellCountdown();
          } else {
            upsellModal.style.display = 'block';
            upsellModal.classList.add('show');
            startUpsellCountdown();
          }
          return;
        }
      }
    }

    // Regular plan chooser for non-unlimited users
    const modal = document.getElementById('planModal');
    if (!modal) {
      console.error('Plan modal not found');
      return;
    }

    if (window.bootstrap?.Modal) {
      const bsModal = new bootstrap.Modal(modal);
      bsModal.show();
    } else {
      modal.style.display = 'block';
      modal.classList.add('show');
    }
  } catch (error) {
    console.error('Error checking user entitlements:', error);
    // Fallback to regular plan modal
    const modal = document.getElementById('planModal');
    if (modal && window.bootstrap?.Modal) {
      const bsModal = new bootstrap.Modal(modal);
      bsModal.show();
    }
  }
}

function setCheckoutButtonsLoading(loading) {
  document.querySelectorAll('.js-checkout-trigger').forEach(btn => {
    if (loading) {
      btn.disabled = true;
      btn.dataset.originalText = btn.textContent;
      btn.textContent = 'Loading…';
    } else {
      btn.disabled = false;
      if (btn.dataset.originalText) {
        btn.textContent = btn.dataset.originalText;
        delete btn.dataset.originalText;
      }
    }
  });
}

function moveFocusOutOfModal(modal) {
  if (!modal || !modal.contains(document.activeElement)) return;
  document.activeElement?.blur();
  document.body.focus?.();
}

async function selectPlan(plan, fromUpsell = false, _triggerButton = null) {
  try {
    const includeMoon = document.getElementById('planIncludeMoon')?.checked === true;
    const includeGoldenHour = document.getElementById('planIncludeGoldenHour')?.checked === true;

    if (plan === 'single') {
      const isGoldenOnly = pendingContextType === 'golden_only' && pendingGoldenLocation;
      if (!isGoldenOnly && !pendingStationContext) {
        throw new Error('Select a tide station or a location for Golden Hour first.');
      }
      if (isGoldenOnly && !pendingGoldenLocation) {
        throw new Error('Select a location for Golden Hour first.');
      }
    }

    setCheckoutButtonsLoading(true);

    const userTimezone = getUserTimezone();
    const checkoutData = {
      plan: plan === 'unlimited' ? 'unlimited' : 'single',
      includeMoon: includeMoon,
      includeGoldenHour: includeGoldenHour,
      userTimezone: userTimezone
    };

    if (plan === 'single') {
      const isGoldenOnly = pendingContextType === 'golden_only' && pendingGoldenLocation;
      if (isGoldenOnly) {
        checkoutData.goldenOnly = true;
        checkoutData.goldenLat = pendingGoldenLocation.lat;
        checkoutData.goldenLng = pendingGoldenLocation.lng;
        checkoutData.goldenLocationName = pendingGoldenLocation.label || 'Location';
      } else {
        checkoutData.stationID = pendingStationContext.stationID;
        checkoutData.stationTitle = pendingStationContext.stationTitle;
        checkoutData.country = pendingStationContext.country;
        checkoutData.stationLat = pendingStationContext.lat;
        checkoutData.stationLng = pendingStationContext.lon;
        if (includeGoldenHour && pendingStationContext) {
          checkoutData.goldenLat = pendingStationContext.lat;
          checkoutData.goldenLng = pendingStationContext.lon;
          checkoutData.goldenLocationName = pendingStationContext.stationTitle || 'Location';
        }
      }
    }

    if (plan === 'unlimited' && fromUpsell && upsellOfferActive) {
      checkoutData.useProOffer = true;
    }
    // Close modals (move focus out first to avoid aria-hidden + focused descendant)
    const planModal = document.getElementById('planModal');
    const upsellModal = document.getElementById('upsellModal');
    moveFocusOutOfModal(planModal);
    moveFocusOutOfModal(upsellModal);

    if (planModal) {
      if (window.bootstrap?.Modal) {
        const bsModal = bootstrap.Modal.getInstance(planModal);
        bsModal?.hide();
      } else {
        planModal.style.display = 'none';
        planModal.classList.remove('show');
      }
    }
    if (upsellModal) {
      stopUpsellCountdown();
      if (window.bootstrap?.Modal) {
        const bsModal = bootstrap.Modal.getInstance(upsellModal);
        bsModal?.hide();
      } else {
        upsellModal.style.display = 'none';
        upsellModal.classList.remove('show');
      }
    }

    await startCheckoutSession(checkoutData);

  } catch (error) {
    console.error('Plan selection error:', error);
    const message = error?.message && error.message.includes('Too many requests')
      ? error.message
      : 'Failed to start checkout process. Please try again.';
    setVerificationBannerState({
      title: 'Checkout unavailable',
      message,
      variant: 'danger',
      showResend: false,
      showContinue: false,
      showSelectLink: false,
      showDismiss: true
    });
  } finally {
    setCheckoutButtonsLoading(false);
  }
}

// Upsell modal: 2-minute countdown
let upsellCountdownInterval = null;
let upsellOfferActive = false;

function startUpsellCountdown() {
  const el = document.getElementById('upsellCountdown');
  const wrap = document.getElementById('upsellCountdownWrap');
  const priceEl = document.getElementById('upsellModalPrice');
  if (!el) return;
  if (upsellCountdownInterval) clearInterval(upsellCountdownInterval);
  let secondsLeft = 2 * 60;

  // Show countdown block and set offer price when starting
  if (wrap) wrap.style.display = '';
  if (priceEl) priceEl.textContent = '$19.99';
  upsellOfferActive = true;

  function format(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  el.textContent = format(secondsLeft);
  upsellCountdownInterval = setInterval(function () {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      clearInterval(upsellCountdownInterval);
      upsellCountdownInterval = null;
      upsellOfferActive = false;
      // Hide countdown block and switch to full price
      if (wrap) wrap.style.display = 'none';
      if (priceEl) priceEl.textContent = '$24.99';
      // Update savings sentence to $24.99
      const upsellModal = document.getElementById('upsellModal');
      const savingsText = document.getElementById('upsellSavings');
      if (upsellModal && savingsText && upsellModal.dataset.purchaseCount !== undefined) {
        const purchaseCount = parseInt(upsellModal.dataset.purchaseCount, 10);
        const totalSpent = parseFloat(upsellModal.dataset.totalSpent) || purchaseCount * 5;
        const fullPrice = 24.99;
        const savings = totalSpent - fullPrice;
        const stationWord = purchaseCount === 1 ? 'station' : 'stations';
        savingsText.textContent = `You've spent $${Number(totalSpent).toFixed(2)} on ${purchaseCount} ${stationWord}. Upgrade to Pro for $${fullPrice.toFixed(2)} (save $${Math.abs(savings).toFixed(2)} more!)`;
      }
      return;
    }
    el.textContent = format(secondsLeft);
  }, 1000);
}

function stopUpsellCountdown() {
  upsellOfferActive = false;
  if (upsellCountdownInterval) {
    clearInterval(upsellCountdownInterval);
    upsellCountdownInterval = null;
  }
}

// Stop countdown when upsell modal is closed by X or backdrop
document.getElementById('upsellModal')?.addEventListener('hidden.bs.modal', stopUpsellCountdown);

// Close upsell modal and continue with one-time purchase
function closeUpsellAndContinue() {
  const upsellModal = document.getElementById('upsellModal');
  if (upsellModal) {
    stopUpsellCountdown();
    moveFocusOutOfModal(upsellModal);
    if (window.bootstrap?.Modal) {
      const bsModal = bootstrap.Modal.getInstance(upsellModal);
      bsModal?.hide();
    } else {
      upsellModal.style.display = 'none';
      upsellModal.classList.remove('show');
    }
  }

  // Golden Hour–only: go straight to Stripe after modal closes (await so redirect isn't lost)
  if (pendingContextType === 'golden_only' && pendingGoldenLocation) {
    const checkoutData = {
      plan: 'single',
      goldenOnly: true,
      includeGoldenHour: true,
      goldenLat: pendingGoldenLocation.lat,
      goldenLng: pendingGoldenLocation.lng,
      goldenLocationName: pendingGoldenLocation.label || 'Location',
      userTimezone: getUserTimezone()
    };
    setTimeout(() => {
      startCheckoutSession(checkoutData).catch((err) => {
        console.error('Golden Hour checkout error:', err);
        setVerificationBannerState({
          title: 'Checkout unavailable',
          message: err.message || 'Failed to start checkout. Please try again.',
          variant: 'danger',
          showResend: false,
          showContinue: false,
          showSelectLink: false,
          showDismiss: true
        });
      });
    }, 350);
    return;
  }

  // Tide flow: show plan modal to choose plan and add-ons
  setTimeout(() => {
    const modal = document.getElementById('planModal');
    if (modal) {
      if (window.bootstrap?.Modal) {
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
      } else {
        modal.style.display = 'block';
        modal.classList.add('show');
      }
    }
  }, 300);
}

// Make functions globally available
window.selectPlan = selectPlan;
window.closeUpsellAndContinue = closeUpsellAndContinue;

//https://buy.stripe.com/test_00g6rIbmh8x08KY9AA <-- Test Link

// Fetch and display tide stations from all available regions
const loadTideStations = async () => {
  try {
    // Fetch available regions from the server
    const regionsResponse = await fetch('/api/tide-regions');
    if (!regionsResponse.ok) {
      console.error('Error fetching tide regions');
      return;
    }

    const { regions } = await regionsResponse.json();

    const stationMarkerGroup = L.markerClusterGroup();

    // Fetch and render stations for each region
    for (const region of regions) {
      try {
        const response = await fetch(`/api/tide-stations?region=${region}`);
        if (!response.ok) {
          console.warn(`Could not load stations for region: ${region}`);
          continue;
        }

        const stations = await response.json();

      for (let i = 0; i < stations.length; i++) {
        const station = stations[i];

        // Extract coordinates with fallback for different property names
        const lat = station.lat || station.latitude || station.Latitude;
        const lon = station.lon || station.lng || station.longitude || station.Longitude;

        // Skip stations without valid numeric coordinates
        if (typeof lat !== 'number' || typeof lon !== 'number' ||
            isNaN(lat) || isNaN(lon) ||
            lat < -90 || lat > 90 || lon < -180 || lon > 180) {
          console.warn(`Skipping station with invalid coordinates:`, station);
          continue;
        }

        const marker = L.marker([lat, lon], { icon: tideIcon });

        marker.on('click', () => {
          lastClickedStationLatLon = { lat, lon };
          const content = renderModalContent(
            station.name,
            station.id,
            region,
            lat,
            lon,
            `${region.toUpperCase()} Tide Station`
          );
          L.popup()
            .setLatLng([lat, lon])
            .setContent(content)
            .openOn(map);
          // If user is Pro (unlimited), reveal the Golden Hour checkbox for this tide station
          if (isUnlimitedProUser) {
            const wrapId = `proGoldenWrap-${station.id}`;
            setTimeout(() => {
              const wrap = document.getElementById(wrapId);
              if (wrap) {
                wrap.classList.remove('d-none');
              }
            }, 0);
          }
        });

        stationMarkerGroup.addLayer(marker);
      }
      } catch (error) {
        console.error(`Error loading stations for region ${region}:`, error);
        continue;
      }
    }

    // Add the marker group to the map
    map.addLayer(stationMarkerGroup);
  } catch (error) {
    console.error('Error loading tide stations:', error);
  }
};

// Initialize the map
const initMap = () => {


  // Initialize the Leaflet map and assign it to the global `map` variable
  map = L.map('map', {
    minZoom: 2,
    maxBounds: [[-85, -540], [85, 540]],
    maxBoundsViscosity: 1.0,
  }).setView([49.26083, -123.11389], 3);

  L.tileLayer(
    'https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}',
    {
      attribution:
        'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
      maxZoom: 18,
      id: 'mapbox/streets-v11',
      tileSize: 512,
      zoomOffset: -1,
      accessToken: 'pk.eyJ1Ijoiam5lbHNvbjMzIiwiYSI6ImNqODIxZGpsNjcycnYzMnFueGlkdWQ0a3IifQ.TF0Kw6EQM-dt6bc4EGKM6g',
    }
  ).addTo(map);

  // Add geocoder control with Nominatim provider
  const provider = new L.Control.Geocoder.Nominatim({
    geocodingQueryParams: {
      countrycodes: 'us,ca',
      limit: 5
    }
  });

  const geocoder = L.Control.geocoder({
    position: 'topright',
    placeholder: 'Search for a place...',
    defaultMarkGeocode: false,
    geocoder: provider,
    showResultIcons: true,
    suggestMinLength: 3,
    suggestTimeout: 250,
    queryMinLength: 3,
    collapsed: true
  }).addTo(map);

  // Handle geocoder results: one persistent Golden Hour–only marker (replace previous)
  geocoder.on('markgeocode', function(e) {
    const result = e.geocode;
    const latlng = result.center;
    const label = (result.name || (result.html && result.html.replace(/<[^>]+>/g, '').trim()) || 'Searched location').slice(0, 200);

    map.setView(latlng, 12);

    if (goldenSearchMarker) {
      map.removeLayer(goldenSearchMarker);
      goldenSearchMarker = null;
    }

    goldenSearchLocation = { lat: latlng.lat, lng: latlng.lng, label };

    const popupContent = `
      <div class="card">
        <div class="card-body">
          <p class="card-label">Golden Hour location</p>
          <h6 class="fw-bolder">${label.replace(/</g, '&lt;')}</h6>
          <input type="text" class="form-control form-control-sm golden-label-input" id="goldenSearchLabel"
                 placeholder="Calendar label (e.g. Cabin, Mexico Villa)" maxlength="60"
                 value="${label.replace(/"/g, '&quot;').replace(/</g, '&lt;')}" />
          <p class="card-text small">Create a Golden Hour calendar for this location.</p>
          <button class="btn download-btn" onclick="handleGoldenHourLocationClick()">
            <img src="/img/whiteLogo.png" alt="calendar icon">Create Golden Hour Calendar
          </button>
        </div>
      </div>`;

    goldenSearchMarker = L.marker(latlng, {
      icon: L.icon({
        iconUrl: '/img/goldenHourIcon.png',
        iconSize: [55, 65],
        iconAnchor: [22, 50],
        className: 'golden-search-marker'
      })
    }).addTo(map);

    goldenSearchMarker.bindPopup(popupContent, { className: 'leaflet-popup' });
  });




  // Store current location for Golden Hour (Pro or planModal)
  let currentLocationMarker = null;

  function findMyLocationAndScroll() {
    const mapSection = document.getElementById('map');
    if (mapSection) {
      const navOffset = 56;
      const y = mapSection.getBoundingClientRect().top + window.pageYOffset - navOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }

    navigator.geolocation.getCurrentPosition((position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      if (currentLocationMarker) map.removeLayer(currentLocationMarker);
      currentLocationMarker = L.marker([latitude, longitude], { icon: myIcon }).addTo(map);
      currentLocationMarker.setZIndexOffset(50);
      map.panTo(new L.LatLng(latitude, longitude));
      const popupContent = `
        <div class="card">
          <div class="card-body">
            <p class="card-label">Current location</p>
            <h6 class="fw-bolder">Your location</h6>
            <input type="text" class="form-control form-control-sm golden-label-input " id="goldenCurrentLabel"
                   placeholder="Calendar label (e.g. Home, Beach House)" maxlength="60" />
            <p class="card-text small">Create a Golden Hour calendar for your current location.</p>
            <button class="btn download-btn text-center" onclick="handleCurrentLocationGoldenHour()">
              <img src="/img/whiteLogo.png" alt="calendar icon">Golden Hour Calendar
            </button>
          </div>
        </div>`;
      currentLocationMarker.bindPopup(popupContent, { className: 'leaflet-popup' });
      currentLocationMarker.on('popupopen', function () {
        const input = document.getElementById('goldenCurrentLabel');
        if (input) {
          input.focus();
        }
      });
    }, (error) => {
      console.warn('Geolocation error:', error);
    });
  }

  async function handleCurrentLocationGoldenHour() {
    if (!currentLocationMarker) return;
    const latlng = currentLocationMarker.getLatLng();
    const customLabel = document.getElementById('goldenCurrentLabel')?.value?.trim() || 'Current Location';
    pendingGoldenLocation = { lat: latlng.lat, lng: latlng.lng, label: customLabel };
    pendingContextType = 'golden_only';
    pendingStationContext = null;
    const authResponse = await fetch('/api/auth/me', { credentials: 'include' });
    if (!authResponse.ok) {
      openAuthModal('signup');
      return;
    }
    const { user } = await authResponse.json();
    if (!user) {
      openAuthModal('signup');
      return;
    }
    openPlanModal();
  }
  window.handleCurrentLocationGoldenHour = handleCurrentLocationGoldenHour;

  // Connect all "Find My Location" buttons
  document.getElementById('mapBtn')?.addEventListener('click', findMyLocationAndScroll);

  // Golden Hour CTA — locate user on map just like "Find My Location"
  document.getElementById('ghCtaBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    findMyLocationAndScroll();
  });

  // Desktop menu "Find My Location" button
  document.querySelector('a[href="#map"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    findMyLocationAndScroll();
  });

  // Mobile menu "Find My Location" button
  document.querySelector('a[href="#mapSection"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    findMyLocationAndScroll();
  });

  // Load tide stations onto the map
  loadTideStations();
};

// Wait for DOM to be ready before initializing the map
document.addEventListener('DOMContentLoaded', () => {
  initMap();
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    setCheckoutButtonsLoading(false);
  }
});
