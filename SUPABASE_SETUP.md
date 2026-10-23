# Supabase setup

WalletSwap's Supabase integration is optional and environment-driven. The
existing project URL and publishable key are configured in the ignored
`.env.local`; the key is intentionally not documented here. The Auth settings
endpoint for that project responded successfully, with email auth configured
and signups not disabled. This verifies the public endpoint and client key, not
an authenticated account, the database schema, or deployed Edge Functions.

The Supabase CLI is authenticated and the local repository is linked to the
existing project. With the owner's approval, both local migrations were
applied. Read-only metadata queries verified the 17 public base tables have RLS
enabled; all except the server-only Ruby rate-limit table have policies, and
that table has no direct authenticated grants. `ruby-chat` is deployed with
JWT verification enabled; `account-delete` and all other functions remain
undeployed. Secret-name inspection confirms `OPENAI_API_KEY` is configured in
the server environment; its value was not retrieved. Do not create a second
Supabase project.

## Current linked-project status

The latest read-only CLI checks report migrations `20261023000100` and
`20261023000200` applied, with `20261023000300` and
`20261023000400` local and unapplied. The deployed function list contains only
`ruby-chat`, ACTIVE with JWT verification enabled (version 3). The current
local Ruby source has not been deployed. No migration or Edge Function was
deployed during this audit. Never run commands that print secret values.

## Local browser configuration

1. Install Node.js 20.19+ (or 22.12+) and Docker Desktop.
2. Copy `.env.example` to `.env.local`.
3. Add the Supabase project URL and its **publishable**/anon client key to the
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` variables. Do not use
   a service-role or `sb_secret_` key in the browser or native app.
4. Leave `VITE_SUPABASE_AUTH_REDIRECT_URL` blank during local development;
   WalletSwap uses the current Vite origin and the `/auth/callback` path. For a
   hosted build, set it to the real HTTPS application origin, not a placeholder
   or localhost URL. If blank in a hosted build, WalletSwap uses that page's
   HTTPS origin. Password recovery uses `/auth/recovery`. When the current
   origin is `http://localhost:5173`, the confirmation callback is
   `http://localhost:5173/auth/callback`; it is reachable only from the same
   computer running Vite. The browser warns about this before signup, login,
   or password reset. An email already sent with a localhost redirect cannot
   be changed retroactively.
5. Start the local Supabase stack, apply migrations, and run tests:

   ```sh
   npx supabase start
   npx supabase db reset
   npx supabase test db
   npx supabase db lint
   ```

   The commands that start/reset the database require Docker. The SQL tests
   use pgTAP and must be run against the local Supabase database; a CLI version
   check alone does not validate migrations.
6. Start WalletSwap with `npm run dev` and sign up a test account. Configure
   the local project's Auth URL allow-list before testing email confirmation
   and password recovery.

## Native auth redirects

Native signup/resend uses `walletswap://auth/callback`; password recovery uses
`walletswap://auth/recovery`. Both schemes are declared by the Android intent
filter and the iOS `walletswap` URL scheme, and Capacitor App forwards launch
and open-URL callbacks to Supabase session exchange.

In the existing Supabase project, open **Authentication > URL Configuration**
and add these exact local/native entries to **Redirect URLs**:

```text
http://localhost:5173/auth/callback
http://localhost:5173/auth/recovery
walletswap://auth/callback
walletswap://auth/recovery
```

When testing Vite from an Android browser over Wi-Fi, add the exact phone-
reachable Vite origin for both routes (for example,
`http://<your-computer-LAN-IP>:5173/auth/callback` and
`http://<your-computer-LAN-IP>:5173/auth/recovery`). Do not substitute a
guessed IP or a phone's `localhost`. A LAN URL can preview the page, but plain
HTTP on a LAN address is not a reliable Supabase authentication origin because
browser cryptography and network/firewall rules may block the auth flow. For
Android email confirmation, prefer requesting the link from the installed
WalletSwap app so it uses `walletswap://auth/callback`, or use a real HTTPS
deployment. Once an HTTPS deployment exists, add
`https://<real-hosted-origin>/auth/callback` and
`https://<real-hosted-origin>/auth/recovery`, and set **Site URL** to the real
hosted root URL. Configure the host's SPA fallback to serve `index.html` for
both callback paths. No hosted URL is currently configured or invented here.

