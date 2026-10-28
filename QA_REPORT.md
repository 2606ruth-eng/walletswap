# WalletSwap integration QA report

## Passed

- `npm.cmd test`: **50 passed, 0 failed**. Tests cover frontend/backend
  boundaries, masked card data, scanner and camera permission failures,
  unreadable scans, cancellation, OCR candidate handling, invalid balances,
  manual edits/confirmation, browser fallback, temporary-photo cleanup,
  environment-specific auth redirects, callback session exchange/recovery,
  expired-link handling, native URL-scheme wiring, signup confirmation/resend,
  safe SMTP/rate-limit messaging, and Ruby Responses API/auth/cost controls.
- `npm.cmd run build`: **passed** with Vite 8.3.5.
- `npm.cmd run cap:sync`: **completed** for Android, iOS, and web. Six
  Capacitor plugins were found on both native platforms.
- `npm.cmd run cap:sync:android`: **completed** after the Android callback
  configuration changes.
- `git diff --check`: passed.
- The existing configured Supabase project's public Auth settings endpoint
  returned HTTP 200; email authentication is configured and signup is not
  disabled. This is endpoint/configuration reachability only.
- After explicit approval, both local migrations were applied to the existing
  project.
- Read-only remote metadata checks verified all 17 public base tables have RLS
  enabled. The 16 user-facing tables have policies; `ruby_rate_limits` has no
  direct authenticated table grants. Key RPC definitions and authenticated
  execution grants are present.
- The live policy metadata includes owner-only wallet card reads, user-owned
  conversation CRUD, user-message-only inserts, and user-owned message/tool
  event reads. The rate-limit table is accessed through its authenticated
  security-definer RPC only.
- The OpenAI secret-name check confirms `OPENAI_API_KEY` is configured in
  Edge Function Secrets; its value was never retrieved or displayed.
- After explicit approval, the Supabase API bundler deployed **only**
  `ruby-chat`. The deployed function reports JWT verification enabled;
  `account-delete` is not deployed.
- A POST without a user bearer token returned **HTTP 401**.
- A browser CORS preflight from `http://localhost:5173` returned **HTTP 200**
  and allowed the local origin.
- The Ruby source uses the Responses API with the `gpt-4o-mini` model,
  `store: false`, five requests/user/minute, a 600-output-token limit per
  Responses call, a three-call round cap, and bounded user/history/tool input.
- Security review found no exploitable vulnerabilities in the reviewed Ruby
  handler, helpers, migration policies, and tests. This is not a penetration
  test or live function verification.
- The browser login route rendered without the missing-Supabase-configuration
  warning.
- The prior local browser redirect override was exactly
  `http://localhost:5173/`. An Android phone resolves that URL as its own
  localhost, explaining the unreachable page. Local development now uses the
  actual Vite browser origin plus `/auth/callback`; native auth uses
  `walletswap://auth/callback`, and password reset has a separate callback.
- The signup/login flow now explains required email confirmation, preserves the
  attempted address, distinguishes the `email_not_confirmed` login response,
  and offers a generic confirmation resend action.
- Static migration review found owner-scoped RLS for Ruby conversations and
  messages, plus tests in the SQL suite for conversation ownership and
  preventing clients from forging assistant messages.

## Failed

- No unresolved test, build, or migration failure remains. Initial migration
  attempts exposed two SQL syntax errors (column-level `GRANT` placement and
  composite-row `SELECT INTO`); both were corrected before the successful
  migration push.

## Untested

- Physical Android/iOS confirmation callback handling; the initial email's
  localhost redirect cannot be rewritten, and native device callbacks were
  not exercised.
- Second-user isolation with a separate authenticated account.
- Live Responses API/model calls; Live AI intentionally remains off.
- Expiry, swap matching, and recorded activity through a live authenticated
  request. (The deployed Demo Mode and relevant local unit tests cover the
  common wallet/pricing/verification paths.)
