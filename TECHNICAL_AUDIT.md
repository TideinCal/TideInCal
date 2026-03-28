# Technical Audit: CalendarWaves Codebase

## SECTION 1: What Already Exists

### Authentication and Sessions

**File:** `server/auth/index.js`
- **Purpose:** Core authentication utilities (password hashing, verification, user attachment middleware, auth requirement)
- **Status:** ✅ **COMPLETE**
- **Details:**
  - Uses argon2 for password hashing
  - `attachUser` middleware loads user from session
  - `requireAuth` middleware enforces authentication
  - Zod schemas for signup/login validation

**File:** `server.js` (lines 12-13, 107-207)
- **Purpose:** Express session configuration with MongoDB store
- **Status:** ✅ **COMPLETE**
- **Details:**
  - Uses `express-session` with `connect-mongo` store
  - Session stored in MongoDB collection `sessions`
  - TTL: 14 days
  - Secure cookies in production
  - Session middleware applied after DB connection

**File:** `server/routes/auth.js`
- **Purpose:** Authentication routes (signup, login, logout, user info, entitlements, purchases)
- **Status:** ✅ **COMPLETE**
- **Details:**
  - `POST /api/auth/signup` - Creates user account, sets session
  - `POST /api/auth/login` - Authenticates user, sets session
  - `POST /api/auth/logout` - Destroys session
  - `GET /api/auth/me` - Returns current user (requires auth)
  - `GET /api/auth/me/entitlements` - Returns user entitlements (unlimited flag, entitlements array)
  - `GET /api/auth/me/purchases` - Returns user's purchase history

**File:** `public/js/main.js` (lines 29-265)
- **Purpose:** Frontend authentication UI management
- **Status:** ✅ **COMPLETE**
- **Details:**
  - Auth modal with signup/login tabs
  - Auth state refresh on page load
  - Navigation UI updates based on auth state
  - Handles auth before checkout flow

### Login or Register Routes

**File:** `server/routes/auth.js`
- **Purpose:** User registration and login endpoints
- **Status:** ✅ **COMPLETE**
- **Details:**
  - Signup creates user with hashed password
  - Login verifies credentials
  - Both set `req.session.userId`
  - Returns user object (without password hash)

### Stripe Checkout Implementation

**File:** `server/routes/checkout.js`
- **Purpose:** Creates Stripe checkout sessions
- **Status:** ✅ **COMPLETE** (with partial logic for unlimited users)
- **Details:**
  - `POST /api/checkout/session` - Creates Stripe checkout session
  - Supports two plans: `single` ($5 one-time) and `unlimited` ($29 one-time)
  - For unlimited users requesting single station: processes free download immediately
  - Validates plan and station data with Zod
  - Sets metadata (plan, userId, station info)
  - Success URL: `${APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`
  - Cancel URL: `${APP_URL}/`
  - Rate limited (5 in prod, 50 in dev per 15 min)

**File:** `public/js/main.js` (lines 411-526)
- **Purpose:** Frontend checkout flow
- **Status:** ✅ **COMPLETE**
- **Details:**
  - Plan chooser modal (single vs unlimited)
  - Unlimited user modal (free downloads)
  - Calls `/api/checkout/session` and redirects to Stripe

### Stripe Success and Cancel Handling

**File:** `server/routes/checkout.js` (line 123-124)
- **Purpose:** Stripe redirect URLs configured
- **Status:** ⚠️ **PARTIAL**
- **Details:**
  - Success URL configured: `/success?session_id={CHECKOUT_SESSION_ID}`
  - Cancel URL configured: `/` (home page)
  - **MISSING:** No `/success` route handler exists in `server.js`
  - **MISSING:** No success page HTML file exists

**File:** `server/routes/webhook.js`
- **Purpose:** Handles Stripe webhook events
- **Status:** ✅ **COMPLETE**
- **Details:**
  - Mounted at `/api/stripe/webhook` with raw body parser
  - Verifies webhook signature
  - Handles `checkout.session.completed` event
  - Calls `checkoutCompleted` service

### Database Models and Schemas