In **Authentication > Email Templates > Confirm signup**, the confirmation
button must link to `{{ .ConfirmationURL }}` so Supabase verifies the token and
then honors the per-request redirect. Do not replace it with `{{ .SiteURL }}`.
The remote URL Configuration and email template are not exposed by the public
Auth settings endpoint; inspect and save these settings in the Dashboard.

Native Supabase auth sessions use the configured Capacitor secure-storage
adapter; browser sessions use local storage. Card numbers and PINs are not
uploaded to Supabase.

## Existing hosted project: migrations applied, Ruby deployed

The existing project is linked locally; linking did not apply migrations.
Before the approved push, `npx supabase migration list --linked` reported no
remote entries for:

```sh
20261023000100_walletswap_schema.sql
20261023000200_walletswap_operations.sql
```

`npx supabase db push --dry-run` confirmed those same two migrations would be
pushed. The first creates the WalletSwap profile, wallet, activity, marketplace,
Ruby conversation, notification, device-token, wallet-pass, retailer-integration
and import tables, with RLS, triggers, grants, and a restricted public listing
view. The second creates wallet and marketplace RPCs, simulated-purchase
handling, Ruby rate limiting, expiry notifications, and safe metadata import.
The owner approved applying both. The first push attempt exposed two SQL syntax
errors; those statements were corrected and both migrations then completed
successfully. A read-only query verified the resulting table/RLS metadata and
key RPC existence/grants. The pgTAP suite and authenticated application flows
have not been run against the hosted project.

Before any Edge Function deployment, check the secret names (never values),
report the exact functions, and request approval:

```sh
npx supabase secrets list --project-ref <existing-project-ref>
```

The current frontend invokes `ruby-chat` and `account-delete` as Edge
Functions; wallet and marketplace operations call database RPCs directly.
Only `ruby-chat` has been deployed, after explicit approval, using the API
bundler. JWT verification remains enabled. `account-delete` is intentionally
undeployed pending its own review and approval. Other functions present in the
repository are not currently called by the frontend. Do not deploy additional
functions without reviewing the exact function list and getting approval:

```sh
npx supabase functions deploy account-delete
npx supabase functions deploy wallet-actions
npx supabase functions deploy marketplace-actions
npx supabase functions deploy ruby-chat --use-api
npx supabase functions deploy notification-worker
npx supabase functions deploy authorized-balance-webhook
```

`notification-worker` and `authorized-balance-webhook` have local source but
are not reported as deployed. The webhook validates a signed payload and still
requires a configured secret and an approved retailer record for real events;
the explicit test-event path is unverified. Do not treat either function as an
active service until reviewed and deployed with the required configuration.
The existing server-side `OPENAI_API_KEY` was previously reported configured.
Never add that secret to `.env.local`, `VITE_*` variables, source code, or the
app bundle. Payments, settlement,
gift-card transfers, push delivery, and wallet-pass issuance are not configured.

The local CORS defaults allow localhost and Capacitor origins. Configure
`WALLET_SWAP_ALLOWED_ORIGINS` with the exact production browser origin before
using Ruby from a hosted domain. The current deployed function's existing
per-user request/token limits do not establish a verified global dollar cap.
The un-deployed migration and local handler add estimated monthly reservation
controls; they become active only after reviewed migration/function deployment
and correct server-side model price configuration. No new paid scanning or AI
service was added.

The current local `ruby-chat` implementation is live-only: it fails closed
unless `RUBY_AI_MODE=live`, `OPENAI_API_KEY`, model pricing, and a monthly
budget are configured. It has no simulated response fallback. Migration `004`
adds a service-only monthly cost-reservation ledger; its configured cap cannot
exceed $100, but the cap is based on current model prices supplied by the
operator and is not an OpenAI billing guarantee. Keep an OpenAI dashboard
budget/alert enabled.

The current local Edge Function and migration `004` have not been deployed.
Before activation, review/apply migrations `003` and `004`, choose a monthly
limit no higher than $100, verify current official model pricing, configure
the server-only `RUBY_AI_MODE`, `RUBY_OPENAI_MODEL`,
`RUBY_INPUT_COST_PER_MILLION_USD`, `RUBY_OUTPUT_COST_PER_MILLION_USD`, and
`RUBY_MONTHLY_BUDGET_USD` settings, then request explicit approval to deploy
only `ruby-chat`. Never put any OpenAI credential in `.env.local`, `VITE_*`
variables, source, or the native app bundle.
