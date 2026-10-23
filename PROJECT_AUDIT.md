# WalletSwap project audit and staged delivery

## Repository and application

This is a Vite-hosted, single-page HTML application with vanilla JavaScript
modules; it is not a React or other component-framework project. `index.html`
is the application entry point, and `Mockup.html` remains a separate preserved
prototype. Vite builds the browser app to `dist/`; Capacitor 8.5.3 packages that
output as `com.walletswap.app`.

The app retains the wallet, gift-card add/edit flows, marketplace and simulated
swap/purchase experiences, activity, profile, Ruby chat, scanning/capture, and
notification settings. The HTML, CSS, browser JavaScript, and app wiring live
primarily in `index.html` and `src/`. Supabase Edge Functions and migrations
live in `supabase/`; native wrappers are in `android/` and `ios/`.

Key implementation files:

| Area | Files |
|---|---|
| Entry point and existing design | `index.html` (HTML, CSS, and app shell), `Mockup.html` |
| Gift-card capture and credentials | `src/card-capture.js`, `src/credential-vault.js`, `src/services/wallet.js` |
| Auth, data, and Ruby UI | `src/services/auth.js`, `src/services/supabase.js`, `src/services/ruby.js` |
| Activity and notifications | `src/services/notifications.js`, `src/services/notification-runtime.js` |
| Database | `supabase/migrations/20261023000100_walletswap_schema.sql`, `20261023000200_walletswap_operations.sql`, `20261023000300_phase2b_activity_notifications.sql`, `20261023000400_ruby_usage_controls.sql` |
| Server endpoints | `supabase/functions/ruby-chat/`, `wallet-actions/`, `marketplace-actions/`, `authorized-balance-webhook/`, `notification-worker/`, `account-delete/` |
| Native config | `capacitor.config.json`, `android/`, `ios/App/App/Info.plist`, `ios/App/CapApp-SPM/Package.swift` |
| Tests and operating docs | `tests/`, `QA_REPORT.md`, `PHASE_1B_QA_REPORT.md`, `PHASE_2B_QA_REPORT.md`, `RUBY_AGENT_DOCUMENTATION.md`, `SUPABASE_SETUP.md` |

The GitHub worktree has pre-existing changes and many project files are
untracked. Treat them as user work: inspect the final diff before staging and
stage only the intended files. Do not reset, delete, or replace the current
prototype.

## Current verified state

- The application uses Vite, plain JavaScript modules, Supabase JS, and
  Capacitor; the package manifest pins Capacitor 8.5.3.
- Android and iOS project folders exist. Android app ID is
  `com.walletswap.app`. This Windows environment does not have Java, Android
  SDK/Studio, adb, or Gradle on PATH, so a native Android build has not been
  verified here.
- The iOS wrapper uses Swift Package Manager and targets iOS 15. The selected
  ML Kit scanning plugins do not supply Swift packages; iOS scanning/native
  build verification therefore requires a reviewed CocoaPods migration on
  macOS with Xcode. Do not recreate `ios/` in this worktree.
- The only `.env.local` variable names observed were public Vite settings;
  this audit did not inspect or record values. No public production HTTPS
  origin is verified.
- Supabase CLI reports `ruby-chat` ACTIVE with JWT verification enabled.
  The local `ruby-chat` source now includes un-deployed changes. No account
  deletion, notification-worker, marketplace, wallet, or retailer webhook
  Edge Function is reported as deployed by the current function-list query.
- Remote migration history reports the base schema and operations migrations
  (`20261023000100`, `20261023000200`) applied. The Phase 2B migration
  (`20261023000300`) and the new Ruby usage-controls migration
  (`20261023000400`) are local and must not be applied without explicit
  deployment approval.
- Ruby has authenticated, caller-scoped data tools and a Responses API
  integration in source. The deployed function's live AI behavior and current
  deployed source have not been compared with this worktree. No live OpenAI
  request was made in this audit.
- No authorized retailer transaction feed, real payment/transfer rail, FCM/APNs
  sender, Google Wallet issuer, or Apple Wallet issuer is configured. Existing
  marketplace purchase flows remain simulations.
- GitHub Actions now runs web tests/build, a Ruby Deno type-check, and Android
  `assembleDebug`; the latest run passed and uploaded a debug APK artifact. It
  is not a signed release artifact and has not been installed on a physical
  phone. No store release is verified.