**File:** `server/db/index.js`
- **Purpose:** MongoDB connection and index creation
- **Status:** ✅ **COMPLETE**
- **Details:**
  - Connects to MongoDB Atlas
  - Creates indexes on startup:
    - `users.email` (unique)
    - `files.retainUntil` (TTL index, expires after 0 seconds when date reached)
    - `files.userId` (for efficient queries)
    - `purchases.userId` (for efficient queries)

**File:** `scripts/ensure-indexes.js`
- **Purpose:** Standalone script to ensure database indexes
- **Status:** ✅ **COMPLETE**
- **Details:**
  - Creates all required indexes
  - Includes `purchases.stripeSessionId` unique index

### User or Customer Tables

**Collection:** `users`
- **Schema (inferred from code):**
  ```javascript
  {
    _id: ObjectId,
    email: String (unique, indexed),
    passwordHash: String,
    firstName: String?,
    lastName: String?,
    emailVerifiedAt: Date?,
    stripeCustomerId: String?,
    unlimited: Boolean (default: false),
    unlimitedSince: Date?,
    entitlements: Array<{
      stationId: String,
      stationTitle: String,
      region: String,
      retainUntil: Date
    }>,
    billingName: String?,
    billingAddress: Object?,
    createdAt: Date,
    updatedAt: Date
  }
  ```
- **Status:** ✅ **COMPLETE**
- **File:** `server/routes/auth.js` (lines 35-46) - User creation
- **File:** `server/services/checkoutCompleted.js` (lines 38-56) - User updates with Stripe data

### Purchase or Order Records

**Collection:** `purchases`
- **Schema (inferred from code):**
  ```javascript
  {
    _id: ObjectId,
    userId: ObjectId (indexed),
    stripeSessionId: String (unique, indexed),
    stripePaymentIntentId: String?,
    product: String ('single' | 'unlimited'),
    amount: Number,
    currency: String,
    customerEmail: String?,
    metadata: {
      stationId: String?,
      stationTitle: String?,
      country: String?,
      plan: String,
      freeForUnlimited: Boolean?
    },
    customerDetails: {
      name: String?,
      address: Object?
    }?,
    createdAt: Date
  }
  ```
- **Status:** ✅ **COMPLETE**
- **File:** `server/services/checkoutCompleted.js` (lines 59-87) - Purchase record creation

**Collection:** `files`
- **Schema (inferred from code):**
  ```javascript
  {
    _id: ObjectId,
    userId: ObjectId (indexed),
    stationId: String,
    stationTitle: String,
    region: String,
    includesMoon: Boolean,
    fileName: String,
    storagePath: String,
    createdAt: Date,
    retainUntil: Date (TTL indexed),
    lastDownloadedAt: Date?
  }
  ```
- **Status:** ✅ **COMPLETE**
- **File:** `server/services/checkoutCompleted.js` (lines 127-139) - File record creation

### ICS Generation Logic

**File:** `server/ics/index.js`
- **Purpose:** Generates ICS calendar files from tide data
- **Status:** ⚠️ **PARTIAL** (placeholder implementation)
- **Details:**
  - Uses `ics` library to create calendar events
  - Has placeholder `fetchTideData` function (currently uses mock data)
  - Supports moon phase events (optional)
  - **MISSING:** Actual integration with NOAA/DFO tide APIs
  - **MISSING:** Timezone handling
  - **MISSING:** Full year data generation

**File:** `server.js` (lines 270-361)
- **Purpose:** Legacy ICS generation function
- **Status:** ✅ **COMPLETE** (but separate from new flow)
- **Details:**
  - `getYearData` function generates ICS for one year
  - Fetches from NOAA (USA) or DFO (Canada) APIs
  - Handles timezone conversion
  - Creates ICS file in `tempICSFile/` directory

**File:** `server/services/checkoutCompleted.js` (lines 107-113)
- **Purpose:** Calls ICS generation service
- **Status:** ✅ **COMPLETE** (but service needs implementation)
- **Details:**
  - Imports and calls `generateICS` from `server/ics/index.js`
  - Saves file to `tempICSFile/` directory
  - Creates file record in database

### Dashboard or Profile Routes

