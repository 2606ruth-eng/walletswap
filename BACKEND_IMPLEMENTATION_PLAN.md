# WalletSwap backend implementation status and next steps

## Implemented in this repository

- Supabase JS client setup is optional and validates the project URL and
  publishable key. No secret key or hosted-project credential is committed.
- Supabase Auth is wired into sign-up, sign-in, session restoration, sign-out,
  email confirmation messaging, password recovery, and profile-name updates.
  Local non-demo registration/login is disabled. The demo wallet remains
  available.
- The existing app screens now load remote profile, wallet, activity, and
  public marketplace data for a signed-in cloud account.
- Card creation sends only retailer, type, currency, values, expiry, and a
  masked identifier to Supabase. Native card credentials stay in the device
  secure-storage vault; browser storage does not persist them.
- Reported spending/balance correction, card archival, listing creation,
  repricing/cancellation, and simulated purchase preparation use database
  operations. Listings, purchases, balances, and transfers are not represented
  as completed financial activity.
- Marketplace payment-card collection, bank details, withdrawals, and account
  email changes are blocked for cloud accounts. Cloud wallet cards are
  archived individually; bulk clear is unavailable.
- Legacy local card metadata import requires an explicit confirmation, excludes
  demo data and complete credentials, and does not delete the original local
  state.
- SQL migrations, RLS policies, Edge Function handlers, an RLS/business
  operation pgTAP draft, and frontend service unit tests are present.

## Before using a local backend

1. Install Docker Desktop and start it.
2. Copy `.env.example` to `.env.local`; use local Supabase URL and the local
   publishable/anon key. Never put a service-role key in client variables.
3. Run `npx supabase start`, `npx supabase db reset`,
   `npx supabase test db`, and `npx supabase db lint`.
4. Fix all SQL, RLS, pgTAP, and Edge Function runtime/type-check failures.
   Confirm sign-up, email confirmation, recovery links, user isolation,
   credential omission, imports, and account deletion with two test users.
5. Run the browser build/tests and test Android/iOS auth session handling,
   credential-vault access, camera integration, and app-link redirects on
   physical devices.

## Before staging or production

1. Use only the configured existing Supabase project. Obtain explicit approval
   before applying its two pending SQL migrations or deploying any Edge
   Function. Do not create another Supabase project.
2. Review the schema, RLS, Edge Function authorization/CORS, SQL SECURITY
   DEFINER functions, key rotation, deletion behavior, backups, monitoring,
   abuse limits, and incident response with the project security owner.
3. Deploy only to staging; seed no real gift-card credentials or payment data.
4. Configure only server-side secrets needed by explicitly approved functions.
   The existing project's `OPENAI_API_KEY` is not configured; Ruby/OpenAI stays
   disabled until the owner configures it and approves deployment. Retailer
   verification, money movement, notifications, and wallet passes stay
   unsupported until their providers are approved.
5. Perform an independent security review and operational sign-off before any
   production migration or user onboarding.

## Current validation limitations

`npm test` and `npm run build` cover the browser-side code. The existing hosted
project is linked and both migrations were applied after explicit owner
approval. Read-only metadata checks confirmed 17 public base tables with RLS
enabled and key RPC grants. No local Supabase database, pgTAP run, migration
lint, Edge Function deployment, or Android/iOS native build has been completed
here. No credentials or functions have been pushed to the hosted project.