- Execution of the pgTAP suite against Postgres.
- Physical-device Android camera/barcode/OCR behavior and native builds.
- Native iOS build and scanning/OCR behavior.

## Blocked

- A post-push `supabase migration list --linked` check could not authenticate
  to PostgreSQL because the CLI database-password authentication failed. The
  successful `db push` output and read-only object queries verified the schema,
  but that command-level migration-history check remains unavailable.
- The current account is authenticated and has a synthetic $30 unverified
  Starbucks QA card. The initial confirmation email's redirect cannot be
  rewritten; physical device email-link behavior remains untested. Keep email
  confirmation enabled.
- Remote Site URL, Redirect URLs, and the Confirm signup template were not
  exposed by the public Auth settings endpoint. Verify them in the Supabase
  Dashboard using the exact values and template guidance in `SUPABASE_SETUP.md`.
- No OpenAI call has been made yet. The per-user quota and token limit are not a
  global monthly spend cap; an account-level $100/month usage cap/alert remains
  a manual prerequisite to guarantee the overall budget.
- `WALLET_SWAP_ALLOWED_ORIGINS` is not configured. The tested localhost and
  Capacitor origins are allowed by the default list; configure the exact
  production browser origin before hosted-web use.
- iOS ML Kit barcode scanning and text recognition are incompatible with the
  existing SPM project because those plugins do not supply `Package.swift`.
  This Windows environment has no Xcode, Ruby, or CocoaPods; no iOS native
  build is claimed. The pre-migration checkpoint remains available.
- Deno and a local Postgres/Docker environment are unavailable, preventing
  Edge Function type-checking and local database/pgTAP execution.

## Deployment and safety status

Ruby's client UI, authenticated service helpers, Responses API function loop,
database-backed conversation code, and migrations are present locally; the
migrations have been applied and `ruby-chat` version 2 is deployed with JWT
verification and authenticated Demo Mode. An authenticated chat request
returned real wallet data from the signed-in user's RLS-scoped records. The
configured public browser key is stored in
ignored local environment configuration and is not recorded in this report.
No service-role key or OpenAI key is exposed in the browser.
Card credentials and raw photographs are not intentionally sent to Ruby;
manual review and the reported-balance confirmation remain in Add Card.

## Ruby activation update — 2026-10-23

### Passed locally and against the deployed function

- `npm.cmd test`: **56 passed, 0 failed**, including new Demo Mode intent,
  safe wallet response, currency separation, verification honesty, exact
  $30 pricing (`$27.00` asking price, `$1.35` fee, `$25.65` estimated payout),
  and strict Responses tool-schema checks.
- `npm.cmd run build`: passed.
- The browser recovered a valid Supabase session across a reload and opened
  Ruby without another login.
- After explicit approval, only `ruby-chat` was redeployed. Supabase reports
  version 2 as ACTIVE with `verify_jwt=true`; `account-delete` remains
  undeployed.
- An unauthenticated POST to the deployed function returned **401**; local
  browser CORS preflight returned **200** with the expected origin.
- An authenticated browser request completed in **Demo Mode** with real
  RLS-scoped data. Before adding the sample, Ruby correctly reported an empty
  wallet. A synthetic Starbucks card was then added through WalletSwap with
  a dummy all-zero identifier, no PIN, and a $30 reported balance. Ruby
  subsequently returned that card as unverified, reported a $30 USD total,
  calculated $27.00 asking price / $1.35 fee / $25.65 estimated payout, and
  stated that automatic retailer verification is unavailable.
- The chat and wallet card remained available after a browser reload.
- Local code now verifies the current user with `auth.getUser()` before
  restoring protected wallet data, clears in-memory Ruby state on account
  changes/logout, supports deleting owned conversations, and shows six
  supported quick actions.