**File:** `server.js` (line 233-235)
- **Purpose:** Account page route
- **Status:** ✅ **COMPLETE**
- **Details:**
  - `GET /account` - Serves `public/account.html`

**File:** `public/account.html`
- **Purpose:** Account dashboard UI
- **Status:** ✅ **COMPLETE**
- **Details:**
  - Shows subscription status
  - Lists user's files with expiration dates
  - Download buttons for each file
  - Logout functionality

**File:** `public/js/account.js`
- **Purpose:** Account page JavaScript
- **Status:** ✅ **COMPLETE**
- **Details:**
  - Loads subscription info from `/api/auth/me/entitlements`
  - Loads files from `/api/files`
  - Displays file expiration status
  - Handles logout

**File:** `server/routes/files.js`
- **Purpose:** File management routes
- **Status:** ✅ **COMPLETE**
- **Details:**
  - `GET /api/files` - Lists user's files (requires auth)
  - `GET /api/files/:id/download` - Downloads file (requires auth + ownership verification)
  - Enforces file ownership
  - Updates `lastDownloadedAt` timestamp

### Environment Variables Related to Stripe or Auth

**File:** `server/bootstrap/envGuard.js`
- **Purpose:** Validates required environment variables
- **Status:** ✅ **COMPLETE**
- **Details:**
  - Validates `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` on startup

**Environment Variables (inferred from code):**
- ✅ `STRIPE_SECRET_KEY` - Stripe API secret key
- ✅ `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret
- ✅ `STRIPE_PRICE_SINGLE` - Stripe price ID for single station ($5)
- ✅ `STRIPE_PRICE_UNLIMITED` - Stripe price ID for unlimited ($29)
- ✅ `SESSION_SECRET` - Session encryption secret
- ✅ `MONGO_URI` - MongoDB connection string
- ✅ `APP_URL` - Application base URL
- ✅ `RESEND_API_KEY` - Resend email API key
- ⚠️ `MOCK_EMAILS` - Optional flag to skip email sending (for testing)

---

## SECTION 2: What is Missing or Incomplete

### Account Creation Before Payment

**Status:** ⚠️ **PARTIAL**
- **What exists:**
  - User can sign up before checkout
  - Auth modal appears if user not logged in when clicking download
  - After signup/login, plan chooser modal appears
- **What's missing:**
  - No explicit enforcement that account must exist before payment
  - Checkout route requires auth (`requireAuth` middleware), but no explicit messaging about account requirement
  - No redirect to signup if user tries to checkout without account

### Linking Stripe Payments to Internal Users

**Status:** ✅ **COMPLETE** (for new flow)
- **What exists:**
  - `userId` stored in Stripe session metadata
  - Webhook handler extracts `userId` from metadata
  - User record updated with `stripeCustomerId`
  - Purchase record linked to user via `userId`
- **What's missing:**
  - No handling for existing Stripe customers (if user already has `stripeCustomerId`, should reuse it)
  - No handling for guest checkout scenarios (if they exist)

### Distinguishing One Time Purchases vs Subscriptions

**Status:** ⚠️ **INCOMPLETE**
- **What exists:**
  - Checkout session uses `mode: 'payment'` for single, `mode: 'subscription'` for unlimited
  - Purchase record stores `product: 'single' | 'unlimited'`
  - User record has `unlimited: true` flag
- **What's missing:**
  - **CRITICAL:** Unlimited plan is configured as `subscription` mode but priced as one-time ($29)
  - No subscription management (renewal, cancellation, status checks)
  - No webhook handlers for subscription events (`customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`)
  - No distinction in database between one-time purchases and recurring subscriptions
  - Unlimited plan should be one-time payment, not subscription

### Purchase Expiration Logic One Year From Purchase

**Status:** ✅ **COMPLETE** (for files)
- **What exists:**
  - Files have `retainUntil` field set to 365 days from creation
  - TTL index on `retainUntil` automatically deletes expired files
  - Frontend shows expiration countdown
- **What's missing:**
  - No expiration logic for entitlements array in user document
  - Entitlements are updated but never cleaned up when expired
  - No validation that file is still valid when downloading (relies on TTL only)

### Subscription Active Period Enforcement

**Status:** ❌ **MISSING**
- **What exists:**
  - `unlimited` flag on user record
  - `unlimitedSince` timestamp
- **What's missing:**
  - No expiration date for unlimited subscription
  - No validation that unlimited subscription is still active
  - No webhook handler for subscription renewal/cancellation
  - No logic to check if subscription is still valid in Stripe
  - Unlimited users can access forever (no time limit)

### Dashboard Regeneration of ICS Files

**Status:** ❌ **MISSING**
- **What exists:**
  - Dashboard shows list of files
  - Download links for existing files
- **What's missing:**
  - No "Regenerate" button on dashboard
  - No endpoint to regenerate ICS file for existing purchase
  - No logic to create new file record when regenerating
  - No handling for expired files (user can't regenerate)

### Upsell Logic Before Second One Time Purchase

**Status:** ❌ **MISSING**
- **What exists:**
  - Plan chooser modal shows single vs unlimited
  - User entitlements endpoint returns list of purchased stations
- **What's missing:**
  - No check for existing single purchases before showing plan chooser
  - No modal/upsell suggesting unlimited plan if user has 2+ single purchases
  - No logic to count existing single purchases
  - No special messaging for users with multiple single purchases

### Server Side Authorization Enforcement for Downloads

**Status:** ✅ **COMPLETE**
- **What exists:**
  - `GET /api/files/:id/download` requires authentication (`requireAuth` middleware)
  - Verifies file ownership (`userId` match)
  - Returns 404 if file not found or user doesn't own it
- **What's missing:**
  - No check for file expiration before download (relies on TTL deletion)
  - No check for unlimited subscription validity
  - No rate limiting on downloads

### Additional Missing Features

1. **Success Page Route**
   - Success URL configured but no route handler exists
   - No `GET /success` route in `server.js`
   - No `public/success.html` file

2. **ICS Generation Service**
   - `server/ics/index.js` has placeholder implementation
   - Uses mock data instead of real API calls
   - Doesn't match the logic in legacy `getYearData` function

3. **Email Integration**
   - Welcome email function exists but not called on signup
   - Download ready email sent after purchase (good)
   - No email for subscription expiration warnings

4. **Subscription Webhook Handlers**
   - Only handles `checkout.session.completed`
   - Missing: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`

