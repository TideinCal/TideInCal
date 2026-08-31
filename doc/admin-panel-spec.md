# TideInCal Admin Panel Spec

## Purpose

Build a secure internal admin panel for TideInCal so the owner can quickly search users, inspect purchases and subscriptions, view entitlements, review failed payments and cancellations, and perform limited manual support actions without touching the database directly.

This spec is meant to be handed to Cursor. The implementation must follow this document closely and avoid inventing extra systems that are not listed here.

---

# 1. Product Goal

The admin panel exists to solve support and operational problems.

When a customer emails support, the owner should be able to answer these questions in under 30 seconds:

1. Who is this customer?
2. What did they buy?
3. What access do they currently have?
4. Did they cancel?
5. Did payment fail?
6. Has anything been refunded or disputed?
7. Do I need to manually fix access?

The panel is for internal use only.

---

# 2. Existing Product Context

This spec assumes TideInCal already has:

1. User accounts with session based authentication
2. Stripe checkout flows
3. One time purchases
4. Subscription purchases
5. Customer self cancellation from the account page
6. Entitlement based access to downloads
7. Stripe webhook processing
8. Download generation for tide calendars and related add ons

This panel must integrate with the existing Express and MongoDB application structure.

---

# 3. Admin Panel Outcomes

The panel must allow the owner to:

1. Search and inspect any customer
2. View purchase history in one place
3. View subscription state in one place
4. View all active and expired entitlements
5. Review cancellations and failed payments
6. Add internal notes to a user
7. Perform safe manual support actions
8. Keep an audit trail of every admin action
9. Re sync Stripe state when needed

---

# 4. Scope for Version 1

Version 1 must include the following areas:

## 4.1 Admin Dashboard

A dashboard with summary cards and recent issue queues.

Required summary cards:

1. Total users
2. Active subscribers
3. Customers with failed payments
4. Cancels this month
5. Refunds this month
6. Recent support actions

Required issue lists:

1. Recent cancellations
2. Recent failed payments
3. Recent refunds or disputes if available
4. Recent manual entitlement changes

## 4.2 Customer Search and Directory

A page where the owner can search customers by:

1. Email
2. Name
3. User ID
4. Stripe customer ID
5. Purchase ID
6. Subscription ID

Search results should show:

1. Name
2. Email
3. User ID
4. Stripe customer ID if present
5. Current account status
6. Active subscription status
7. Date created

## 4.3 Customer Detail Page

A single page with tabs or sections for the selected customer.

Required sections:

1. Account overview
2. Purchases
3. Subscription
4. Entitlements
5. Download history
6. Internal notes
7. Audit log relating to this user

## 4.4 Purchase History View

For each customer, show a purchase timeline.

Each purchase record should show:

1. Purchase date
2. Purchase type
3. Product name or internal product type
4. Amount paid
5. Currency
6. Purchase status
7. Stripe checkout session ID if available
8. Stripe payment intent or invoice ID if available
9. Refund status
10. Related entitlements created from the purchase

## 4.5 Subscription View

For each subscription customer, show:

1. Current plan
2. Stripe subscription ID
3. Status
4. Current period start
5. Current period end
6. cancelAtPeriodEnd value
7. canceledAt if present
8. endedAt if present
9. Last invoice status if available
10. Last failed payment status if available
11. Subscription source and notes if relevant

## 4.6 Entitlements View

Show every entitlement for the user.

Each entitlement should show:

1. Entitlement type
2. Related station ID or location data if relevant
3. Source type such as one time purchase, subscription, admin grant
4. Source purchase ID or source subscription ID if relevant
5. Start date
6. End date
7. Status such as active, expired, revoked
8. Created by
9. Updated by
10. Admin reason if manually changed

## 4.7 Internal Notes

Allow the admin to create support notes on the user.

Each note must include:

1. Note text
2. Admin user ID
3. Created date
4. Updated date if edited later

## 4.8 Manual Support Actions

Safe manual actions must be supported from the customer page.

Required admin actions for version 1:

