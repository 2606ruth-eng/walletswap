
## Hardening pass blockers

- Provide production HTTPS domain and configure Supabase Site URL/Redirect URLs/email templates (see REGRESSION_TEST_REPORT.md item 10).
- Provide official LinkedIn company URL (`VITE_LINKEDIN_COMPANY_URL`).
- Approve and apply `20261103000100_listing_lock_integrity.sql` after review.
- Add `ANDROID_DEBUG_KEYSTORE_BASE64` secret for update-compatible APKs; test on a real Samsung device.
- Android HTTPS App Links need the production domain and assetlinks.json.

## Current branch and build status (2026-11-03)

- Implementation commit: `2c5988f24dc44a7a73318c7d713e49f03b024c27`.
  The follow-up whitespace and handoff correction is
  `7759d84cf9beb231f05c0ed599462cb8b04e2877`, the PR head checked below.
- [PR #7](https://github.com/2606ruth-eng/walletswap/pull/7) is open and draft,
  based on `2606ruth-eng-gift-card-verification`. It has not been merged.
- The implementation commit changed: `.env.example`,
  `.github/workflows/android-apk.yml`, `DEVELOPER_HANDOFF.md`, `QA_REPORT.md`,
  `README.md`, `REGRESSION_TEST_REPORT.md`, `RELEASE_READINESS.md`,
  `android/app/build.gradle`, `index.html`, `src/services/app-data.js`,
  `src/services/auth-redirect.js`, `src/services/auth.js`,
  `src/services/marketplace.js`, `src/services/session-restore.js`,
  `src/social-links.js`,
  `supabase/migrations/20261103000100_listing_lock_integrity.sql`,
  `tests/auth-redirect.test.js`, and `tests/hardening.test.js`.
- Current-head Actions runs [41706944901](https://github.com/2606ruth-eng/walletswap/actions/runs/41706944901)
  (pull request) and [41706932771](https://github.com/2606ruth-eng/walletswap/actions/runs/41706932771)
  (push) completed successfully for `7759d84cf9beb231f05c0ed599462cb8b04e2877`.
  Web tests/build, Deno type-check, Android debug APK assembly, and artifact
  upload passed. The artifact is
  [`walletswap-phase1-repairs-debug`](https://github.com/2606ruth-eng/walletswap/actions/runs/41706944901/artifacts/13266625377)
  (`app-debug.apk`); the push run's artifact is
  [also available](https://github.com/2606ruth-eng/walletswap/actions/runs/41706932771/artifacts/13267645215).
  No manual workflow dispatch was needed. No merge was performed or is
  requested.
- `20261028000500_retailer_favorites.sql` and
  `20261028000600_gift_card_verification.sql` are deployed (owner-confirmed).
  Only `20261103000100_listing_lock_integrity.sql` remains unapplied and needs
  review. The favorites migration-application follow-up in issue #3 is stale;
  retain that issue only for live cross-account favorites verification.
- No migration or function deployment was performed. The APK artifact is a
  debug build only; no physical-device installation test is claimed.