5. **Purchase History**
   - Endpoint exists but no UI to display it
   - No filtering or pagination

6. **File Regeneration**
   - No way to regenerate expired files
   - No way to update files with new data

---

## SECTION 3: Safe Implementation Plan

### Phase 1: Fix Critical Issues (Do First)

#### 1.1 Fix Unlimited Plan Configuration
**Files to modify:**
- `server/routes/checkout.js` (line 119)
- **Change:** Set `mode: 'payment'` for unlimited plan (not 'subscription')
- **Reason:** Unlimited is one-time payment, not recurring subscription

#### 1.2 Implement Success Page
**Files to create:**
- `public/success.html` - Success page with download link
- **Files to modify:**
- `server.js` - Add `GET /success` route handler
- **Details:**
  - Extract `session_id` from query params
  - Verify session exists in Stripe
  - Show success message
  - Provide link to account page or direct download

#### 1.3 Complete ICS Generation Service
**Files to modify:**
- `server/ics/index.js`
- **Changes:**
  - Replace mock data with real API calls (use logic from `server.js` `getYearData`)
  - Support both USA (NOAA) and Canada (DFO) APIs
  - Handle timezone conversion properly
  - Generate full year of data
  - Support `includeMoon` parameter

### Phase 2: Account and Purchase Flow Enhancements

#### 2.1 Enforce Account Creation Before Payment
**Files to modify:**
- `public/js/main.js` (lines 377-406)
- **Changes:**
  - Ensure auth modal always shows before plan chooser
  - Add explicit messaging: "Create account to purchase"
  - No changes needed to backend (already requires auth)

#### 2.2 Link Existing Stripe Customers
**Files to modify:**
- `server/routes/checkout.js` (line 111)
- **Changes:**
  - Check if user has `stripeCustomerId`
  - If exists, pass `customer: user.stripeCustomerId` to session creation
  - If not, let Stripe create new customer