1. Add internal note
2. Grant an entitlement manually
3. Extend an entitlement end date
4. Revoke an entitlement
5. Trigger Stripe re sync for the user
6. Mark a user for review

All manual actions must write to the admin audit log.

## 4.9 Cancellations Queue

A page or filtered view showing customers who cancelled.

Each entry should show:

1. Customer name
2. Email
3. Plan
4. Status
5. cancelAtPeriodEnd
6. Access end date
7. Cancellation date
8. Cancellation reason if collected
9. Lifetime purchase count or value if available

## 4.10 Failed Payments Queue

A page or filtered view showing payment problems.

Each entry should show:

1. Customer name
2. Email
3. Plan
4. Failure date
5. Failure reason if available from Stripe
6. Invoice status if available
7. Subscription status
8. Whether access is still active
9. Last successful payment date if available

---

# 5. Out of Scope for Version 1

Do not build these in version 1 unless explicitly requested later:

1. Full customer messaging inside admin
2. Full refund issuing from admin
3. Full dispute handling workflow
4. Multi admin teams with role hierarchies beyond owner or admin
5. CSV exports
6. Analytics charts beyond simple summary cards
7. Account deletion from admin
8. Password editing directly from admin
9. One click impersonation login
10. Coupon management

---

# 6. Admin Panel Map

## 6.1 Route Map

### Public App Routes

These already exist and are not part of the admin build except where integration is required.

1. Account page
2. Checkout flows
3. Download flows
4. Customer self cancellation flow

### New Admin Routes

All admin routes must require authenticated admin access.

1. `/admin`

   * dashboard
2. `/admin/customers`

   * customer search and directory
3. `/admin/customers/:userId`

   * customer detail page
4. `/admin/cancellations`

   * cancellations queue
5. `/admin/failed-payments`

   * failed payments queue
6. `/admin/audit-log`

   * recent admin actions

Optional future route:
7. `/admin/refunds`

* only if refund data is already easy to surface

## 6.2 API Route Map

All admin API routes must be protected on the server.

Namespace suggestion:

`/api/admin/*`

Required endpoints:

### Dashboard

1. `GET /api/admin/dashboard`

   * Returns counts and recent issue lists

### Customer search

2. `GET /api/admin/customers?query=`

   * Search customers by email, name, user ID, Stripe customer ID, purchase ID, or subscription ID

### Customer detail

3. `GET /api/admin/customers/:userId`

   * Returns account overview, purchases, subscription, entitlements, notes, and recent audit items

### Notes

4. `POST /api/admin/customers/:userId/notes`

   * Create a support note

### Entitlements

5. `POST /api/admin/customers/:userId/entitlements/grant`

   * Grant a new entitlement
6. `POST /api/admin/customers/:userId/entitlements/:entitlementId/extend`

   * Extend end date
7. `POST /api/admin/customers/:userId/entitlements/:entitlementId/revoke`

   * Revoke entitlement

### Flags and re sync

8. `POST /api/admin/customers/:userId/mark-for-review`

   * Mark customer for review
9. `POST /api/admin/customers/:userId/resync-stripe`

   * Pull fresh Stripe data for that customer and reconcile local state

### Queues

10. `GET /api/admin/cancellations`
11. `GET /api/admin/failed-payments`
12. `GET /api/admin/audit-log`

---

# 7. UI Structure

## 7.1 Admin Dashboard Layout

Use a simple internal layout.

Suggested sections:

1. Top nav or sidebar with links to dashboard, customers, cancellations, failed payments, audit log
2. Summary cards row
3. Recent cancellations list
4. Recent failed payments list
5. Recent admin actions list

This does not need marketing design polish. It must be fast, clear, and dependable.

## 7.2 Customer Detail Layout

Suggested section order:

1. Header with name, email, user ID, Stripe customer ID, account status
2. Quick action buttons
3. Subscription card
4. Entitlements table
5. Purchases timeline or table
6. Download history table
7. Internal notes area
8. Audit log area

### Quick action buttons for version 1

1. Add note
2. Grant entitlement
3. Extend entitlement
4. Revoke entitlement
5. Re sync Stripe
6. Mark for review

