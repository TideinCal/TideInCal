// Account page functionality

function getUserTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === 'string') return tz;
  } catch (e) {}
  return 'UTC';
}

// Check authentication status
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (response.status === 429) {
            const main = document.querySelector('main');
            if (main) {
                main.innerHTML = `
                    <div class="text-center mt-5 pt-5">
                        <h2 class="text-warning">Too many requests</h2>
                        <p class="lead">Please wait a moment and try again.</p>
                        <a href="/account" class="btn btn-primary">Retry</a>
                        <a href="/" class="btn btn-outline-secondary ms-2">Return home</a>
                    </div>`;
            }
            return false;
        }
        if (!response.ok) {
            window.location.href = '/';
            return false;
        }
        let data = null;
        try {
            data = await response.json();
        } catch (error) {
            data = null;
        }
        const user = data?.user;
        if (user && !user.emailVerifiedAt) {
            window.location.href = '/verify-email.html?source=account';
            return false;
        }
        return true;
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = '/';
        return false;
    }
}

const PENDING_CHECKOUT_KEY = 'pendingCheckout';
const EMAIL_VERIFIED_FLAG = 'emailVerifiedJustNow';

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
        console.warn('[account] Unable to store pending checkout:', error);
    }
}

function readPendingCheckout() {
    try {
        const raw = localStorage.getItem(PENDING_CHECKOUT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn('[account] Unable to read pending checkout:', error);
        return null;
    }
}

function clearPendingCheckout() {
    try {
        localStorage.removeItem(PENDING_CHECKOUT_KEY);
    } catch (error) {
        console.warn('[account] Unable to clear pending checkout:', error);
    }
}

async function maybeRedirectIfVerificationRequired(response) {
    if (!response || response.status !== 403) {
        return false;
    }
    try {
        const data = await response.json();
        if (data?.needsVerification) {
            window.location.href = '/verify-email.html?source=account';
            return true;
        }
    } catch (error) {
        // Ignore parse errors and fall through
    }
    return false;
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
        message: 'Please verify your email before upgrading. Check your inbox for the verification link.',
        variant: 'warning',
        showResend: true,
        showContinue: true,
        showSelectLink: false,
        showDismiss: true
    });

    document.getElementById('verificationBanner')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function startCheckoutSession(checkoutData) {
    const token = await getCsrfToken();
    const response = await fetch('/api/checkout/session', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': token
        },
        body: JSON.stringify(checkoutData)
    });

    let responseData = null;
    if (!response.ok) {
        try {
            responseData = await response.json();
        } catch (e) {
            responseData = null;
        }

        if (response.status === 403 && responseData?.needsVerification) {
            await handleVerificationRequired(checkoutData);
            return;
        }

        throw new Error(responseData?.error || 'Failed to start subscription checkout');
    }

    responseData = responseData || await response.json();
    if (responseData.url) {
        clearPendingCheckout();
        window.location.href = responseData.url;
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
        console.warn('[account] Unable to confirm verification status:', error);
    }

    if (!user?.emailVerifiedAt) {
        return;
    }

    const pending = readPendingCheckout();
    if (!pending) {
        hideVerificationBanner();
        return;
    }

    if (pending.plan !== 'unlimited') {
        hideVerificationBanner();
        return;
    }

    hideVerificationBanner();
}

