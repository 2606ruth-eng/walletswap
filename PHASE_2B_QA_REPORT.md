# WalletSwap Phase 2B QA Report

## Implemented

- Reused `public.card_activity`; no duplicate activity table was created. The existing `record_card_purchase` RPC remains atomic and idempotent, updates `card_activity.notification_status`, and labels purchases `user_reported` / `unverified`.
- Kept the existing card details and spend flow, relabeling its action as **Record purchase**. The success message continues to clarify that the remaining balance is user-reported.
- Added notification preferences for card activity, balance changes, expiry reminders, weekly summaries, and marketplace/swap activity. The profile also displays recent user-scoped in-app notifications and allows marking them read. A user-filtered Supabase Realtime subscription surfaces new notices while the app is connected in the foreground.
- Added preference-gated marketplace and swap notices on existing simulated transaction/proposal events; copy explicitly states that no payment or card transfer occurred.
- Added Capacitor local-notification permission handling, privacy-safe card activity notifications, and native expiry reminders at 14 days and 1 day before a printed expiration date. Notification bodies omit balances, masked identifiers, redemption codes, and PINs.
- Installed and configured Capacitor Local Notifications and Push Notifications. Push registration/delivery is deliberately inactive because there is no configured FCM/APNs delivery backend.
- Added an HMAC-SHA256 webhook adapter boundary, strict payload validation, provider approval checks, and database event-idempotency. A dedicated signed `walletswap-test` event is labeled as a test and remains unverified. No retailer integration is configured by this change.
- Authorized-provider balance decreases are marked for review and users can report a problem from the card history.
- Added a scheduled weekly-summary notification RPC and a Ruby `generate_weekly_wallet_summary` tool. Ruby reports only authenticated WalletSwap data, distinguishes reported from verified activity, and discloses that no external transaction feed is connected.

## Checks

| Check | Result | Notes |
|---|---|---|
| `npm test` | Passed: 67/67 | Includes tests for purchase idempotency/overspend contract, permissions denied, expiry scheduling/privacy, signed test-webhook HMAC, reporting scope, marketplace/swap notice rules, and Ruby weekly summaries. |
| `npm run build` | Passed | Vite production build completed. |
| `npm run cap:sync` | Passed with warning | Android/iOS plugin sync completed. The existing ML Kit scanning plugins still lack `Package.swift`; that known iOS scanning limitation is unrelated to notifications. |
| `git diff --check` | Passed | No whitespace errors. |
| Supabase Edge Function type-check | Untested | Deno is unavailable in this Windows environment. |
| Database migration execution | Blocked locally | Supabase local status could not inspect the database because neither Docker nor Podman is installed. The new migration has not been applied to the existing Supabase project; no remote data was changed. |
| Purchase against Supabase (`$50` → `$35`) | Not run | Local tests check the SQL transaction contract; no local/remote database transaction was executed. |
| Duplicate submission / User A vs. User B RLS | Not run against a database | Existing owner-scoped RLS is retained; runtime isolation requires applying migrations and testing with two authenticated accounts. |
| Signed webhook database integration | Not run | The HMAC and payload validation are unit-tested. A database-backed signed test event needs the migration, Edge Function deployment, and a test secret. |
| Physical Android/iPhone notification testing | Untested | Permission prompts, lock-screen delivery, OS scheduling, foreground Realtime delivery, and app-state behavior require physical-device testing. |
| iOS native build | Blocked | This environment is Windows and has no macOS/Xcode. Capacitor sync is not an Xcode build. |
| Real retailer activity | Unavailable | No authorized retailer adapter or approved provider is configured; the webhook rejects provider updates unless an approved retailer row and secret exist. |
| Push delivery | Unavailable | No FCM/APNs sender or credentials are configured. Push plugin is present but no device token is registered or delivered. |

## Security and operating-cost notes

- The signed webhook accepts only a bounded set of fields, verifies the raw request body before applying it, uses an idempotent provider/event key, and does not log request contents or credentials.
- Real balance verification requires `AUTHORIZED_BALANCE_WEBHOOK_SECRET` plus a matching `retailer_integrations` row with status `approved` and balance verification enabled. Do not create an approved row without a retailer-authorized integration and signature contract.
- Test events require the separate `WALLET_SWAP_TEST_WEBHOOK_SECRET`, provider `walletswap-test`, and explicit `test_event: true`; these events are recorded as system/test and unverified. Never use the test secret for a retailer.
- Ruby’s weekly summary uses its existing authenticated tools and existing model configuration; no additional API key, provider, or paid service was introduced.
- Local notifications and database-backed in-app notices add no paid delivery service. Push delivery is not active.

## Remaining deployment and manual verification

1. Review and apply `supabase/migrations/20261023000300_phase2b_activity_notifications.sql` to the existing Supabase project. Do not recreate the database.
2. Deploy `authorized-balance-webhook`, `notification-worker`, and the updated `ruby-chat` Edge Function only after reviewing their diffs. Configure the webhook function secrets through Supabase Function Secrets; never place secret values in source control.
3. For a test event, set a separate `WALLET_SWAP_TEST_WEBHOOK_SECRET` only in the test deployment and send a correctly HMAC-signed request with `provider: "walletswap-test"` and `test_event: true`. Verify the matching activity remains unverified and that resubmitting the same event ID creates no second activity.
4. Leave `AUTHORIZED_BALANCE_WEBHOOK_SECRET` unset until an approved retailer adapter exists. The app must continue to say external activity is unknown.
5. Configure a scheduler to invoke `notification-worker` if scheduled expiry and weekly in-app notices are desired. Permission denial leaves notices in the in-app list and does not trigger repeated prompts. Realtime foreground notice delivery also depends on applying the migration that adds `notifications` to `supabase_realtime`.
6. On Android and iOS devices, test notification permission grant/denial, foreground purchase alerts, expiry schedules, app restart behavior, and OS-level notification settings. Validate Push only after a delivery provider is separately configured.
7. With two authenticated accounts after migration, record a purchase on a $50 test card and verify a $15 deduction to $35, one activity row, duplicate idempotency, over-balance rejection, notification preference behavior, and inability of the second account to read or report the first account's activity.

No migration or Edge Function deployment was performed during this implementation.