- Local `ruby-chat` now defaults to authenticated deterministic Demo Mode.
  It uses the caller's RLS-scoped records, separates currencies, computes
  prices in integer cents, never claims retailer verification, and labels
  persisted responses as `[Demo Mode]` or `[Live AI Mode]`. OpenAI calls require
  explicit server-side `RUBY_AI_MODE=live`; the existing key alone does not
  trigger calls.

### Not yet verified / blocked

- The updated `ruby-chat` is **not deployed**. The existing deployed version
  predates these changes and does not include the fallback, so the current
  browser failure will continue until a separately approved redeployment.
- No OpenAI request was made. No `RUBY_AI_MODE` override is configured, so the
  deployed handler defaults to Demo Mode. Live AI credits/availability and
  the OpenAI account's monthly usage cap remain unverified.
- The synthetic card is now in the currently signed-in account. If this was
  not meant to be the QA account, remove that test card in WalletSwap.
- Second-user isolation was not runtime-tested with a separate account.
- Expiry, swap matching, activity, session expiry, invalid message, provider
  network failure, and rate-limit cases have automated/unit or static
  coverage where applicable, but were not all exercised against the deployed
  function.
- Deno is unavailable in this Windows environment, so the Edge Function could
  not be type-checked or served locally. Supabase CLI version is available,
  but no deploy was run.
- Physical-device/native verification and cross-user live isolation testing
  remain outstanding. Existing RLS policies and static tests continue to
  support owner isolation, but they do not replace two-account runtime tests.

Only the existing `ruby-chat` function is in scope for future deployment.
`account-delete` and all unrelated functions remain undeployed. No project,
schema, account, API key, or paid service was created or changed during this
activation work.

The two migrations were applied only after the user approved the dry-run set.
The user separately approved deployment of `ruby-chat`, using the API bundler
and leaving JWT verification enabled. No other function was deployed. Do not
create another project or deploy `account-delete`.

After a dedicated test account is signed in and has a synthetic unverified
$100 gift card, run these live questions and compare the answers to the
database:

- What gift cards do I have?
- What is my total reported balance?
- How much would I receive if I sold my $100 gift card?
- Which cards expire soon?
- Can you verify my gift-card balance?

Then sign in with a second test account and verify that Ruby cannot read the
first account's card. Until those checks pass, real database response behavior,
verification claims, and cross-account isolation are **not yet live-tested**.
# Current audit checkpoint

## Android cloud-login correction

The prior Android workflow (commit `4396f16a2f26db980f6660190674e41592b2328f`)
ran Vite without Supabase configuration. The app then correctly selected its
unconfigured/demo-only path, causing the reported cloud-login error. Its Ruby
floating entry was also hidden for demo accounts. The workflow now requires
nonempty public Supabase settings before the Android build, injects them before
Vite build and Capacitor sync, verifies the bundled client configuration and
Ruby UI, and rejects server-credential patterns. Ruby is now reachable from
demo mode, where it explicitly explains that Live requires a real signed-in
account and does not make fake-user backend calls.

The repository's original publishable variable was misspelled
`VITE_SUPABASE_PUBLISHED_KEY`. Its existing value was copied to the expected
`VITE_SUPABASE_PUBLISHABLE_KEY` repository variable without displaying it.
The workflow reads the canonical variable and keeps the old spelling as a
fallback. Existing Supabase Auth code already provides persisted sessions,
refresh, password login/registration, confirmation/resend, recovery, native
`walletswap://auth/callback`, and user-scoped wallet loading; no auth security
policy was disabled or weakened.

| Android cloud configuration check | Result |
|---|---|
| Required build variables, missing-value, HTTPS, secret-format guards | Passed |
| Compiled-bundle presence checks for Supabase and Ruby | Passed with local public configuration |
| Local regression suite | Passed: 76/76 |
| Local Vite build and `npx cap sync android` | Passed |
| Production dependency audit | Passed: 0 high/critical production advisories |
| New configured Android CI artifact | Passed: `walletswap-android-configured-debug`, run `40344925295`, commit `d43c1c8f9bad2b9300ba880d7278d516cca2c7fa` |