async function attemptResumeCheckout() {
    const pending = readPendingCheckout();
    if (!pending || pending.plan !== 'unlimited') {
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
        console.warn('[account] Unable to confirm verification status:', error);
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
        console.error('[account] Resume checkout error:', error);
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

// Load subscription information
async function loadSubscriptionInfo() {
    try {
        const response = await fetch('/api/auth/me/entitlements', { credentials: 'include' });
        
        if (await maybeRedirectIfVerificationRequired(response)) {
            return;
        }
        if (!response.ok) {
            console.error('[account] Subscription API error:', response.status);
            return;
        }
        
        const data = await response.json();
        displaySubscriptionInfo(data);
    } catch (error) {
        console.error('[account] Error loading subscription:', error);
        displaySubscriptionError();
    }
}

// Display subscription information
function displaySubscriptionInfo(data) {
    const subscriptionInfo = document.getElementById('subscriptionInfo');
    if (!subscriptionInfo) return;
    
    const { unlimited, unlimitedSince, subscriptionStatus, subscriptionCurrentPeriodEnd, oneTimePurchases, moonCalendar } = data;
    
    if (unlimited && subscriptionStatus === 'active') {
        const sinceDate = unlimitedSince ? new Date(unlimitedSince).toLocaleDateString() : 'Unknown';
    const periodEnd = subscriptionCurrentPeriodEnd ? new Date(subscriptionCurrentPeriodEnd).toLocaleDateString() : null;
        subscriptionInfo.innerHTML = `
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-3">
                <div>
                    <div class="d-flex align-items-center mb-2">
                        <span class="badge bg-primary fs-6 me-2">🎉 SUBSCRIPTION</span>
                        <span class="text-primary fw-bold">Active</span>
                    </div>
                    <p class="mb-0 text-muted">Unlimited access since ${sinceDate}</p>
              ${periodEnd ? `<small class="text-muted">Renews on ${periodEnd}</small>` : `<small class="text-muted">Renewal date: Unknown</small>`}
                </div>
                <div class="text-end">
                    <div class="h5 mb-0 text-primary">∞</div>
                    <small class="text-muted">Unlimited</small>
                </div>
            </div>
            <div class="mt-3 d-flex flex-column flex-md-row gap-2">
                <a href="/#map" class="btn btn-gradient">Go to Map to Generate Tides &amp; Golden Hour</a>
                <button class="btn btn-outline-secondary" onclick="openBillingPortal(this)">Manage Subscription</button>
            </div>
        `;
    } else {
        const purchaseCount = oneTimePurchases ? oneTimePurchases.length : 0;
        subscriptionInfo.innerHTML = `
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-3">
                <div>
                    <div class="d-flex align-items-center mb-2">
                        <span class="badge bg-primary fs-6 me-2">📍 ONE-TIME</span>
                        <span class="text-primary fw-bold">Individual Purchases</span>
                    </div>
                    <p class="mb-0 text-muted">${purchaseCount} purchase(s) active</p>
                    <small class="text-muted">Each purchase allows regeneration for 365 days</small>
                </div>
                <div class="text-end">
                    <div class="h5 mb-0 text-primary">${purchaseCount}</div>
                    <small class="text-muted">Active</small>
                </div>
            </div>
            <div class="mt-3 d-flex flex-column flex-md-row gap-2">
                <a href="/#map" class="btn btn-gradient w-100 w-md-auto">Find Another Location</a>
                <button class="btn btn-gradient w-100 w-md-auto" onclick="upgradeToSubscription()">Upgrade to Subscription</button>
            </div>
        `;
    }

    // Moon calendar entitlement display
    const moonSection = document.getElementById('moonCalendarSection');
    const moonDetails = document.getElementById('moonCalendarDetails');
    if (!moonSection || !moonDetails) return;

    if (moonCalendar && moonCalendar.allowed && moonCalendar.endDate) {
        const end = new Date(moonCalendar.endDate).toLocaleDateString();
        moonDetails.textContent = `Access active. You can generate moon phases up to ${end}.`;
        moonSection.classList.remove('d-none');
    } else if (moonCalendar && moonCalendar.allowed) {
        moonDetails.textContent = 'Access active for moon phases.';
        moonSection.classList.remove('d-none');
    } else {
        moonSection.classList.add('d-none');
    }
}

// Display subscription error
function displaySubscriptionError() {
    const subscriptionInfo = document.getElementById('subscriptionInfo');
    if (!subscriptionInfo) return;
    
    subscriptionInfo.innerHTML = `
        <div class="alert alert-warning mb-0">
            <i class="bi bi-exclamation-triangle me-2"></i>
            Unable to load subscription information
        </div>
    `;
}

async function openBillingPortal(btn) {
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Loading...';
    try {
        const token = await getCsrfToken();
        const res = await fetch('/api/checkout/portal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
            credentials: 'include'
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Unable to open subscription management.');
        }
        const { url } = await res.json();
        if (url) {
            window.location.href = url;
            return;
        }
        throw new Error('No portal URL received.');
    } catch (e) {
        console.error('Billing portal error:', e);
        alert(e.message || 'Unable to open subscription management. Please try again.');
        btn.disabled = false;
        btn.textContent = origText;
    }
}
window.openBillingPortal = openBillingPortal;

// Load user purchases and subscription downloads
async function loadPurchases() {
    try {
        showLoading();
        
        const [purchasesResponse, downloadsResponse] = await Promise.all([
            fetch('/api/auth/me/purchases', { credentials: 'include' }),
            fetch('/api/auth/me/subscription-downloads', { credentials: 'include' })
        ]);

        if (await maybeRedirectIfVerificationRequired(purchasesResponse)) {
            return;
        }
        if (await maybeRedirectIfVerificationRequired(downloadsResponse)) {
            return;
        }
        
        if (!purchasesResponse.ok) {
            const errorText = await purchasesResponse.text();
            console.error('[account] Purchases API error:', errorText);
            throw new Error(`Failed to load purchases: ${purchasesResponse.status}`);
        }
        
        if (!downloadsResponse.ok) {
            const errorText = await downloadsResponse.text();
            console.error('[account] Subscription downloads API error:', errorText);
            throw new Error(`Failed to load subscription downloads: ${downloadsResponse.status}`);
        }
        
        const purchasesData = await purchasesResponse.json();
        const downloadsData = await downloadsResponse.json();
        
        const purchases = purchasesData.purchases || [];
        const subscriptionDownloads = downloadsData.downloads || [];
        
        if (purchases.length === 0 && subscriptionDownloads.length === 0) {
            showEmpty();
        } else {
            showPurchases(purchases, subscriptionDownloads);
        }
    } catch (error) {
        console.error('[account] Error loading purchases:', error);
        showError(error.message);
    }
}

// Show loading state
function showLoading() {
    document.getElementById('loadingState').classList.remove('d-none');
    document.getElementById('errorState').classList.add('d-none');
    document.getElementById('emptyState').classList.add('d-none');
    document.getElementById('purchasesContainer').classList.add('d-none');
}

// Show error state
function showError(message) {
    document.getElementById('loadingState').classList.add('d-none');
    document.getElementById('errorState').classList.remove('d-none');
    document.getElementById('emptyState').classList.add('d-none');
    document.getElementById('purchasesContainer').classList.add('d-none');
    document.getElementById('errorMessage').textContent = message;
}

// Show empty state
function showEmpty() {
    document.getElementById('loadingState').classList.add('d-none');
    document.getElementById('errorState').classList.add('d-none');
    document.getElementById('emptyState').classList.remove('d-none');
    document.getElementById('purchasesContainer').classList.add('d-none');
}

// Show purchases table.
// Bundled tide + Golden Hour: one row (Tide + Golden Hour); download returns one combined ICS. Golden Hour (add-on) rows are hidden.
function showPurchases(purchases, subscriptionDownloads = []) {
    document.getElementById('loadingState').classList.add('d-none');
    document.getElementById('errorState').classList.add('d-none');
    document.getElementById('emptyState').classList.add('d-none');
    document.getElementById('purchasesContainer').classList.remove('d-none');
    
    const tbody = document.getElementById('purchasesTableBody');
    tbody.innerHTML = '';
    const cardsContainer = document.getElementById('purchasesCards');
    if (cardsContainer) {
        cardsContainer.innerHTML = '';
    }

    const addCard = (title, rowsHtml, actionHtml) => {
        if (!cardsContainer) return;
        const card = document.createElement('div');
        card.className = 'card mb-3 shadow-sm';
        card.innerHTML = `
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <div class="fw-bold">${title}</div>
                    ${actionHtml || ''}
                </div>
                ${rowsHtml}
            </div>
        `;
        cardsContainer.appendChild(card);
    };
    
    // Render subscription downloads first (stations downloaded under subscription)
    subscriptionDownloads.forEach(download => {
        const row = document.createElement('tr');
        const isGoldenHour = download.product === 'golden_hour';
        const downloadDate = new Date(download.updatedAt || download.createdAt).toLocaleDateString();

        if (isGoldenHour) {
            const locationName = download.locationName || 'Location';
            const safeLocationName = locationName.replace(/'/g, "\\'");
            const lat = download.lat;
            const lng = download.lng;
            const tz = (download.userTimezone || 'UTC').replace(/'/g, "\\'");

            row.innerHTML = `
                <td><span class="badge bg-primary">Subscription</span> <span class="badge bg-warning text-dark ms-1">Golden Hour</span></td>
                <td class="fw-medium">${locationName}</td>
                <td class="text-muted">—</td>
                <td class="text-muted">${downloadDate}</td>
                <td class="text-muted">—</td>
                <td><span class="badge bg-primary">Active</span></td>
                <td>
                    <button class="btn btn-sm btn-gradient" onclick="generateGoldenHourSubscriptionDownload(${lat}, ${lng}, '${safeLocationName}', '${tz}', this)">
                        Download
                    </button>
                </td>
            `;
            tbody.appendChild(row);

            const cardRows = `
                <div class="small text-muted">Type: Subscription – Golden Hour</div>
                <div class="small text-muted">Location: ${locationName}</div>
                <div class="small text-muted">Last Download: ${downloadDate}</div>
            `;
            const cardAction = `
                <button class="btn btn-sm btn-gradient" onclick="generateGoldenHourSubscriptionDownload(${lat}, ${lng}, '${safeLocationName}', '${tz}', this)">
                    Download
                </button>
            `;
            addCard(locationName, cardRows, cardAction);
        } else {
            const stationTitle = download.stationTitle || download.stationId || 'Unknown';
            const region = download.country || '—';
            const hasGolden = download.includeGoldenHour === true;

            const typeBadgeHtml = hasGolden
                ? '<span class="badge bg-primary">Subscription Download</span> <span class="badge bg-warning text-dark ms-1">Tide + Golden Hour</span>'
                : '<span class="badge bg-primary">Subscription Download</span>';
            const stationCellHtml = hasGolden
                ? `${stationTitle}<br><span class="small text-muted">Includes Golden Hour</span>`
                : `${stationTitle}`;

            row.innerHTML = `
                <td>${typeBadgeHtml}</td>
                <td class="fw-medium">${stationCellHtml}</td>
                <td class="text-muted">${region}</td>
                <td class="text-muted">${downloadDate}</td>
                <td class="text-muted">—</td>
                <td><span class="badge bg-primary">Active</span></td>
                <td>
                    <button class="btn btn-sm btn-gradient" onclick="generateSubscriptionDownload('${download.stationId}', '${stationTitle}', '${region}', this)">
                        Download
                    </button>
                </td>
            `;
            tbody.appendChild(row);

            const cardRows = `
                <div class="small text-muted">Type: Subscription Download${hasGolden ? ' (Tide + Golden Hour)' : ''}</div>
                <div class="small text-muted">Station: ${stationTitle}</div>
                <div class="small text-muted">Region: ${region}</div>
                <div class="small text-muted">Last Download: ${downloadDate}</div>
                ${hasGolden ? '<div class="small text-muted">Includes Golden Hour</div>' : ''}
            `;
            const cardAction = `
                <button class="btn btn-sm btn-gradient" onclick="generateSubscriptionDownload('${download.stationId}', '${stationTitle}', '${region}', this)">
                    Download
                </button>
            `;
            addCard(stationTitle, cardRows, cardAction);
        }
    });
    
    purchases.forEach(purchase => {
        // Bundled Golden Hour is delivered with the tide purchase; do not show a separate row
        if (purchase.product === 'golden' && purchase.regenerationParams?.bundledWithTide === true) {
            return;
        }
        const row = document.createElement('tr');
        let typeBadge, stationTitle, region, purchaseDate, expiresAt, status, actionButton;

        if (purchase.product === 'subscription') {
            typeBadge = '<span class="badge bg-primary">Subscription</span>';
            stationTitle = '—';
            region = '—';
            purchaseDate = new Date(purchase.createdAt).toLocaleDateString();
            const periodEnd = purchase.currentPeriodEnd ? new Date(purchase.currentPeriodEnd).toLocaleDateString() : 'Unknown';
            expiresAt = periodEnd;
            status = purchase.isActive
                ? '<span class="badge bg-primary">Active</span>'
                : '<span class="badge bg-secondary">Inactive</span>';
            actionButton = purchase.isActive
                ? '<button class="btn btn-sm btn-gradient" onclick="window.location.href=\'/#map\'">Generate Files</button>'
                : '<button class="btn btn-sm btn-outline-secondary" disabled>Expired</button>';
        } else if (purchase.product === 'golden') {
            const isAddOn = purchase.regenerationParams?.bundledWithTide === true;
            typeBadge = isAddOn
                ? '<span class="badge bg-warning text-dark">Golden Hour (add-on)</span>'
                : '<span class="badge bg-warning text-dark">Golden Hour</span>';
            stationTitle = purchase.regenerationParams?.locationName || 'Location';
            region = '—';
            purchaseDate = new Date(purchase.purchaseDate || purchase.createdAt).toLocaleDateString();
            const expiresDate = purchase.expiresAt ? new Date(purchase.expiresAt) : new Date(new Date(purchase.purchaseDate || purchase.createdAt).getTime() + 365 * 24 * 60 * 60 * 1000);
            expiresAt = expiresDate.toLocaleDateString();
            const daysRemaining = purchase.daysRemaining !== undefined ? purchase.daysRemaining : Math.max(0, Math.ceil((expiresDate - new Date()) / (1000 * 60 * 60 * 24)));
            const isExpired = purchase.isExpired !== undefined ? purchase.isExpired : expiresDate < new Date();
            if (isExpired) {
                status = '<span class="badge bg-danger">Expired</span>';
                actionButton = '<button class="btn btn-sm btn-outline-secondary" disabled>Expired</button>';
            } else {
                const statusClass = daysRemaining > 30 ? 'success' : daysRemaining > 0 ? 'warning' : 'danger';
                status = `<span class="badge bg-${statusClass}">${daysRemaining} days left</span>`;
                actionButton = `<button class="btn btn-sm btn-gradient" onclick="downloadGoldenHour('${purchase._id}', this)">Download</button>`;
            }
        } else {
            const hasGolden = purchase.regenerationParams?.includeGoldenHour === true;
            typeBadge = hasGolden
                ? '<span class="badge bg-primary">Tide + Golden Hour</span>'
                : '<span class="badge bg-primary">One-Time</span>';
            stationTitle = purchase.regenerationParams?.stationTitle || purchase.metadata?.stationTitle || 'Unknown';
            region = purchase.regenerationParams?.country || purchase.metadata?.country || '—';
            purchaseDate = new Date(purchase.purchaseDate || purchase.createdAt).toLocaleDateString();
            const expiresDate = purchase.expiresAt ? new Date(purchase.expiresAt) : new Date(new Date(purchase.purchaseDate || purchase.createdAt).getTime() + 365 * 24 * 60 * 60 * 1000);
            expiresAt = expiresDate.toLocaleDateString();
            const daysRemaining = purchase.daysRemaining !== undefined ? purchase.daysRemaining : Math.max(0, Math.ceil((expiresDate - new Date()) / (1000 * 60 * 60 * 24)));
            const isExpired = purchase.isExpired !== undefined ? purchase.isExpired : expiresDate < new Date();
            if (isExpired) {
                status = '<span class="badge bg-danger">Expired</span>';
                actionButton = '<button class="btn btn-sm btn-outline-secondary" disabled>Expired</button>';
            } else {
                const statusClass = daysRemaining > 30 ? 'success' : daysRemaining > 0 ? 'warning' : 'danger';
                status = `<span class="badge bg-${statusClass}">${daysRemaining} days left</span>`;
                actionButton = `<button class="btn btn-sm btn-gradient" onclick="regeneratePurchase('${purchase._id}', this)">Download</button>`;
            }
        }

        row.innerHTML = `
            <td>${typeBadge}</td>
            <td class="fw-medium">${stationTitle}</td>
            <td class="text-muted">${region}</td>
            <td class="text-muted">${purchaseDate}</td>
            <td class="text-muted">${expiresAt}</td>
            <td>${status}</td>
            <td>${actionButton}</td>
        `;
        tbody.appendChild(row);

        if (purchase.product === 'subscription') {
            const cardRows = `
                <div class="small text-muted">Type: Subscription</div>
                <div class="small text-muted">Purchase Date: ${purchaseDate}</div>
                <div class="small text-muted">Expires: ${expiresAt}</div>
                <div class="small text-muted">Status: ${purchase.isActive ? 'Active' : 'Inactive'}</div>
            `;
            addCard('Subscription', cardRows, actionButton);
        } else if (purchase.product === 'golden') {
            const addOnNote = purchase.regenerationParams?.bundledWithTide ? ' (add-on, same location as tide)' : '';
            const cardRows = `
                <div class="small text-muted">Type: Golden Hour${addOnNote}</div>
                <div class="small text-muted">Location: ${stationTitle}</div>
                <div class="small text-muted">Purchase Date: ${purchaseDate}</div>
                <div class="small text-muted">Expires: ${expiresAt}</div>
            `;
            addCard(stationTitle, cardRows, actionButton);
        } else {
            const tideNote = purchase.regenerationParams?.includeGoldenHour ? ' (includes Golden Hour)' : '';
            const cardRows = `
                <div class="small text-muted">Type: One-Time${tideNote}</div>
                <div class="small text-muted">Station: ${stationTitle}</div>
                <div class="small text-muted">Region: ${region}</div>
                <div class="small text-muted">Purchase Date: ${purchaseDate}</div>
                <div class="small text-muted">Expires: ${expiresAt}</div>
            `;
            addCard(stationTitle, cardRows, actionButton);
        }
    });
}

function setButtonLoading(button, isLoading, label = 'Generating...') {
    if (!button) return;
    if (isLoading) {
        if (!button.dataset.originalHtml) {
            button.dataset.originalHtml = button.innerHTML;
        }
        button.disabled = true;
        button.innerHTML = `<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>${label}`;
        return;
    }
    button.disabled = false;
    if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
    }
}

// Regenerate purchase (one-time only)
async function regeneratePurchase(purchaseId, button) {
    try {
        console.log('[account] Regenerating purchase:', purchaseId);

        // Show loading state
        setButtonLoading(button, true);
        
        const token = await getCsrfToken();
        const response = await fetch(`/api/downloads/regenerate/${purchaseId}`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'X-CSRF-Token': token
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to regenerate file');
        }
        
        // Download the file
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'tide-calendar.ics';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        // Reset button
        setButtonLoading(button, false);

        setVerificationBannerState({
            title: 'Download ready',
            message: 'File generated and downloaded successfully.',
            variant: 'success',
            showResend: false,
            showContinue: false,
            showSelectLink: false,
            showDismiss: true
        });
    } catch (error) {
        console.error('[account] Error regenerating purchase:', error);
        setVerificationBannerState({
            title: 'Download failed',
            message: error.message || 'Failed to regenerate file. Please try again.',
            variant: 'danger',
            showResend: false,
            showContinue: false,
            showSelectLink: false,
            showDismiss: true
        });
        
        // Reset button
        setButtonLoading(button, false);
    }
}

// Regenerate Golden Hour purchase
async function downloadGoldenHour(purchaseId, button) {
    try {
        setButtonLoading(button, true, 'Generating...');
        const token = await getCsrfToken();
        const response = await fetch(`/api/downloads/golden/regenerate/${purchaseId}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-CSRF-Token': token }
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to generate Golden Hour file');
        }
        const blob = await response.blob();
        const filename = response.headers.get('Content-Disposition')?.match(/filename="?([^"]+)"?/)?.[1] || 'golden-hour.ics';
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        setVerificationBannerState({
            title: 'Download ready',
            message: 'Golden Hour calendar downloaded successfully.',
            variant: 'success',
            showResend: false,
            showContinue: false,
            showSelectLink: false,
            showDismiss: true
        });
    } catch (error) {
        console.error('[account] Error downloading Golden Hour:', error);
        setVerificationBannerState({
            title: 'Download failed',
            message: error.message || 'Failed to generate Golden Hour calendar. Please try again.',
            variant: 'danger',
            showResend: false,
            showContinue: false,
            showSelectLink: false,
            showDismiss: true
        });
    } finally {
        setButtonLoading(button, false);
    }
}

async function generateGoldenHourSubscriptionDownload(lat, lng, locationName, userTimezone, button) {
    try {
        setButtonLoading(button, true, 'Generating...');
        const token = await getCsrfToken();
        const response = await fetch('/api/downloads/golden', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token
            },
            body: JSON.stringify({ lat, lng, locationName: locationName || 'Location', userTimezone: userTimezone || 'UTC' })
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Failed to generate Golden Hour file');
        }
        const blob = await response.blob();
        const filename = response.headers.get('Content-Disposition')?.match(/filename="?([^"]+)"?/)?.[1] || 'golden-hour.ics';
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        setVerificationBannerState({
            title: 'Download ready',
            message: 'Golden Hour calendar downloaded successfully.',
            variant: 'success',
            showResend: false,
            showContinue: false,
            showSelectLink: false,
            showDismiss: true
        });
    } catch (error) {
        console.error('[account] Error generating Golden Hour subscription download:', error);
        setVerificationBannerState({
            title: 'Download failed',
            message: error.message || 'Failed to generate Golden Hour calendar. Please try again.',
            variant: 'danger',
            showResend: false,
            showContinue: false,
            showSelectLink: false,
            showDismiss: true
        });
    } finally {
        setButtonLoading(button, false);
    }
}

// Download again for subscription users
async function generateSubscriptionDownload(stationId, stationTitle, country, button) {
    try {
        setButtonLoading(button, true);
        if (!stationId || !country) {
            setVerificationBannerState({
                title: 'Missing station info',
                message: 'Station information is missing. Please select a station on the map.',
                variant: 'warning',
                showResend: false,
                showContinue: false,
                showSelectLink: true,
                showDismiss: true
            });
            return;
        }
        
        const token = await getCsrfToken();
        const response = await fetch('/api/downloads/generate', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token
            },
            body: JSON.stringify({
                stationID: stationId,
                stationTitle: stationTitle || 'Tide Station',
                country: country,
                includeMoon: false,
                userTimezone: 'UTC',
                feet: false
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to generate file');
        }
        
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'tide-calendar.ics';
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
            if (filenameMatch) {
                filename = filenameMatch[1];
            }
        }
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error('[account] Error generating subscription file:', error);
        setVerificationBannerState({
            title: 'Download failed',
            message: error.message || 'Failed to download file. Please try again.',
            variant: 'danger',
            showResend: false,
            showContinue: false,
            showSelectLink: false,
            showDismiss: true
        });
    } finally {
        setButtonLoading(button, false);
    }
}
async function downloadMoonCalendar(button) {
    try {
        setButtonLoading(button, true, 'Generating...');
        const token = await getCsrfToken();
        const response = await fetch('/api/downloads/moon', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token
            },
            body: JSON.stringify({ userTimezone: getUserTimezone() })
        });

        if (!response.ok) {
            let message = 'Failed to generate moon calendar';
            try {
                const error = await response.json();
                if (error && error.error) {
                    message = error.error;
                }
            } catch (_) {
                // ignore JSON parse errors
            }
            throw new Error(message);
        }

        const blob = await response.blob();
        const contentDisposition = response.headers.get('Content-Disposition');
        const filename = contentDisposition?.match(/filename="?([^"]+)"?/)?.[1] || `moon-phases-${new Date().getFullYear()}.ics`;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error('[account] Error generating moon calendar:', error);
        setVerificationBannerState({
            title: 'Moon calendar unavailable',
            message: error.message || 'Failed to generate moon phases calendar. Please try again.',
            variant: 'danger',
            showResend: false,
            showContinue: false,
            showSelectLink: false,
            showDismiss: true
        });
    } finally {
        setButtonLoading(button, false);
    }
}

// Make functions globally available
window.regeneratePurchase = regeneratePurchase;
window.downloadGoldenHour = downloadGoldenHour;
window.generateSubscriptionDownload = generateSubscriptionDownload;
window.generateGoldenHourSubscriptionDownload = generateGoldenHourSubscriptionDownload;
window.downloadMoonCalendar = downloadMoonCalendar;

async function upgradeToSubscription() {
    try {
        await startCheckoutSession({ plan: 'unlimited' });
    } catch (error) {
        console.error('[account] Upgrade error:', error);
        setVerificationBannerState({
            title: 'Checkout unavailable',
            message: error.message || 'Failed to start subscription checkout. Please try again.',
            variant: 'danger',
            showResend: false,
            showContinue: false,
            showSelectLink: false,
            showDismiss: true
        });
    }
}

window.upgradeToSubscription = upgradeToSubscription;

// Logout function
async function logout() {
    try {
        const token = await getCsrfToken();
        const response = await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'X-CSRF-Token': token
            }
        });
        
        if (response.ok) {
            window.location.href = '/';
        } else {
            setVerificationBannerState({
                title: 'Logout failed',
                message: 'Please try again.',
                variant: 'danger',
                showResend: false,
                showContinue: false,
                showSelectLink: false,
                showDismiss: true
            });
        }
    } catch (error) {
        console.error('Logout error:', error);
        setVerificationBannerState({
            title: 'Logout failed',
            message: 'Please try again.',
            variant: 'danger',
            showResend: false,
            showContinue: false,
            showSelectLink: false,
            showDismiss: true
        });
    }
}

// Initialize page
async function init() {
    const isAuthenticated = await checkAuth();
    if (isAuthenticated) {
        await maybeResumeCheckoutAfterVerification();

        // Get user info and populate name fields
        try {
            const response = await fetch('/api/auth/me', { credentials: 'include' });
            if (response.ok) {
                const { user } = await response.json();
                if (user) {
                    if (user.emailVerifiedAt) {
                        hideVerificationBanner();
                    }
                    const displayName = user.firstName || user.email.split('@')[0];
                    
                    // Update desktop greeting
                    const navUserName = document.getElementById('navUserName');
                    if (navUserName) {
                        navUserName.textContent = displayName;
                    }
                    
                    // Update mobile greeting
                    const menuUserName = document.getElementById('menuUserName');
                    if (menuUserName) {
                        menuUserName.textContent = displayName;
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching user info:', error);
        }
        
        // Load subscription info and purchases
        await loadSubscriptionInfo();
        await loadPurchases();
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    const toggleButtons = document.querySelectorAll('[data-password-toggle]');
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

    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    document.getElementById('logoutBtnDesktop')?.addEventListener('click', logout);
    document.getElementById('menuHomeLink')?.addEventListener('click', () => {
        window.location.href = '/';
    });

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
            console.error('[account] Resend verification error:', error);
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

    const changePasswordForm = document.getElementById('changePasswordForm');
    const changePasswordMessage = document.getElementById('changePasswordMessage');

    changePasswordForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!changePasswordForm) return;

        const formData = new FormData(changePasswordForm);
        const currentPassword = formData.get('currentPassword');
        const newPassword = formData.get('newPassword');
        const confirmNewPassword = formData.get('confirmNewPassword');

        if (newPassword !== confirmNewPassword) {
            if (changePasswordMessage) {
                changePasswordMessage.textContent = 'New passwords do not match.';
                changePasswordMessage.classList.remove('d-none');
            }
            return;
        }

        try {
            const token = await getCsrfToken();
            const response = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': token
                },
                credentials: 'include',
                body: JSON.stringify({ currentPassword, newPassword })
            });

            let message = 'Password updated successfully.';
            if (!response.ok) {
                try {
                    const data = await response.json();
                    if (Array.isArray(data?.details)) {
                        message = data.details.map((item) => item.message).join(' ');
                    } else {
                        message = data.error || message;
                    }
                } catch (e) {
                    message = `Unable to update password (${response.status}).`;
                }
            } else {
                changePasswordForm.reset();
            }

            if (changePasswordMessage) {
                changePasswordMessage.textContent = message;
                changePasswordMessage.classList.remove('d-none');
            }
        } catch (error) {
            if (changePasswordMessage) {
                changePasswordMessage.textContent = 'Unable to update password. Please try again.';
                changePasswordMessage.classList.remove('d-none');
            }
        }
    });
    
    // Start the app
    init();
});

