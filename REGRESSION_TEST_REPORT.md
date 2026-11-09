# WalletSwap Regression Test Report

Branch: `2606ruth-eng-walletswap-auth-marketplace-hardening` (based on `2606ruth-eng-gift-card-verification`).
Status labels: **FIXED AND VERIFIED** (automated test or build proves it), **CODE FIXED BUT NOT DEVICE TESTED**,
**BLOCKED BY EXTERNAL CONFIGURATION**, **INCOMPLETE**.

No physical Android device, live Supabase account, real email inbox, or production domain was available to this
work. Nothing below is claimed as device- or live-auth-tested unless stated. "Verified" means unit/static tests
(`npm test`: 107 pass, 0 fail), `vite build`, and `cap sync android` ran locally.

## Required report items

1. **Automatic logout – root cause.** Not reproducible without a device, so this is the most probable cause found by code
   inspection, not a device-confirmed one. Storage (Android Keystore-backed SecureStorage), `persistSession`,
   `autoRefreshToken` and a single client were already correct. Defects found:
   - On startup any `getUser()` failure (offline, timeout, 5xx) was handled by a catch that only showed a toast. The user
     remained on the login screen with a valid stored session, and nothing retried when connectivity returned or the app
     resumed. This presents as "logged out every launch" on a slow/offline cold start.
   - A `getUser()` result with a null user triggered `supabase.auth.signOut()` with the default **global** scope,
     revoking the user's sessions on every device. Likewise `signOut()` (explicit logout) and account deletion used global scope.
   - `onAuthStateChange` clears local state on any event without a session (kept; it is the correct reaction to a genuine
     `SIGNED_OUT`).
   - There was no appStateChange handling to pause/resume token auto-refresh in the Android WebView.
   A getUser *error* did not itself call signOut; only a null user did.
