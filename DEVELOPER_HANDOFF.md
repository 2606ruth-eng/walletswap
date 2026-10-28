# WalletSwap UI repair handoff

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
- Added the additive `retailer_favorites` migration. It is local only and has
  **not** been applied to Supabase. Pinning stays unavailable and explains why
  until the migration is applied.
- Moved account deletion out of the main Profile dashboard into
  Profile → Settings → Account → Delete Account. The request has an explicit
  warning, a separate acknowledgement, and account-email confirmation. It
  opens a support email request and does not claim or perform account deletion.
  A public `#/account-deletion` guidance route is also available.
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
- `supabase/migrations/20261028000500_retailer_favorites.sql` (not deployed)
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
  Its Actions run link and final result will be recorded here after CI completes.

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
- Favorites require approval and application of the new RLS migration before
  production pin/unpin can be used. Do not deploy it as part of this repair.
- `account-delete` remains undeployed and unreviewed. The current action is a
  support request only. A reviewed, authorized backend deletion flow and
  reauthentication policy are still needed before automated deletion.
- The public deletion guidance route has no real hosted HTTPS URL yet.
  Google Play's external account-deletion URL cannot be configured until a
  reachable web deployment exists.
- Barcode scanning, OCR, camera permissions, and native notification
  presentation still require physical Android and iPhone testing. This Windows
  environment cannot validate an iOS/Xcode build.
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
3. After separate approval, apply the favorites migration and exercise
   pin/unpin and cross-account isolation against Supabase.
4. Review the undeployed account-deletion function, required reauthentication,
   legal retention language, and the hosted account-deletion web URL before
   enabling account deletion or entering the URL in Google Play Console.
5. Add external retailer or payment integrations only under explicit
   authorization and a separately reviewed security/budget plan.
