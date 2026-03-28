# Pro User Flow Verification

## 1. Normal tide download (logged-in Pro user)

**Trigger:** User clicks "Download File" on a tide station popup on the map.

**Code path:** `public/js/main.js`

1. **`handleDownloadClick(stationID, stationTitle, region)`** is called (onclick from popup, ~line 525).
2. **Auth check:** If not logged in (`/api/auth/me` fails), `openAuthModal('signup')` and return.
3. **Entitlements check (lines 851–878):**
   - `fetch('/api/auth/me/entitlements', { credentials: 'include' })`
   - If response OK: `const { unlimited } = await res.json(); isUnlimitedProUser = !!unlimited;`
   - **If `unlimited` is true:**
     - Builds `URLSearchParams` with stationID, stationTitle, country (and optional Golden Hour from `proGoldenCheckbox-${stationID}`).
     - **Redirects:** `window.location.href = \`/dlFile.html?${params.toString()}\`; return;`
     - **No plan modal, no checkout.**
   - If `unlimited` is false or request fails: **`openPlanModal()`** (plan chooser / checkout).

4. **On dlFile.html:** `public/js/dlFile.js` runs. If user has `entitlements.unlimited && entitlements.subscriptionStatus === 'active'`, it calls **`/api/downloads/generate`** (or generate + golden then merge) and triggers download. No checkout.

**Conclusion:** For a logged-in Pro user, normal tide download **bypasses checkout** and goes straight to generation/download.

---

## 2. Golden Hour (logged-in Pro user)

**Triggers:**
- "Create Golden Hour Calendar" on the **search marker** (geocoder result).
- "Create Golden Hour Calendar" on the **current location** marker.

**Code path:** `public/js/main.js`

### Search marker

1. **`handleGoldenHourLocationClick()`** (lines 905–921):
   - Sets `pendingGoldenLocation = { ...goldenSearchLocation }; pendingContextType = 'golden_only';`
   - Auth check: if not logged in → `openAuthModal('signup')`, return.
   - **Calls `openPlanModal()`** (does not call checkout directly).

2. **Inside `openPlanModal()`** (lines 965–1048):
   - `fetch('/api/auth/me/entitlements', { credentials: 'include' })`
   - **If `unlimited` is true:**
     - **If `pendingGoldenLocation` is set:** `await generateGoldenHourProAndDownload(); return;`
     - No modal shown.
   - **`generateGoldenHourProAndDownload()`** (lines 925–961):
     - `POST /api/downloads/golden` with lat, lng, locationName, userTimezone.
     - On success: creates blob, triggers download. **Direct generation/download, no checkout.**

### Current location marker

1. **`handleCurrentLocationGoldenHour()`** (lines 1497–1515):
   - Sets `pendingGoldenLocation`, `pendingContextType = 'golden_only'`.
   - Auth check; then **`openPlanModal()`**.
2. Same as above: **if `unlimited`**, `openPlanModal()` calls **`generateGoldenHourProAndDownload()`** and returns without showing the modal.

**Conclusion:** For a logged-in Pro user, Golden Hour **routes directly to generation/download** (POST `/api/downloads/golden`). No plan modal, no Stripe checkout.

---

## 3. Moon calendar (logged-in Pro user)

**Trigger:** Account page only. There is no moon calendar button on the home/map.

**Code path:** `public/account.html` + `public/js/account.js`

1. **Subscription section:** `loadSubscriptionInfo()` fetches `/api/auth/me/entitlements`. Response includes `moonCalendar: { allowed, startDate, endDate, sources }`.
2. **Display:** If `moonCalendar.allowed` is true, the "Moon Phases Calendar" block is shown (`moonCalendarSection`), with a **"Download Moon Phases"** button.
3. **On click:** **`downloadMoonCalendar(button)`** (account.js, ~862):
   - `POST /api/downloads/moon` with credentials and CSRF.
   - On success: blob download. **Direct generation/download, no checkout.**

Moon is not offered in the plan modal on the home page (the plan modal’s moon checkbox is `d-none` and disabled). So for a Pro user, moon is only used from the **account page** and goes **directly to generation/download**.

**Conclusion:** Moon calendar for a Pro user is **account page → Download Moon Phases → POST /api/downloads/moon → download**. No plan modal, no checkout.

---

## 4. Is the UI intentionally hiding Pro purchase options for active subscribers?

**Yes, by flow design (no explicit “hide” needed).**

- **Plan modal and upsell modal** are only shown when **`openPlanModal()`** is called and the user is **not** `unlimited` (or when entitlements fail and code falls back to showing the plan modal).
- For a **Pro user** (`unlimited === true`):
  - **Tide:** `handleDownloadClick` never calls `openPlanModal()`; it redirects to `/dlFile.html`.
  - **Golden Hour:** `openPlanModal()` is called, but at the start it checks `if (unlimited)` and then either calls `generateGoldenHourProAndDownload()` or redirects to dlFile; it **returns without ever showing** the plan or upsell modal.
- So Pro users **do not see** the "Choose Your Plan" modal (Single vs Go Pro) or the "Upgrade to Pro!" upsell modal when they use the normal flows above. The Pro **purchase** options (Choose Unlimited, Upgrade to Pro) live inside those modals, so they are **not shown** to Pro users.

**Hero / marketing:** The hero text "or GO PRO for Unlimited Locations, Moon Phases, and Golden Hour" is **always visible** to everyone (no conditional hiding). It’s marketing, not a purchase button. There is no code that hides it for Pro users.

**Summary:** The app does **not** add a separate “Pro purchase” option for logged-in Pro users. Pro options appear only in the plan/upsell modals, which are only shown to non-Pro users when they try to download. For Pro users, the flows above bypass those modals and go straight to generation/download. So the current UI is **intentionally** not showing Pro purchase options to active subscribers, because those users never enter the flows that open the plan or upsell modals.

---

## 5. Live verification (logged-in Pro user)

To confirm that **none** of the three flows route to checkout or a plan modal with a real Pro account, run (server must be running):

```bash
PRO_USER_EMAIL=your-pro@example.com PRO_USER_PASSWORD=yourpassword node scripts/verify-pro-flows.js
```

Optional: `BASE_URL=http://localhost:3000` (default) or your app URL.

The script: logs in → GET entitlements (asserts `unlimited === true`) → POST tide generate → POST golden → POST moon. Each download must return **200**; any **403** means that flow would be blocked or show checkout.

If all steps pass: **Normal tide**, **Golden Hour**, and **Moon from account** all bypass checkout and plan modal (APIs return 200; front end uses the same endpoints and never opens the modals when `unlimited` is true).