#### 2.3 Fix Unlimited Plan as One-Time Payment
**Files to modify:**
- `server/routes/checkout.js` (line 119)
- **Changes:**
  - Change `mode: plan === 'unlimited' ? 'subscription' : 'payment'` to `mode: 'payment'` for both
  - Update Stripe product to be one-time payment (not subscription)
  - Remove subscription-related webhook handlers (not needed)

### Phase 3: Purchase Expiration and Entitlements

#### 3.1 Clean Up Expired Entitlements
**Files to modify:**
- `server/routes/auth.js` (line 135-142)
- **Changes:**
  - Filter out expired entitlements before returning
  - Add cron job or middleware to clean up expired entitlements periodically
- **Files to create:**
- `server/services/cleanupExpiredEntitlements.js` - Service to remove expired entitlements

#### 3.2 Validate File Expiration on Download
**Files to modify:**
- `server/routes/files.js` (line 68-122)
- **Changes:**
  - Check `retainUntil` date before allowing download
  - Return 410 Gone if file expired
  - Show expiration message to user

#### 3.3 Add Purchase Expiration to Entitlements
**Files to modify:**
- `server/services/checkoutCompleted.js` (line 142-159)
- **Changes:**
  - Ensure `retainUntil` is set correctly (365 days from purchase)
  - Add validation that entitlement hasn't expired

### Phase 4: Dashboard Regeneration

#### 4.1 Add Regenerate Endpoint
**Files to create:**
- `server/routes/files.js` - Add new route (or modify existing)
- **New route:**
  - `POST /api/files/:id/regenerate` - Regenerates ICS file for existing purchase
- **Files to modify:**
- `server/services/checkoutCompleted.js` - Extract ICS generation logic to reusable function
- **Details:**
  - Verify user owns the file
  - Check if purchase is still valid (not expired)
  - Generate new ICS file
  - Update file record or create new one
  - Send email notification

#### 4.2 Add Regenerate UI
**Files to modify:**
- `public/account.html` - Add "Regenerate" button to file table
- `public/js/account.js` - Add regenerate handler
- **Details:**
  - Show regenerate button for each file
  - Call regenerate endpoint
  - Show loading state
  - Update file list after regeneration

### Phase 5: Upsell Logic

#### 5.1 Count Existing Single Purchases
**Files to modify:**
- `public/js/main.js` (line 412-461)
- **Changes:**
  - Before showing plan chooser, fetch user entitlements
  - Count number of single purchases
  - If count >= 2, show upsell modal first
- **Files to create:**
- `public/js/upsellModal.js` - Upsell modal component (or add to existing modal)

#### 5.2 Upsell Modal Content
**Files to modify:**
- `public/index.html` - Add upsell modal HTML
- **Details:**
  - "You've purchased 2+ stations. Upgrade to unlimited for $X more!"
  - Show savings calculation
  - Button to upgrade to unlimited
  - Button to continue with single purchase

### Phase 6: Subscription Management (If Needed)

**Note:** Only implement if unlimited plan becomes a true subscription later.

