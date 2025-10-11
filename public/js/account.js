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

