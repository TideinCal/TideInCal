function setState(state, message) {
  const loading = document.getElementById('loadingState');
  const success = document.getElementById('successState');
  const error = document.getElementById('errorState');
  const errorMessage = document.getElementById('errorMessage');
  const resendBtn = document.getElementById('resendVerificationBtn');

  loading.classList.add('d-none');
  success.classList.add('d-none');
  error.classList.add('d-none');

  if (state === 'success') {
    success.classList.remove('d-none');
  } else if (state === 'error') {
    if (message && errorMessage) {
      errorMessage.textContent = message;
    }
    error.classList.remove('d-none');
    if (resendBtn) resendBtn.disabled = false;
  } else {
    loading.classList.remove('d-none');
  }
}

async function resendVerificationEmail() {
  const resendBtn = document.getElementById('resendVerificationBtn');
  const errorMessage = document.getElementById('errorMessage');
  const resendEmailInput = document.getElementById('resendEmailInput');
  if (resendBtn) resendBtn.disabled = true;

  try {
    const email = resendEmailInput?.value?.trim();
    const response = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(email ? { email } : {})
    });

    if (!response.ok) {
      let message = 'Unable to resend verification email.';
      try {
        const data = await response.json();
        message = data.error || message;
      } catch (e) {
        message = `Resend failed (${response.status})`;
      }
      if (errorMessage) {
        errorMessage.textContent = message;
      }
      if (resendBtn) resendBtn.disabled = false;
      return;
    }

    if (errorMessage) {
      errorMessage.textContent = 'Verification email sent. Please use the most recent email.';
    }
  } catch (error) {
    if (errorMessage) {
      errorMessage.textContent = 'Resend failed. Please try again.';
    }
    if (resendBtn) resendBtn.disabled = false;
  }
}

async function verifyEmail() {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
    setState('error', 'Check your inbox for the verification link. If you need a new email, resend it below.');
      return;
    }

    const response = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      let message = 'Unable to verify your email. If you requested multiple links, please use the most recent verification email.';
      try {
        const data = await response.json();
        message = data.error || message;
      } catch (e) {
        message = `Verification failed (${response.status}). If you requested multiple links, please use the most recent verification email.`;
      }
      setState('error', message);
      return;
    }

    try {
      localStorage.setItem('emailVerifiedJustNow', Date.now().toString());
    } catch (storageError) {
      console.warn('[verifyEmail] Unable to store verification flag:', storageError);
    }
    setState('success');
  } catch (error) {
    console.error('[verifyEmail] Error verifying email:', error);
    setState('error', 'Verification failed. If you requested multiple links, please use the most recent verification email.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  verifyEmail();
  const resendBtn = document.getElementById('resendVerificationBtn');
  if (resendBtn) {
    resendBtn.addEventListener('click', resendVerificationEmail);
  }
});
