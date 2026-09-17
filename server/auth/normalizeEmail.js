// Email normalization for uniqueness checks and rate-limiting.
//
// The original `email` (as the user typed it, lowercased) is still what we
// send mail to and display. The `normalizedEmail` is what we use to detect
// duplicate signups and key per-address rate limits.
//
// Specifically defeats:
//   - Gmail "dot trick" (e.l.s.a.koo@gmail.com == elsakoo@gmail.com)
//   - Gmail/Googlemail domain swap (googlemail.com routes to gmail.com)
//   - Plus addressing (alice+anything@example.com → alice@example.com)
//     This is honored by Gmail, Outlook/Live/Hotmail, Yahoo, ProtonMail,
//     Fastmail, iCloud, and most other modern providers.

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Normalize an email for uniqueness/rate-limit lookups.
 * Returns the input lowercased as a fallback if the address shape is invalid,
 * so callers can still key off something deterministic.
 */
export function normalizeEmail(rawEmail) {
  if (!rawEmail || typeof rawEmail !== 'string') return '';
  const lowered = rawEmail.trim().toLowerCase();
  const atIndex = lowered.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === lowered.length - 1) {
    return lowered;
  }

  let local = lowered.slice(0, atIndex);
  let domain = lowered.slice(atIndex + 1);

  // Strip +tag aliasing on every domain (gmail, outlook, yahoo, proton, etc.).
  const plusIndex = local.indexOf('+');
  if (plusIndex !== -1) {
    local = local.slice(0, plusIndex);
  }

  // Gmail-specific: ignore dots in the local part and canonicalize the domain.
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }

  if (!local) {
    // All chars were stripped (shouldn't happen for real addresses);
    // fall back to the lowered original so we don't collapse everything to ''.
    return lowered;
  }

  return `${local}@${domain}`;
}