- Existing test/build baseline before this work was 67 tests. Local validation
  results for the current changes are recorded in `QA_REPORT.md` after the
  final test run.

## Ruby live-mode changes in this worktree

Ruby now fails closed unless server-side `RUBY_AI_MODE=live` and
`OPENAI_API_KEY` are configured. It no longer silently substitutes deterministic
Demo Mode content when the provider fails or produces unsafe output. The model
and rate card are server-configurable, and the Edge Function uses authenticated
user-scoped database tools for cards, activity, notifications, preferences,
market listings, and previews.

Migration `20261023000400_ruby_usage_controls.sql` adds a service-only,
concurrency-safe monthly global budget reservation ledger. Before each user
request, Ruby reserves a conservative upper bound based on configured model
prices and a server-set budget; after the provider returns, it settles the
reservation from Responses API token usage. The application rejects a monthly
budget above **$100**. This is an estimate-based application cap, not an OpenAI
billing guarantee: exact current model prices must be configured, and the
OpenAI account still needs a dashboard budget/usage alert. The migration and
updated Edge Function are not deployed.

Required server-only settings for a later approved activation:

| Setting | Requirement |
|---|---|
| `OPENAI_API_KEY` | Existing rotated OpenAI credential in Supabase Function Secrets; never print or put it in browser config |
| `RUBY_AI_MODE` | Exact value `live` to enable live responses |
| `RUBY_OPENAI_MODEL` | A model currently available to the existing OpenAI account |
| `RUBY_INPUT_COST_PER_MILLION_USD` | Current official model input price, expressed as a decimal USD amount per one million tokens |
| `RUBY_OUTPUT_COST_PER_MILLION_USD` | Current official model output price, in the same format |
| `RUBY_MONTHLY_BUDGET_USD` | Chosen hard application limit from $0.01 to $100.00 |

Do not activate the live endpoint until migrations `003` and `004` are reviewed
and applied, the server settings are confirmed, a deployment is explicitly
approved, and an authenticated request is verified. Never run a CLI command
that prints secret values.

## Stages and exact prerequisites

| Stage | Deliverable | What is needed to verify/continue |
|---|---|---|
| 0. Audit | This inventory and verified baseline | No credentials or external changes |
| 1. Ruby live and cost controls | Live Responses API only, user-scoped tools, monthly reservation cap | Owner selects a monthly cap at or below $100; operator checks official current model pricing; approval to apply migrations and deploy only `ruby-chat` |
| 2. Add-card capture | Barcode/QR, photo, on-device OCR, manual correction, safe storage | Android device for native scanning; iPhone and macOS/Xcode after iOS CocoaPods decision; manual browser path remains available |
| 3. Activity and notifications | User-reported purchases, preferences, local notifications, in-app events | Approval before migration/function deployment; physical Android/iPhone for permission, foreground/background, and expiry tests |
| 4. Authorized retailer events | Signed integration adapter and verified balance updates | A specific retailer/processor's written API authorization, webhook contract, and test credentials; otherwise external activity must remain unknown |
| 5. Google/Apple Wallet | Issuer-approved, signed pass adapters | Issuer/merchant authorization, Apple/Google program access, signing certificates/keys, and product/legal review; no pass will be issued before then |
| 6. Security and RLS | Database policy, Edge Function, and secret-handling review | Local Postgres/Docker or a separately approved test project; two test accounts; no production account data needed |
| 7. Android installable build | Debug APK for device testing, followed by release-signed artifact | Android Studio/JDK/SDK or a successful CI runner; release signing material only for a store-ready artifact, handled outside source control |
| 8. iOS build | Native iOS archive and device tests | macOS, Xcode, CocoaPods migration review, Apple developer signing, and physical iPhone |
| 9. CI and release prep | Pull-request checks, build artifacts, release instructions | GitHub Actions runner availability; no store publication without explicit approval |
| 10. Final QA | Feature and deployment evidence, remaining-blocker report | Authenticated test accounts, device access, approved external integration only if one is actually provided |

No remote deployment, migration, payment, retailer connection, wallet-pass
issuance, app-store submission, or merge is authorized by this audit.