---

# 8. Required Data Model Additions

This section defines the minimum data support needed for the panel.

## 8.1 Users collection

Ensure the user model supports these fields if not already present:

1. `_id`
2. `name`
3. `email`
4. `role`
5. `stripeCustomerId`
6. `accountStatus`
7. `markedForReview`
8. `createdAt`
9. `updatedAt`
10. `lastLoginAt` if available

Suggested accountStatus values:

1. active
2. flagged
3. disabled
4. deleted or soft deleted if used

## 8.2 Purchases collection

Ensure purchase records support:

1. `_id`
2. `userId`
3. `productType`
4. `planType`
5. `amount`
6. `currency`
7. `status`
8. `stripeCheckoutSessionId`
9. `stripePaymentIntentId`
10. `stripeInvoiceId`
11. `stripeSubscriptionId` if related to a subscription
12. `refundedAmount`
13. `createdAt`
14. `updatedAt`

Suggested status values:

1. paid
2. failed
3. refunded
4. partially_refunded
5. disputed
6. expired
7. pending

## 8.3 Subscriptions collection

If a separate subscription collection exists, ensure it supports:

1. `_id`
2. `userId`
3. `stripeSubscriptionId`
4. `stripeCustomerId`
5. `plan`
6. `status`
7. `currentPeriodStart`
8. `currentPeriodEnd`
9. `cancelAtPeriodEnd`
10. `canceledAt`
11. `endedAt`
12. `latestInvoiceId`
13. `lastPaymentStatus`
14. `lastFailureReason`
15. `createdAt`
16. `updatedAt`

Suggested status values:

1. active
2. trialing
3. past_due
4. unpaid
5. canceled
6. incomplete
7. incomplete_expired

## 8.4 Entitlements collection

Entitlements are central to support and must be clearly tracked.

Required fields:

1. `_id`
2. `userId`
3. `entitlementType`
4. `status`
5. `sourceType`
6. `sourcePurchaseId`
7. `sourceSubscriptionId`
8. `stationId` if tide related
9. `locationLabel` if custom location based
10. `locationLat`
11. `locationLng`
12. `startsAt`
13. `endsAt`
14. `createdBy`
15. `updatedBy`
16. `adminReason`
17. `createdAt`
18. `updatedAt`

Suggested entitlementType values:

1. tide_station_access
2. pro_subscription_access
3. moon_access
4. golden_hour_access

Suggested sourceType values:

1. one_time_purchase
2. subscription
3. admin_manual
4. migration
5. recovery

Suggested status values:

1. active
2. expired
3. revoked
4. pending

## 8.5 Admin notes collection

Create a dedicated collection for internal notes.

Required fields:

1. `_id`
2. `userId`
3. `note`
4. `createdBy`
5. `updatedBy`
6. `createdAt`
7. `updatedAt`

## 8.6 Admin audit log collection

Create a dedicated audit log collection.

Required fields:

1. `_id`
2. `adminUserId`
3. `targetUserId`
4. `actionType`
5. `entityType`
6. `entityId`
7. `oldValue`
8. `newValue`
9. `reason`
10. `metadata`
11. `createdAt`

Suggested actionType values:

1. note_created
2. entitlement_granted
3. entitlement_extended
4. entitlement_revoked
5. stripe_resynced
6. customer_marked_for_review
7. customer_unmarked_for_review

---

# 9. Permissions and Security

This panel controls customer access and payment related state, so security is mandatory.

## 9.1 Server side admin authorization

Every admin route and admin API route must verify:

1. The requester is authenticated
2. The requester has role `admin` or equivalent

Frontend hiding is not sufficient.

## 9.2 CSRF

Apply CSRF protection to admin write routes.

## 9.3 Session security

Continue using the existing session based auth system. Do not create a separate weaker admin auth flow.

## 9.4 Input validation

All admin write actions must validate input carefully.

Examples:

1. Entitlement dates must be valid dates
2. Entitlement type must be an allowed enum
3. Notes must be strings with length limits
4. Revoke and extend actions must validate the target entitlement exists and belongs to the target user

