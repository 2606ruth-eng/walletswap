# Gift-card balance verification QA

## Scope and safety

This change adds an Add Card retailer confirmation and manual official-site
fallback, a retailer verification directory, review-only database migration,
authenticated Edge Function, disabled provider adapters, Ruby metadata, and a
manual Android debug APK workflow. The latest development branch is included
in the feature branch.

No migration was applied, Edge Function deployed, provider secret configured,
real card credential sent, Adyen request made, production balance checked, or
PR merged. No retailer verification is currently available automatically.
The Adyen request builder and adapter factory are unconnected to the Edge
Function; fake-fetch tests are isolated and do not send network requests. No
sandbox balance result has been persisted or shown by the app.
Target and Starbucks use fixed official HTTPS pages, without card data in the
URL or referrer. User-entered amounts remain user-reported.

## Automated checks

Results are recorded after running the checks from the feature worktree:

| Check | Result |
|---|---|
| `npm.cmd test` | Passed: **96/96** |
| `npm.cmd run build` | Passed: Vite production build |
| `npx.cmd cap sync android` | Passed: all 8 installed Capacitor plugins synchronized |
| `npx.cmd deno check supabase/functions/check-card-balance/index.ts supabase/functions/ruby-chat/index.ts` | Passed |

## Coverage added

- Official Target and Starbucks destination allowlisting; unknown retailers
  remain manual-only.
- Normalized provider result validation, currency matching, and minor-unit
  bounds.
- The unconnected Adyen TEST request builder/adapter factory: documented
  fields and minor units, redirect refusal, timeout/refusal categories, and
  fake-fetch behavior. These tests are not production verification.
- Edge Function JWT/authentication, card ownership, explicit consent, and
  request-field allowlist.
- SQL status constraints, RLS ownership, service-only completion, rate limits,
  request de-duplication, user-report status reset, and preservation of verified
  metadata on repeated provider checks.
- UI retailer confirmation, official-site fallback, and no card/PIN URL
  parameters.
- Ruby verification metadata and the Android APK workflow.

## Not validated here

- Supabase SQL execution, RLS behavior against a live database, function
  deployment, authenticated two-user integration, and rate-limit concurrency
  against Postgres.
- Any Adyen merchant authorization, merchant-specific schema, test credentials,
  simulator card, API response, or production capability.
- Any real or sandbox balance request or result. The app does not show
  sandbox balances.
- The short-lived encrypted credential path required before sending a user's
  card number or security code to any provider.
- Running the manual Android APK workflow. No APK was built in this session;
  physical camera, barcode/OCR, retailer browser handoff, and installed APK
  behavior remain unverified.

See [VERIFICATION_SETUP.md](VERIFICATION_SETUP.md) for SQL review, deployment
gates, dashboard instructions, Adyen onboarding requirements, and Android APK
steps.
