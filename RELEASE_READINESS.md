
## Hardening pass blockers

- Provide production HTTPS domain and configure Supabase Site URL/Redirect URLs/email templates (see REGRESSION_TEST_REPORT.md item 10).
- Provide official LinkedIn company URL (`VITE_LINKEDIN_COMPANY_URL`).
- Approve and apply `20261103000100_listing_lock_integrity.sql` after review.
- Add `ANDROID_DEBUG_KEYSTORE_BASE64` secret for update-compatible APKs; test on a real Samsung device.
- Android HTTPS App Links need the production domain and assetlinks.json.