## 9.5 Audit log requirement

Every admin write action must record an audit log entry.

This is not optional.

---

# 10. Manual Support Actions Requirements

## 10.1 Grant entitlement

The admin must be able to create a new entitlement manually.

Required inputs:

1. entitlementType
2. startsAt
3. endsAt
4. stationId or location details if needed by the entitlement type
5. reason

Behavior:

1. Validate required fields by entitlement type
2. Save entitlement with sourceType `admin_manual`
3. Save createdBy and updatedBy from the admin user
4. Write audit log

## 10.2 Extend entitlement

The admin must be able to extend an entitlement end date.

Required inputs:

1. new endsAt date
2. reason

Behavior:

1. Record old end date
2. Update endsAt
3. Save updatedBy
4. Write audit log with oldValue and newValue

## 10.3 Revoke entitlement

The admin must be able to revoke an entitlement.

Required inputs:

1. reason

Behavior:

1. Set status to revoked
2. Save updatedBy
3. Optionally set endsAt to current timestamp if that matches current business rules
4. Write audit log

## 10.4 Re sync Stripe

The admin must be able to manually trigger a re sync for a customer.

Behavior:

1. Pull current Stripe customer, subscriptions, invoices, and recent relevant payment state
2. Reconcile local subscription fields
3. Do not blindly overwrite unrelated local data
4. Log what changed in the audit log

## 10.5 Mark for review

The admin must be able to flag a customer.

Behavior:

1. Set `markedForReview` true on user
2. Log the change

---

# 11. Cancellations and Failed Payments

This section is essential because these are common support cases.

## 11.1 Cancellation data

If the self cancellation flow currently stores cancellation reason, surface it in admin.

If it does not yet store reason, add support for it if simple to do. Suggested reason options:

1. Too expensive
2. Only needed it once
3. Missing features
4. Technical issues
5. Using another tool
6. Temporary pause
7. Other

Optional free text comment can be added later.

## 11.2 Cancellation queue behavior

The cancellations queue should include customers where:

1. cancelAtPeriodEnd is true
2. status is canceled but historical review is useful
3. canceledAt exists recently

The queue should make it obvious whether the customer still has access until the period end.

## 11.3 Failed payments queue behavior

The failed payments queue should include customers where:

1. subscription status is past_due, unpaid, incomplete, or canceled due to failed billing
2. latest invoice failed
3. local payment status indicates failure

If access still exists because the paid period has not ended yet, show that clearly.

---

# 12. Download History

If download history is already stored, surface it on the customer page.

Recommended fields:

1. download date
2. download type
3. station or location label
4. related entitlement or purchase ID if available

If download history is not currently stored, do not delay version 1 for it unless implementation is simple.

---

# 13. Suggested File and Folder Map

This is a suggested structure. Cursor should adapt it to the real project while keeping the same separation of concerns.

## Backend

1. `server/routes/admin.js`

   * admin page routes if server rendered routes are used
2. `server/routes/api/admin.js`

   * admin API routes
3. `server/middleware/requireAdmin.js`

   * admin authorization middleware
4. `server/models/AdminNote.js`
5. `server/models/AdminAuditLog.js`
6. update existing models as needed

   * `User`
   * `Purchase`
   * `Subscription`
   * `Entitlement`
7. `server/services/admin/`

   * `getDashboardData.js`
   * `searchCustomers.js`
   * `getCustomerDetail.js`
   * `grantEntitlement.js`
   * `extendEntitlement.js`
   * `revokeEntitlement.js`
   * `resyncStripeForCustomer.js`
8. `server/services/admin/logAdminAction.js`

## Frontend

1. `public/admin/index.html` or equivalent view
2. `public/admin/customers.html` or equivalent
3. `public/admin/customer-detail.html` or equivalent
4. `public/admin/cancellations.html` or equivalent
5. `public/admin/failed-payments.html` or equivalent
6. `public/admin/audit-log.html` or equivalent
7. `public/js/admin/`

   * `dashboard.js`
   * `customers.js`
   * `customerDetail.js`
   * `cancellations.js`
   * `failedPayments.js`
   * `auditLog.js`