2. **Signup email link – cause.** The native app sent `emailRedirectTo = walletswap://auth/callback`. Custom-scheme links are
   frequently not clickable in mail clients and cannot be completed on a laptop or without the app installed; Supabase also
   falls back to the project **Site URL** when the redirect is not allow-listed (the repo's config uses `http://localhost:5173`).
   The Supabase dashboard Site URL / Redirect URLs / email template of the linked project could not be inspected from here.
3. **Changes.** `src/services/session-restore.js` (invalid-vs-transient classification), local-scope sign-out, startup restore
   keeps session on transient errors and signs out locally only on definitive rejection, `retryRestore()` on `online` and app
   foreground, `startAutoRefresh/stopAutoRefresh` on app state, hosted-HTTPS callback for native signup when
   `VITE_SUPABASE_AUTH_REDIRECT_URL` is set, "Open the WalletSwap app" and resend guidance on the callback page.
4. **Gift-card tabs.** The card-details screen in this codebase is a single scrolling view plus the global 5-item tab bar; no
   separate three bottom tabs / three side controls exist in the code, so the described controls could not be identified or
   reproduced. A regression test now asserts the tab bar is rendered on card routes and is not `pointer-events:none`. The reporter
   must supply a screenshot of the affected screen. **INCOMPLETE** (cannot confirm on device).
5. **Sell from Card Details end to end.** The Sell button, price sheet (fee and proceeds, verification note), `create_marketplace_listing`
   RPC and refresh into the marketplace already exist and now show the configured fee and verification status. Not tested against live
   Supabase. **CODE FIXED BUT NOT DEVICE TESTED**. Pause is not implemented (only edit price and cancel).
6. **Backend listing lock.** Existing: unique partial index (one active/reserved listing per card) plus row locks. New migration
   `20261103000100_listing_lock_integrity.sql` adds a trigger blocking user balance changes/archiving of a listed card, swap-proposal
   guards, cancel closes open proposals, and settings-driven fee. **Not applied**; requires approval. Not executed against a database.
7. **Marketplace connected to Supabase.** Yes for the authenticated app (`public_marketplace_listings`, RPCs). Demo mode remains
   clearly separated. Buy/swap UI remains simulated (no payment).
8. **LinkedIn URL.** Set `VITE_LINKEDIN_COMPANY_URL=https://www.linkedin.com/company/<official-slug>` as a GitHub Actions
   repository variable (APK) and in the web build env / `.env.local`. Nothing is rendered while unset or invalid.
9. **Previous-feature regression.** See table. Static/unit coverage only; features requiring a device or live backend are labelled.
10. **Supabase dashboard config needed.** Authentication → URL Configuration: Site URL = production HTTPS origin (placeholder
    `https://<your-domain>`); Redirect URLs: `https://<your-domain>/auth/callback`, `https://<your-domain>/auth/recovery`,
    `walletswap://auth/callback`, `walletswap://auth/recovery`. Email templates must use `{{ .ConfirmationURL }}` (not a hard-coded
    host). Consider a "confirm via button/POST page" if corporate link scanners consume one-time tokens.
11. **Migrations needing approval.** `20261103000100_listing_lock_integrity.sql` only. Nothing was applied.
12. **Tests.** `npm test` 107/107 pass; `npm run build` OK; `npx cap sync android` OK. The Gradle APK build is run in GitHub Actions.
    The `supabase/tests` SQL and concurrent-listing race tests were **not run** (no database in this environment).
13. **Commit SHA / 14. Actions URL / 15. APK artifact:** recorded in `RELEASE_READINESS.md` after push.

## Requirement status

| Area | Item | Status |
|---|---|---|
| P1 | Transient vs invalid session logic, local sign-out scope, resume/refresh | FIXED AND VERIFIED (unit/static) |
| P1 | Close/reopen, force-stop, phone restart, offline/online on real Android | CODE FIXED BUT NOT DEVICE TESTED |
| P1 | Revoked-session rejection against live Supabase | CODE FIXED BUT NOT DEVICE TESTED |
| P1 | Demo/auth separation, no token logging | FIXED AND VERIFIED (no token logging added; demo store unchanged) |
| P2 | Redirect resolution, callback code/hash exchange, expired/used messages | FIXED AND VERIFIED (unit) |
| P2 | Hosted HTTPS callback + Open-in-app link | CODE FIXED BUT NOT DEVICE TESTED |
| P2 | Real signup email, confirmed status, desktop/Android clicks, resend, reset email | BLOCKED BY EXTERNAL CONFIGURATION (Site URL, domain, SMTP, real mailbox) |
| P2 | HTTPS Android App Links (`autoVerify`, assetlinks.json) | BLOCKED BY EXTERNAL CONFIGURATION (production domain) |
| P3 | Card details navigation | INCOMPLETE (controls not identifiable in code; see item 4) |
| P4 | Sell from details, fee display, verification label | CODE FIXED BUT NOT DEVICE TESTED |
| P4 | Pause listing | INCOMPLETE |
| P5 | Internal lock UI explanation | FIXED AND VERIFIED (static) |
| P5 | DB lock trigger, swap guards, concurrency tests | INCOMPLETE (migration awaiting approval, not run) |
| P5 | Issuer-side freeze | INCOMPLETE by design: no authorized provider; a disabled adapter was not added |
| P6 | Marketplace reads/writes via Supabase, loading/empty/error states | CODE FIXED BUT NOT DEVICE TESTED |
| P6 | Two-account end-to-end, Android+desktop same account | INCOMPLETE (no test accounts/device) |
| P7 | LinkedIn configurable link | FIXED AND VERIFIED (unit); URL BLOCKED BY EXTERNAL CONFIGURATION |
| P8 A–G | Items shipped in earlier commits (status bar, tutorial, scanner, retailers, balance verification, Ruby, notifications) | Existing tests still pass (no regressions); device/live behaviour NOT RE-TESTED here |
| P8 G | Google/Apple Wallet, payments, bank providers | Remain unavailable/disabled; not made to appear active |
| P9 | RLS, grants, deep-link handling reviewed by inspection | Existing policies unchanged; migration grants least-privilege (static test) |
| P10 | Vite build, cap sync, versionCode 2 / appId unchanged | FIXED AND VERIFIED |
| Scan UX | Scanner review gate and live capture | IMPLEMENTED, UNIT-TESTED WITH MOCKS ONLY. On native, scanning now uses `startScan()` + `barcodesScanned` with an in-app Capture/Cancel overlay, so the user decides when a code is taken (the ready-made `scan()` auto-closes on first detection). Listeners/camera are released on capture, cancel, scanError, startScan failure, app backgrounding, page hide and route change; if `startScan()` is unavailable or fails the user gets an explicit choice (retry controlled scanner / use the automatic scanner, described as closing on first detection / enter manually); the automatic scanner is never opened silently. Detection itself is not slowed; the user controls selection. Several codes require a masked choice; duplicates collapse; blank reads are rejected (the earlier 6-character minimum was removed because short formats such as EAN-8/Code 39 are valid); nothing applies until "Confirm". Transparent-WebView rendering, CameraX preview, Android process death during scanning (`appRestoredResult` applies only to `scan()` and is not handled) and the real device are NOT TESTED. `cap sync android` ran; only line-ending churn in generated gradle files, restored. |
| App-like UI | Home and sign-in | Narrow screens/native get a focused layout (sticky full-width actions, back arrow, safe-area padding, marketing sections hidden). Static/unit checks only; no real-device or full browser screenshot review performed. |
| Balance bot | Automatic website balance checking | NOT IMPLEMENTED: scraping retailer sites without authorization or bypassing CAPTCHA is not allowed, and no authorized provider credentials exist. Official-website/manual balance remains the fallback; no results are faked. |
| P10 | APK update-over-previous-build | BLOCKED BY EXTERNAL CONFIGURATION (needs `ANDROID_DEBUG_KEYSTORE_BASE64` secret matching the earlier key; otherwise uninstall first) |

## Email verification code and first-use guide (PR #7 follow-up)

### Changes
- Signup now opens a **#/verify** screen. The user enters the code from the email; verification is server-side via `auth.verifyOtp({ type: "signup" })` (`verifySignupCode`). No client-side verification or fake delivery.
- Code UX: numeric/one-time-code input, 60 s resend cooldown (`resendSecondsRemaining`), invalid/expired/rate-limited/network errors (`src/services/auth-otp.js`). Supabase returns the same `otp_expired` error for wrong and expired codes, so the wording covers both.
- Privacy: copy is neutral ("If an account can be created for ..."). For an already-confirmed email Supabase sends no email and returns an obfuscated user; the UI does not reveal it.
- Login with `email_not_confirmed` offers "Enter verification code" / "Resend code". Password recovery, auth callbacks, session handling are unchanged.
- Sign-in polish: email keyboard attributes, app-like layout from the earlier commit.
- Guide: `HELP_STEPS` gained `route`/`cta`. The tour renders in a body-level host. First entry to `#/app/*` for a non-demo account starts a non-blocking coach card once (`walletswap.onboarding.v1.<account>` in localStorage). It has Next/Back/Skip, "Show me" navigation, Escape to skip, `aria-live`, reduced-motion handling. Replay via Profile > More > "Replay the guide"; the home help button still opens the modal tour.
- Limitation: the "seen" flag is per device/browser, not synced across devices.

### Email delivery diagnosis (not verified)
- No Supabase dashboard, log, or CLI access was available, so the production cause of missing signup emails is **undiagnosed**.
- Code findings: the old flow only used link-based confirmation with no code entry; `config.toml` had `enable_confirmations = true` and no template.
- Possible causes the owner must check in the dashboard (not changed here): (1) Supabase default SMTP only delivers to organization team addresses and is heavily rate-limited (about 2/hour), so custom SMTP is required for general users; (2) the **Confirm signup** template must contain `{{ .Token }}` (the Magic Link template does not control signup). Until updated, the dashboard template still sends a link, not a code.
- Repo: `supabase/templates/confirmation.html` and `[auth.email.template.confirmation]`/`otp_length`/`otp_expiry` in `supabase/config.toml` apply to local/CLI config only. Copy the template into Authentication > Emails > Confirm signup in the production project. Nothing was deployed or changed in production.

### Validation
- `npm.cmd test`: 125/125 pass (new `tests/otp-onboarding.test.js`; `tests/auth-flow.test.js` updated for the code flow). `npm.cmd run build` passes.
- Not tested: live email delivery, a real signup with a code, physical device/emulator behavior of the guide or scanner.