The following results supersede older test/deployment counts elsewhere in this
historical report:

| Check | Result | Boundary |
|---|---|---|
| `npm.cmd test -- --test-reporter=tap` | Passed: **76/76** in the latest run | Includes live-only Ruby behavior and usage-cost helper tests |
| `npm.cmd run build` | Passed | Vite production build |
| `npm.cmd run cap:sync` | Passed with warning | All 8 Capacitor plugins listed; ML Kit barcode/OCR packages still lack iOS `Package.swift` |
| `npm.cmd audit --omit=dev --audit-level=high` | Passed | 0 reported production dependency vulnerabilities |
| `git diff --check` | Passed | No whitespace errors |
| GitHub Actions CI | Passed | Web tests/build, Ruby Deno type-check, Android `assembleDebug`, and APK artifact upload |
| Android debug APK | Built in CI | Downloadable debug artifact; not installed or exercised on a physical device |
| Ruby unit/static checks | Passed | No OpenAI request or authenticated live flow was made |
| Native Android build on this host | Blocked | No Java/Android SDK/Studio/adb/Gradle installed in this Windows environment |
| Native iOS build | Blocked | Windows has no Xcode; ML Kit iOS integration needs the separately reviewed CocoaPods migration |
| Edge Function type-check on this host | Blocked | Deno unavailable; the CI Deno check passed |
| Database migration `003` / `004` | Applied after approval | Remote migration ledger reports `001` through `004` applied |
| Live Ruby deployment | Deployed after approval | Remote `ruby-chat` version 5 ACTIVE with JWT verification enabled |
| OpenAI live response / budget behavior | Untested | Model pricing and the selected monthly limit were configured after approval; a real authenticated OpenAI request has not been made |
| Physical-device camera/notifications | Untested | Requires Android/iPhone testing |
| Retailer feed / real payments / Wallet passes | Unavailable | No authorized retailer, payment, Apple issuer, or Google issuer integration is configured |

The table above records the earlier audit state and is superseded by the
deployment results below.

## Current deployment results

After explicit approval, migrations `20261023000300` and
`20261023000400` were applied to the existing Supabase project. The migration
ledger now reports `001` through `004` applied, and a subsequent `db push
--dry-run` reports no pending migrations.

Only `ruby-chat` was deployed using the Supabase API bundler. Supabase reports
it ACTIVE at version 5 with `verify_jwt=true`; `account-delete` remains
undeployed. The five non-key Edge Function settings were set to Live mode,
`gpt-4o-mini`, `$0.15` input and `$0.60` output per million tokens, and the
user-selected `$10` monthly application cap. The rates were checked against
the official pricing page:
https://developers.openai.com/api/docs/pricing. The existing `OPENAI_API_KEY`
was neither read nor changed, so its current presence and account/model access
remain unverified. No OpenAI request was made.

| Check | Result |
|---|---|
| `npm.cmd test` | Passed: **76/76** |
| `npm.cmd run build` | Passed: Vite production build |
| Apply migrations `003` and `004` | Passed after explicit approval |
| Remote migration dry-run | Passed: database up to date |
| Deploy only `ruby-chat` with API bundler | Passed: ACTIVE version 5 |
| JWT verification | Enabled (`verify_jwt=true`) |
| POST without authentication | Rejected: **HTTP 401** |
| `account-delete` deployment | Not performed |
| Authenticated Ruby/OpenAI request | Untested; no live request was made |

The `$10` cap is enforced by the application usage ledger based on configured
token rates and bounded reservations. It is not a provider billing guarantee;
an OpenAI account-level usage alert/budget is still recommended.

### Remaining live checks

- Verify the existing `OPENAI_API_KEY` is present in Supabase Edge Function
  Secrets without retrieving or displaying it, then test an authenticated Ruby
  request against a controlled account.
