// success.js - Handles purchase verification and redirects to download page

// Guard to prevent multiple verification loops
if (window.__verifying) {
    console.log('[success] Verification already in progress, skipping');
} else {
    window.__verifying = true;
}

/**
 * Verifies the Stripe checkout session and redirects to download page
 * Retries up to 5 times with 1 second delay for transient errors
 */
async function verifyPurchase() {
    // Guard check - prevent multiple simultaneous verifications
    if (window.__verificationStarted) {
        console.log('[success] Verification already started, skipping duplicate call');
        return;
    }
    window.__verificationStarted = true;
    
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session_id');
    
    if (!sessionId) {
        showError('No session ID provided in URL');
        window.__verificationStarted = false;
        return;
    }

    let attempt = 0;
    const maxAttempts = 5;
    const retryDelay = 1000; // 1 second

    while (attempt < maxAttempts) {
        try {
            console.log(`[success] Verification attempt ${attempt + 1}/${maxAttempts}`);
            
            const response = await fetch(`/api/checkout/verify?session_id=${sessionId}`, {
                credentials: 'include',
                method: 'GET'
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                
                // Permanent errors (4xx except 202) - don't retry
                if (response.status >= 400 && response.status < 500 && response.status !== 202) {
                    throw new Error(errorData.error || `Verification failed: ${response.status}`);
                }
                
                // Transient errors (202, 5xx) - retry
                if (attempt < maxAttempts - 1) {
                    console.log(`[success] Transient error, retrying in ${retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    attempt++;
                    continue;
                } else {
                    throw new Error(errorData.error || 'Verification failed after retries');
                }
            }

            const data = await response.json();
            
            if (data.ok && data.purchaseId) {
                // Success - redirect to download page
                console.log('[success] Verification successful, redirecting to download page');
                window.__verificationStarted = false;
                window.location.href = `/dlFile.html?purchaseId=${data.purchaseId}`;
                return;
            } else if (data.ok === false) {
                // Check if it's a 202 retry case
                if (response.status === 202 && data.retry) {
                    console.log('[success] Payment not paid yet, debug:', data.debug);
                    // This is a retry case, continue loop
                    if (attempt < maxAttempts - 1) {
                        console.log(`[success] Retrying in ${retryDelay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        attempt++;
                        continue;
                    } else {
                        throw new Error(data.error || 'Payment verification failed after retries');
                    }
                } else {
                    // Permanent failure
                    throw new Error(data.error || 'Verification failed');
                }
            } else {
                // Legacy response format - try to extract purchaseId
                if (data.purchaseId) {
                    window.__verificationStarted = false;
                    window.location.href = `/dlFile.html?purchaseId=${data.purchaseId}`;
                    return;
                }
                // Fallback to session_id if purchaseId not available
                window.__verificationStarted = false;
                window.location.href = `/dlFile.html?session_id=${sessionId}`;
                return;
            }
        } catch (error) {
            console.error(`[success] Verification error (attempt ${attempt + 1}):`, error);
            
            // If this is the last attempt, show error
            if (attempt >= maxAttempts - 1) {
                window.__verificationStarted = false;
                showError(error.message || 'Unable to verify purchase. Please check your account page or contact support.');
                return;
            }
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            attempt++;
        }
    }
    
    // If we exit the loop without returning, reset flag
    window.__verificationStarted = false;
}

/**
 * Shows error state with navigation options
 */
function showError(message) {
    const loadingState = document.getElementById('loadingState');
    const errorState = document.getElementById('errorState');
    const errorMessage = document.getElementById('errorMessage');
    
    if (loadingState) loadingState.classList.add('d-none');
    if (errorState) errorState.classList.remove('d-none');
    if (errorMessage) errorMessage.textContent = message;
}

// Start verification when DOM is ready (only once)
if (!window.__verificationStarted) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', verifyPurchase);
    } else {
        verifyPurchase();
    }
}

