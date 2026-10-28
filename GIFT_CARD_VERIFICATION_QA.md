# Gift-card balance verification QA

## Scope and safety

This change adds an Add Card retailer confirmation and manual official-site
fallback, a retailer verification directory, deployed database migrations and
authenticated Edge Function, disabled provider adapters, Ruby metadata, and a
manual Android debug APK workflow. The latest development branch is included
in the feature branch.

The verification and favorites migrations were applied to the linked Supabase
project. `check-card-balance` is deployed and ACTIVE with JWT verification
enabled. No provider secret was configured, real card credential sent, Adyen
request made, production balance checked, or PR merged. No retailer
verification is currently available automatically.
The Adyen request builder and adapter factory are unconnected to the Edge
Function; fake-fetch tests are isolated and do not send network requests. No
sandbox balance result has been persisted or shown by the app.
Target and Starbucks use fixed official HTTPS pages, without card data in the
URL or referrer. User-entered amounts remain user-reported.

## Automated checks

Results are recorded after running the checks from the feature worktree:

| Check | Result |
|---|---|
| `npm.cmd test` after fallback response change | Passed: **97/97** |
| `npm.cmd run build` after fallback response change | Passed: Vite production build |
| `npx.cmd cap sync android` after fallback response change | Passed: all 8 installed Capacitor plugins synchronized |
| `npx.cmd deno check supabase/functions/check-card-balance/index.ts` | Passed |
| Deployed endpoint without Authorization | Passed: HTTP 401, missing authorization header |
| Deployed endpoint with malformed bearer token | Passed: HTTP 401, invalid JWT |
| Supabase function list | Passed: `check-card-balance` ACTIVE, JWT verification enabled |

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
- Unsupported/manual-only Edge Function responses include a fixed,
  allowlisted official retailer URL when available.
- SQL status constraints, RLS ownership, service-only completion, rate limits,
  request de-duplication, user-report status reset, and preservation of verified
  metadata on repeated provider checks.
- UI retailer confirmation, official-site fallback, and no card/PIN URL
  parameters.
- Ruby verification metadata and the Android APK workflow.

## Not validated here

- RLS behavior against a live database, function runtime behavior with a valid
  user session, authenticated two-user integration, and rate-limit concurrency
  against Postgres. The live endpoint was tested only without a valid signed-in
  user session and correctly rejected both missing and malformed auth; no
  synthetic user or card was created in the production project.
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