- With a synthetic `$100` unverified card, test wallet contents, total reported
  balance, illustrative sale estimate, expiring cards, and Ruby's refusal to
  claim balance verification. Compare results against authorized database
  rows.
- Test cross-user isolation using a second authenticated account. These
  account-specific live tests were not performed because no test-account
  credentials were available during deployment.
- Keep the OpenAI account-level usage alert/budget enabled; the app-level cap
  alone cannot guarantee total provider spend.

## Manual prerequisites by stage

1. **Ruby live validation:** confirm the existing OpenAI secret is available
   without displaying its value, then use a controlled test account and a
   synthetic $100 unverified card to compare live answers with database values.
   Repeat with a second account to verify cross-user isolation. The selected
   model, published pricing, $10 cap, migration application, and deployment are
   already configured.
2. **Android app:** use a machine or CI runner with Android SDK/JDK to verify
   the new debug build job and install the generated debug APK on a physical
   phone. Release signing and Play publication are separate approvals.
3. **iOS app:** use macOS/Xcode to review and perform the CocoaPods migration,
   sync, compile, and test scanning/notifications on an iPhone.
4. **Notifications and retailer events:** test notification permissions on
   physical devices. A real balance feed additionally needs a
   retailer-authorized API contract and provider signature credentials; no
   provider integration is configured.
5. **Apple/Google Wallet:** obtain issuer authorization, program/issuer access,
   certificates/signing setup, and device tests; no pass is currently issued.
6. **Hosted web auth:** provide the actual public HTTPS origin and add its
   callback/recovery URLs to the Supabase Auth allow-list; no URL has been
   invented or configured.

## Profile, Ruby, retailer, help, and scanner repair verification

This section records the latest UI repair work. Historical tables above are
preserved; the results below supersede their earlier test/build counts for this
change set.

| Check | Result | Boundary |
|---|---|---|
| `npm.cmd test` | Passed: **85/85** | Includes retailer helper/service tests, owner scoping, deletion request, Ruby scroll behavior, tour content, scanner handoff, and existing regression suites |
| `npm.cmd run build` | Passed | Vite production build |
| `npx.cmd cap sync android` | Passed | Synced 8 installed Capacitor plugins and current web assets |
| `git diff --check` | Passed | No whitespace errors |
| App-shell browser preview | Passed for navigation smoke checks | Local demo: home/help tour, demo wallet, Add Card recent retailers and manual retailer entry, Profile → Settings → Delete Account |
| Android status-bar/header behavior | Source fix present; physical device untested | Removed duplicate app-drawn stripe and phone top border; retained root safe-area insets and system status bar |
| Preference persistence | Service tests passed; reported device failure not reproduced | The earlier read-only Supabase check found the expected table/columns, own-row RLS, and authenticated update grants; no authenticated device session was available to capture the original failing request/status |
| Ruby scroll behavior | Helper/source regression passed | Browser demo cannot show chat history; authenticated saved-history behavior needs an account-backed app session |
| Pinned retailer storage | Unit and migration-policy checks passed | Migration is local and unapplied; the UI clearly reports this and leaves pin actions unavailable until applied |
| Delete-account request | Unit and browser routing checks passed | In-app flow uses warning, separate acknowledgement, account-email confirmation, and a mail request; account deletion itself is not performed |
| iOS build / native scanner | Not tested | Requires macOS, Xcode, and the separately approved iOS dependency migration |
| Android APK / physical Samsung rendering | `walletswap-phase1-repairs-debug` was built and uploaded by GitHub Actions; the latest run is listed at [WalletSwap CI](https://github.com/2606ruth-eng/walletswap/actions/workflows/ci.yml) | APK is not installed or exercised on a physical device; a CI build is not physical-screen validation |
| Real retailer verification, live payment, or external feed | Not available or tested | No provider integration was added or claimed |

The original `Mockup.html` remains preserved. The local demo was used only for
UI/navigation inspection; no real user, preference, or card data was modified.
The favorites migration was not deployed and no production services were
changed.
