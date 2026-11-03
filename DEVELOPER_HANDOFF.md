# WalletSwap UI repair handoff

> **Current release-hardening status (2026-11-03):** this section supersedes stale
> migration and release statements below where they conflict. The favorites
> migration `20261028000500_retailer_favorites.sql` and gift-card verification
> migration `20261028000600_gift_card_verification.sql` are already deployed
> (owner-confirmed). The separate `20261103000100_listing_lock_integrity.sql`
> remains review-only and unapplied.

## Completed repairs

- Removed the duplicate app-drawn green top stripe and the `.phone` top border in
  app mode. The system status bar and existing safe-area padding remain enabled.
- Made notification preference writes authenticate first, update only the
  current user's row, verify a row was updated, and show specific safe errors.
  Device-notification permission or scheduling failures no longer imply that a
  saved database preference failed.
- Changed Ruby auto-scroll to use the actual `.screen` scrolling viewport,
  restore the latest position after history loads or new turns, and stop
  auto-following when the user scrolls up to read older messages.
- Added pinned, recently used, alphabetically browsable, searchable, and custom
  retailer choices to Add Card. Custom retailer names are preserved in the
  existing wallet model. Favorites are user-scoped through RLS.
- Added the additive `retailer_favorites` migration. It is deployed to Supabase;
  authenticated favorites use the existing user-scoped RLS policies.
- Moved account deletion out of the main Profile dashboard into
  Profile → Settings → Account → Delete Account. The request has an explicit
  warning, a separate acknowledgement, and account-email confirmation. It
  opens a support email request and does not claim or perform account deletion.
  The warning explains which account data is requested for deletion, that legal
  retention may apply, and that credentials in device secure storage may need
  separate cleanup. A public `#/account-deletion` guidance route is also
  available.
- Added the homepage question-mark help icon and a short eight-step tour with
  Back, Next, Skip, Close, and restart from Help. It explicitly distinguishes
  simulations from live payment, balance verification, and retailer activity.
- Kept scanner/OCR metadata handoff to Add Card reviewable, reset stale retailer
  names when a new recognized retailer is applied, and continue to require
  manual remaining-balance entry. No card credentials or photographs are sent
  to Ruby/OpenAI.
- Renamed the CI debug artifact to `walletswap-phase1-repairs-debug`.

## Files changed

- `.github/workflows/ci.yml`
- `DEVELOPER_HANDOFF.md`
- `QA_REPORT.md`
- `RUBY_AGENT_DOCUMENTATION.md` (pre-existing branch documentation edits
  preserved)
- `index.html`
- `src/account-deletion.js`
- `src/card-capture.js`
- `src/help-tour.js`
- `src/retailer-preferences.js`
- `src/ruby-scroll.js`
- `src/services/notifications.js`
- `src/services/retailer-favorites.js`
- `src/services/wallet.js`
- `supabase/migrations/20261028000500_retailer_favorites.sql` (deployed)
- `supabase/migrations/20261028000600_gift_card_verification.sql` (deployed)
- `tests/card-capture.test.js`
- `tests/cloud-build-config.test.js`
- `tests/ui-repairs.test.js`

`Mockup.html` was not changed.

## Verification

- `npm.cmd test` — **85/85 passed**.
- `npm.cmd run build` — passed.
- `npx.cmd cap sync android` — passed; all 8 installed Android plugins synced.
- `git diff --check` — passed.
- Local browser preview verified the homepage/tutorial, demo wallet navigation,
  Add Card recent retailers and custom retailer selection, and Profile →
  Settings → Delete Account navigation.
