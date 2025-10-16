// Account page functionality

// Check authentication status
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (!response.ok) {
            window.location.href = '/';
            return false;
        }
        return true;
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = '/';
        return false;
    }
}

// Load subscription information
async function loadSubscriptionInfo() {
    try {
        console.log('[account] Loading subscription info...');
        const response = await fetch('/api/auth/me/entitlements', { credentials: 'include' });
        
        if (!response.ok) {
            console.error('[account] Subscription API error:', response.status);
            return;
        }
        
        const data = await response.json();
        console.log('[account] Subscription data:', data);
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
    
    const { unlimited, unlimitedSince, entitlements } = data;
    
    if (unlimited) {
        const sinceDate = unlimitedSince ? new Date(unlimitedSince).toLocaleDateString() : 'Unknown';
        subscriptionInfo.innerHTML = `
            <div class="d-flex align-items-center justify-content-between">
                <div>
                    <div class="d-flex align-items-center mb-2">
                        <span class="badge bg-success fs-6 me-2">🎉 UNLIMITED</span>
                        <span class="text-success fw-bold">Active Subscription</span>
                    </div>
                    <p class="mb-0 text-muted">Unlimited access since ${sinceDate}</p>
                    <small class="text-muted">You can download any single station for free!</small>
                </div>
                <div class="text-end">
                    <div class="h5 mb-0 text-success">∞</div>
                    <small class="text-muted">Unlimited</small>
                </div>
            </div>
        `;
    } else {
        const stationCount = entitlements ? entitlements.length : 0;
        subscriptionInfo.innerHTML = `
            <div class="d-flex align-items-center justify-content-between">
                <div>
                    <div class="d-flex align-items-center mb-2">
                        <span class="badge bg-primary fs-6 me-2">📍 SINGLE</span>
                        <span class="text-primary fw-bold">Individual Stations</span>
                    </div>
                    <p class="mb-0 text-muted">${stationCount} station(s) purchased</p>
                    <small class="text-muted">Each station download costs $5</small>
                </div>
                <div class="text-end">
                    <div class="h5 mb-0 text-primary">${stationCount}</div>
                    <small class="text-muted">Stations</small>
                </div>
            </div>
        `;
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

// Load user files
async function loadFiles() {
    try {
        console.log('[account] Loading files...');
        showLoading();
        
        const response = await fetch('/api/files', { credentials: 'include' });
        console.log('[account] Files API response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[account] Files API error:', errorText);
            throw new Error(`Failed to load files: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('[account] Files data:', data);
        const files = data.files || [];
        
        if (files.length === 0) {
            console.log('[account] No files found, showing empty state');
            showEmpty();
        } else {
            console.log('[account] Found', files.length, 'files');
            showFiles(files);
        }
    } catch (error) {
        console.error('[account] Error loading files:', error);
        showError(error.message);
    }
}

// Show loading state
function showLoading() {
    document.getElementById('loadingState').classList.remove('d-none');
    document.getElementById('errorState').classList.add('d-none');
    document.getElementById('emptyState').classList.add('d-none');
    document.getElementById('filesContainer').classList.add('d-none');
}

// Show error state
function showError(message) {
    document.getElementById('loadingState').classList.add('d-none');
    document.getElementById('errorState').classList.remove('d-none');
    document.getElementById('emptyState').classList.add('d-none');
    document.getElementById('filesContainer').classList.add('d-none');
    document.getElementById('errorMessage').textContent = message;
}

// Show empty state
function showEmpty() {
    document.getElementById('loadingState').classList.add('d-none');
    document.getElementById('errorState').classList.add('d-none');
    document.getElementById('emptyState').classList.remove('d-none');
    document.getElementById('filesContainer').classList.add('d-none');
}

// Show files table
function showFiles(files) {
    document.getElementById('loadingState').classList.add('d-none');
    document.getElementById('errorState').classList.add('d-none');
    document.getElementById('emptyState').classList.add('d-none');
    document.getElementById('filesContainer').classList.remove('d-none');
    
    const tbody = document.getElementById('filesTableBody');
    tbody.innerHTML = '';
    
    files.forEach(file => {
        const row = document.createElement('tr');
        
        const createdDate = new Date(file.createdAt).toLocaleDateString();
        const daysRemaining = file.daysRemaining;
        const expiresText = daysRemaining > 0 ? `${daysRemaining} days` : 'Expired';
        const expiresClass = daysRemaining > 30 ? 'text-success' : daysRemaining > 0 ? 'text-warning' : 'text-danger';
        
        row.innerHTML = `
            <td class="fw-medium">${file.stationTitle}</td>
            <td class="text-muted">${file.region}</td>
            <td class="text-center">
                ${file.includesMoon ? '<span class="badge bg-info">🌙</span>' : '<span class="text-muted">—</span>'}
            </td>
            <td class="text-muted">${createdDate}</td>
            <td class="${expiresClass} fw-medium">${expiresText}</td>
            <td>
                <a href="${file.downloadUrl}" class="btn btn-sm btn-outline-primary" ${daysRemaining === 0 ? 'disabled' : ''}>
                    ${daysRemaining > 0 ? '📥 Download' : '❌ Expired'}
                </a>
            </td>
        `;
        
        tbody.appendChild(row);
    });
}

// Logout function
async function logout() {
    try {
        const response = await fetch('/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        });
        
        if (response.ok) {
            window.location.href = '/';
        } else {
            alert('Logout failed. Please try again.');
        }
    } catch (error) {
        console.error('Logout error:', error);
        alert('Logout failed. Please try again.');
    }
}

// Initialize page
async function init() {
    const isAuthenticated = await checkAuth();
    if (isAuthenticated) {
        // Get user info and populate name fields
        try {
            const response = await fetch('/api/auth/me', { credentials: 'include' });
            if (response.ok) {
                const { user } = await response.json();
                if (user) {
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
        
        // Load subscription info and files
        await loadSubscriptionInfo();
        await loadFiles();
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('logoutBtn')?.addEventListener('click', logout);
    document.getElementById('logoutBtnDesktop')?.addEventListener('click', logout);
    
    // Start the app
    init();
});

