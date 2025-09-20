# Cursor Rules · TideInCal V2

## Tech choices (authoritative)
- Runtime: Node 18+, Express (ESM)
- DB: MongoDB Atlas (M0 dev). Use official Node driver.
- Auth: **Email + password** (argon2id), httpOnly session cookie (express-session).  
  - Helmet, express-rate-limit, CORS (origin = tideincal.com, credentials:true)
  - Optional email verification (Resend), **do not block checkout** on unverified.
- Email: Resend (transactional: welcome, verify, reset, download-ready)
- Map: Leaflet 1.9+, leaflet-control-geocoder (Nominatim now; Mapbox optional)
- Moon: SunCalc (no external API)
- Payments: Stripe Checkout + Webhooks (entitlements in Mongo)

## Project structure
/public                 # static (index.html, css/js/img)
/public/js/main.js      # popup, map, search, auth modal hooks, offcanvas fixes
/server
  /auth                 # signup/login/logout, attachUser, requireAuth
  /db                   # mongo client, indexes
  /ics                  # ICS generation (tides, moon add-on)
  /routes               # api routers (auth, checkout, files, stations)
/server.js              # wire middleware + routes
/docs/cursor-rules.md   # this file

## Environment (.env – never commit)
MONGO_URI=
SESSION_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
APP_URL=https://tideincal.com
RESEND_API_KEY=

STRIPE_PRICE_SINGLE_DOWNLOAD=price_xxx
STRIPE_PRICE_LUNAR_ADDON=price_xxx
STRIPE_PRICE_UNLIMITED=price_xxx

## Security musts
- Validate all inputs with Zod. 400 on invalid.
- Never trust client userId; derive from session (attachUser).
- Cookies: httpOnly, sameSite=lax; secure=true in prod.
- Rate limit: 10 req/min on auth, 5 req/min on checkout/session, 3 req/min on reset flows.
- Helmet enabled. CORS limited to APP_URL; credentials:true.
- Log minimal server-side; generic messages client-side.

## Data models (Mongo)
### users
- _id, email (unique, lowercased, indexed), passwordHash (argon2id), emailVerifiedAt (nullable),
  firstName (nullable), lastName (nullable), stripeCustomerId (nullable),
  createdAt, updatedAt

### files (retained ICS)
- _id, userId (index), stationId, stationTitle, region, includesMoon (bool),
  storagePath (relative under /tempICSFile or object storage later),
  createdAt (index), retainUntil (TTL index ~365 days), lastDownloadedAt

### purchases (optional, useful for support)
- _id, userId, stripeSessionId, stripePaymentIntentId, product ('single'|'lunar-addon'|'unlimited'),
  metadata (stationId, stationTitle, region), createdAt

> Create TTL index on `files.retainUntil` (expireAfterSeconds: 0).

## Endpoints (new/updated)
- `POST /api/auth/signup` { email, password } → sets session; (send verify email async)
- `POST /api/auth/login` { email, password } → sets session
- `POST /api/auth/logout`
- `GET  /api/auth/me` → { user:{ email, firstName, lastName } | null }

- `POST /api/checkout/session` (auth required)
  body: { stationID, stationTitle, country, includeMoon?, unlimited? }  
  → Stripe Checkout Session URL  
  - set `customer_email = user.email`
  - `metadata = { userId, stationID, stationTitle, country, includeMoon, unlimited }`

- `POST /api/stripe/webhook`  
  - On `checkout.session.completed`: upsert user.stripeCustomerId, create `purchases` record.  
    - If single download: generate ICS immediately (server-side), persist to `/tempICSFile`, create `files` doc with `retainUntil = createdAt + 365d`, email “Download ready” (Resend).
    - If unlimited: mark user entitlement in Mongo (e.g., `users.unlimited = true` or separate `entitlements` doc).

- `GET /api/files` (auth) → list current user’s files (title, createdAt, expiresAt, download URL)
- `GET /api/files/:id/download` (auth & owner) → streams file

## Frontend rules
- Keep existing map & search behavior. (Already fixed offcanvas close + anchor scroll.)
- Station popup “Download File”:
  - If not logged in → open compact modal (Email + Password, tabs for Sign up / Log in). On success → continue checkout.
  - If logged in → call `/api/checkout/session` directly and redirect to returned `url`.
- Add a **Login** button in top nav + offcanvas (already present) → opens modal (no navigation).

## Definition of Done (for this phase)
- Auth: signup/login/logout session cookie working; `/api/auth/me` returns user.
- Checkout: gated by auth; Stripe session created with metadata; success URL routes back to site.
- Webhook: creates purchase record; generates ICS; saves file; creates `files` doc; sends Resend email with secure download link.
- Files API: `/api/files` lists only owner’s files; `/api/files/:id/download` enforces ownership.
- TTL index tested: simulate retainUntil < now → doc auto-removed (mock or manual).
- Lighthouse: no new blocking resources; modal CSS minimal.
- Tests: unit for password hashing/verify, auth middleware, webhook handler (happy path), file ownership.

## When something fails
- Reproduce with minimal curl.
- Add failing test.
- Fix; keep PRs < 150 LOC where possible.