#### 6.1 Subscription Webhook Handlers
**Files to modify:**
- `server/routes/webhook.js`
- **Add handlers for:**
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`

#### 6.2 Subscription Status Checks
**Files to modify:**
- `server/routes/auth.js` (line 135-142)
- **Changes:**
  - Query Stripe API to verify subscription is active
  - Update `unlimited` flag based on subscription status
  - Handle expired/cancelled subscriptions

### Phase 7: Additional Enhancements

#### 7.1 Welcome Email on Signup
**Files to modify:**
- `server/routes/auth.js` (line 60)
- **Changes:**
  - After successful signup, call `sendWelcome` from `server/auth/email.js`
  - Handle email errors gracefully (don't fail signup if email fails)

#### 7.2 Purchase History UI
**Files to modify:**
- `public/account.html` - Add purchase history section
- `public/js/account.js` - Add function to load and display purchases
- **Details:**
  - Show list of all purchases
  - Display purchase date, amount, product type
  - Link to associated files

#### 7.3 File Download Rate Limiting
**Files to modify:**
- `server.js` - Add rate limiter for file downloads
- `server/routes/files.js` - Apply rate limiter to download route
- **Details:**
  - Limit to 10 downloads per 15 minutes per user
  - Prevent abuse

---

## Checklist of Questions/Confirmations Needed

### Critical Decisions

1. **Unlimited Plan Type:**
   - [ ] Confirm: Should unlimited plan be one-time payment ($29) or recurring subscription?
   - [ ] If one-time: Does it expire after 1 year, or is it lifetime?
   - [ ] If subscription: What's the billing cycle (monthly/yearly)?

2. **Purchase Expiration:**
   - [ ] Confirm: Single purchases expire after 365 days - is this correct?
   - [ ] Should users be able to regenerate expired files, or must they repurchase?
   - [ ] Should entitlements array be cleaned up when files expire?

3. **Upsell Logic:**
   - [ ] At how many single purchases should we show upsell? (Suggested: 2)
   - [ ] What's the upsell message? (e.g., "You've spent $10 on 2 stations. Upgrade to unlimited for $19 more!")
   - [ ] Should upsell be shown every time, or only once?

4. **Success Page:**
   - [ ] What should success page show? (Download link, account link, both?)
   - [ ] Should it auto-redirect to account page after X seconds?
   - [ ] Should it show purchase details?

5. **ICS Generation:**
   - [ ] Should we use the existing `getYearData` logic from `server.js`, or rewrite in `server/ics/index.js`?
   - [ ] What timezone should be used? (User's browser timezone, station timezone, UTC?)
   - [ ] Should moon phases be included by default, or as optional addon?

6. **File Regeneration:**
   - [ ] Can users regenerate files for free, or is there a cost?
   - [ ] Should regeneration create a new file or replace the existing one?
   - [ ] Should regeneration extend the expiration date?

7. **Account Requirements:**
   - [ ] Should account creation be mandatory before any purchase?
   - [ ] Should we allow guest checkout (create account after payment)?
   - [ ] What information is required at signup? (Currently: email, password, optional name)

8. **Subscription Management:**
   - [ ] If unlimited becomes subscription: How to handle cancellations?
   - [ ] Should cancelled subscribers lose access immediately or at period end?
   - [ ] Should we send expiration warnings (e.g., 7 days before)?

9. **Email Notifications:**
   - [ ] Should welcome email be sent on signup? (Currently not sent)
   - [ ] Should we send purchase confirmation emails? (Currently sent for downloads)
   - [ ] Should we send subscription renewal reminders?

10. **Error Handling:**
    - [ ] What should happen if ICS generation fails during checkout?
    - [ ] Should we retry failed generations automatically?
    - [ ] How should we notify users of generation failures?

### Technical Preferences

11. **Code Organization:**
    - [ ] Should we keep legacy `getYearData` function or migrate everything to `server/ics/index.js`?
    - [ ] Should we create a separate service for file regeneration, or add to existing service?

12. **Database:**
    - [ ] Should we add indexes for any new queries?
    - [ ] Should we archive expired purchases or delete them?

13. **Testing:**
    - [ ] Do you want tests written for new features?
    - [ ] Should we add integration tests for the full checkout flow?

---

## Summary

### What Works Well
- ✅ Authentication system is complete and secure
- ✅ Stripe checkout integration is functional
- ✅ Database schema is well-designed
- ✅ File download authorization is enforced
- ✅ Session management is robust

### What Needs Attention
- ⚠️ Unlimited plan configured as subscription but should be one-time
- ⚠️ Success page route is missing
- ⚠️ ICS generation service needs real implementation
- ⚠️ Entitlements cleanup logic is missing
- ⚠️ Upsell logic is missing

### Implementation Priority
1. **High Priority:** Fix unlimited plan mode, implement success page, complete ICS generation
2. **Medium Priority:** Entitlements cleanup, file regeneration, upsell logic
3. **Low Priority:** Purchase history UI, email enhancements, rate limiting

---

**End of Technical Audit**

