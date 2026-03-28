
function setMessage(target, message) {
  if (!target) return;
  target.textContent = message;
  target.classList.remove('d-none');
}

function hideMessage(target) {
  if (!target) return;
  target.textContent = '';
  target.classList.add('d-none');
}

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

async function resetPassword() {
  const form = document.getElementById('resetPasswordForm');
  const errorEl = document.getElementById('resetError');
  const successEl = document.getElementById('resetSuccess');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage(errorEl);
    hideMessage(successEl);

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) {
      setMessage(errorEl, 'Missing reset token.');
      return;
    }

    const formData = new FormData(form);
    const password = formData.get('password');
    const confirmPassword = formData.get('confirmPassword');

    if (password !== confirmPassword) {
      setMessage(errorEl, 'Passwords do not match.');
      return;
    }

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password })
      });

      if (!response.ok) {
        let message = 'Unable to reset password.';
        try {
          const data = await response.json();
          if (Array.isArray(data?.details)) {
            message = data.details.map((item) => item.message).join(' ');
          } else {
            message = data.error || message;
          }
        } catch (e) {
          message = `Reset failed (${response.status}).`;
        }
        setMessage(errorEl, message);
        return;
      }

      form.reset();
      setMessage(successEl, 'Password updated. You can now log in.');
    } catch (error) {
      setMessage(errorEl, 'Reset failed. Please try again.');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  attachPasswordToggles();
  resetPassword();
});