- The new Android workflow artifact is **`walletswap-phase1-repairs-debug`**.
  It was built and uploaded successfully in the latest CI run for this repair
  branch. See the [WalletSwap CI runs](https://github.com/2606ruth-eng/walletswap/actions/workflows/ci.yml?query=branch%3A2606ruth-eng-walletswap-capacitor-review)
  and download the artifact from the successful **Android debug APK** job.

## Remaining bugs, blockers, and testing

- The reported preference failure was not reproduced in an authenticated
  Samsung session. The earlier read-only backend check found the expected
  preference table and columns, own-row policies, and authenticated update
  grants. Capture the user's exact network/API error on-device if the problem
  persists.
- The two green app-drawn layers were removed based on the CSS/Android shell
  configuration, but Android versions and Samsung rendering have not been
  physically verified.
- Ruby scroll behavior is covered by pure helper and source regression tests.
  Restored live history and keyboard resizing still need an authenticated
  app/device test.
- Favorites migration is already deployed. Live pin/unpin and cross-account
  isolation still need verification against authenticated Supabase accounts.
- `account-delete` remains undeployed and unreviewed. The current action is a
  support request only. A reviewed, authorized backend deletion flow and
  reauthentication policy are still needed before automated deletion.
- The public deletion guidance route has no real hosted HTTPS URL yet.
  Google Play's external account-deletion URL cannot be configured until a
  reachable web deployment exists.
- Barcode scanning, OCR, camera permissions, and native notification
  presentation still require physical Android and iPhone testing. This Windows
  environment cannot validate an iOS/Xcode build.
- Preferences now have regression coverage for both authenticated writes and
  subsequent reads through the same RLS-backed table. Cross-account behavior
  remains unverified against live Supabase accounts.
- No authorized retailer balance feed, real payment processor, or card-transfer
  integration was added.

## Security and cost

- No secrets, full card numbers, PINs, redemption codes, or raw photographs were
  added to the repository or included in this handoff.
- Preference and favorites writes are scoped to the authenticated user; the
  favorites migration enforces own-row RLS and a `(user_id, retailer)` key.
- No production migration or service was changed. No paid provider or scanning
  subscription was added.

## External developer priorities

1. Reproduce the original preference-save failure on the user's Samsung phone,
   record the non-sensitive HTTP status and Supabase error code, and verify
   persistence after an app restart and with a second account.
2. Install the CI APK on Samsung hardware and verify the status-bar/header
   appearance, Ruby chat scroll and keyboard behavior, and camera/notification
   permission flows.
3. Exercise favorites pin/unpin and cross-account isolation against Supabase;
   the migration is already deployed.
4. Review the undeployed account-deletion function, required reauthentication,
   legal retention language, and the hosted account-deletion web URL before
   enabling account deletion or entering the URL in Google Play Console.
5. Add external retailer or payment integrations only under explicit
   authorization and a separately reviewed security/budget plan.

## Follow-up issues

- [#2](https://github.com/2606ruth-eng/walletswap/issues/2) Reproduce Android
  preference save failure on Samsung.
- [#3](https://github.com/2606ruth-eng/walletswap/issues/3) Verify
  user-scoped favorites pin/unpin and cross-account isolation. The issue's
  migration-application portion is stale because the migration is deployed.
- [#4](https://github.com/2606ruth-eng/walletswap/issues/4) Review account
  deletion workflow and publish HTTPS request page.

## Auth, listing-lock and release hardening (2026-11)

- `src/services/session-restore.js` classifies auth errors: only 401/403 and session-invalid codes cause a local sign-out; network/5xx keep the session. `registerAuthLifecycle` (auth.js) resumes refresh and restore.
- `supabase/migrations/20261103000100_listing_lock_integrity.sql` is NOT applied; it needs owner review. It adds marketplace_settings fee, lock trigger, swap guards, `balance_verification` in the public view. The client falls back gracefully when it is absent.
- Internal lock only: WalletSwap cannot freeze a card at the retailer.
- Android: versionCode 2 / 1.1, appId `com.walletswap.app`. Add secret `ANDROID_DEBUG_KEYSTORE_BASE64` (the previous debug keystore) so new APKs install over old ones.
- Open items and blockers: `REGRESSION_TEST_REPORT.md`.

## Release handoff (2026-11-03)

- Hardening implementation commit: `2c5988f24dc44a7a73318c7d713e49f03b024c27`.
- PR #7: [draft, open, based on `2606ruth-eng-gift-card-verification`](https://github.com/2606ruth-eng/walletswap/pull/7).
  It has not been merged; no migration or deployment was performed.
- Changed files in the implementation commit: `.env.example`,
  `.github/workflows/android-apk.yml`, `DEVELOPER_HANDOFF.md`, `QA_REPORT.md`,
  `README.md`, `REGRESSION_TEST_REPORT.md`, `RELEASE_READINESS.md`,
  `android/app/build.gradle`, `index.html`, `src/services/app-data.js`,
  `src/services/auth-redirect.js`, `src/services/auth.js`,
  `src/services/marketplace.js`, `src/services/session-restore.js`,
  `src/social-links.js`,
  `supabase/migrations/20261103000100_listing_lock_integrity.sql`,
  `tests/auth-redirect.test.js`, and `tests/hardening.test.js`.
- At the time checked, Actions runs [41706374799](https://github.com/2606ruth-eng/walletswap/actions/runs/41706374799)
  and [41706320665](https://github.com/2606ruth-eng/walletswap/actions/runs/41706320665)
  for the implementation commit were in progress. Web tests/build and Deno
  type-check had passed; both Android debug APK jobs were assembling. No APK
  artifact had been uploaded yet. These jobs are from `WalletSwap CI` on the
  draft PR, not a manual workflow dispatch. No merge is authorized or planned;
  check the linked runs for final artifact status.
- Migrations `20261028000500` (retailer favorites) and `20261028000600`
  (gift-card verification) are deployed (owner-confirmed). Only
  `20261103000100_listing_lock_integrity.sql` remains unapplied pending review.