If the project already uses a different rendering structure, follow the existing architecture rather than forcing a new frontend framework.

---

# 14. Stripe Reconciliation Expectations

The admin panel should not try to replace webhooks. Webhooks remain the source of truth for normal payment lifecycle updates.

The re sync tool is a recovery mechanism for edge cases, such as:

1. A webhook failed or was delayed
2. Local subscription state looks wrong
3. Customer says they canceled but local data still shows active
4. Customer says payment succeeded but access did not update

The re sync action should:

1. Read Stripe data safely
2. Compare it to local subscription and purchase state
3. Update local records where the Stripe data is authoritative
4. Write an audit log of what changed

Do not build a destructive sync that overwrites everything blindly.

---

# 15. Edge Cases the Admin Panel Must Help With

Version 1 should let the owner inspect and resolve these cases clearly:

1. Customer canceled subscription but still has access until the period end
2. Customer thinks they canceled but Stripe still shows active
3. Payment failed but the customer still has access because the current paid period has not ended yet
4. Refund was issued but entitlement remained active
5. One time purchase and subscription overlap created confusing access state
6. Duplicate entitlements were created accidentally
7. Customer contacts support using a different email than the purchase email
8. Stripe webhook missed an update and local state is stale

The UI and underlying data need to make these cases understandable.

---

# 16. Build Order

Cursor should implement in this order.

## Phase 1

1. Admin auth middleware
2. Admin route protection
3. Admin layout and dashboard shell
4. Admin dashboard API with summary counts

## Phase 2

1. Customer search API
2. Customer search page
3. Customer detail API
4. Customer detail page with overview, purchases, subscription, entitlements

## Phase 3

1. Admin notes model and UI
2. Audit log model and logging helper
3. Wire audit logging into all write actions

## Phase 4

1. Grant entitlement action
2. Extend entitlement action
3. Revoke entitlement action
4. Mark for review action

## Phase 5

1. Cancellations queue
2. Failed payments queue
3. Stripe re sync action

## Phase 6

1. Polish
2. Error states
3. Empty states
4. Basic QA checks

---

# 17. Acceptance Criteria

The feature is complete for version 1 when:

1. Only admins can access admin pages and admin API routes
2. The dashboard shows real counts from live data
3. The owner can search for a customer by email and open their detail page
4. The customer detail page shows purchases, subscription state, and entitlements in one place
5. The owner can add internal notes
6. The owner can grant, extend, and revoke entitlements from the UI
7. Every admin write action creates an audit log entry
8. The owner can view recent cancellations
9. The owner can view recent failed payment cases
10. The owner can manually re sync Stripe data for a customer
11. Error messages are clear and non destructive

---

# 18. Non Negotiable Implementation Rules for Cursor

1. Do not invent new billing logic without checking existing Stripe flows
2. Do not break customer facing routes or checkout flows
3. Do not bypass existing auth and session structure
4. Do not store admin only state in the frontend as the source of truth
5. Do not create write actions without audit logging
6. Do not hardcode fake data into final implementation
7. Do not silently change entitlement business rules
8. Use the real existing models and route patterns in the codebase where possible
9. Prefer small focused service functions over large route files
10. Keep the admin panel operational and clear, not over designed

---

# 19. Optional Nice to Have Later

These are not version 1 requirements, but can be added later.

1. Refund queue
2. Dispute queue
3. CSV export
4. Customer support timeline
5. Coupon usage view
6. Product analytics
7. Reactivation tools
8. Quick links into Stripe dashboard records

---

# 20. Final Instruction to Cursor

Please inspect the existing TideInCal codebase and map this spec onto the current structure before changing code.

Before implementation, identify:

1. Existing user model
2. Existing purchase model
3. Existing subscription storage logic
4. Existing entitlement model and fields
5. Existing cancellation flow
6. Existing Stripe webhook flow
7. Existing admin or role support if present

Then implement version 1 of the admin panel according to this spec, keeping changes incremental and aligned with the existing architecture.
