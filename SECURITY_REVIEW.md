# Backend security controls and remaining review

This document records implementation controls and known deployment gaps. It
is not an independent penetration test, formal security audit, or approval for
production use.

## Implemented controls

- User data tables enable RLS, with ownership policies based on `auth.uid()`.
- The browser accepts only Supabase URL plus a publishable/anon key; it rejects
  an `sb_secret_` or service-role key.
- Service-role credentials are read only from Edge Function environment
  variables and are not embedded in Vite code.
- Card metadata requests deliberately omit complete card numbers, PINs, CVCs,
  and raw photos. Native card numbers/PINs are stored with the secure-storage
  plugin; local snapshots mask card identifiers and omit credentials.
- Reported balances remain explicitly unverified. SQL checks prevent an
  untrusted client from setting authorized verification provenance.
- Financial-style database operations validate amounts, use row locks where
  appropriate, and support idempotency keys. Marketplace purchase preparation
  records simulation state only.
- Edge Function request handling centralizes CORS/origin checks and user
  authentication; rate limits, allow-listed tool arguments, and bounded
  Responses API tool calls are part of the Ruby endpoint. It refuses
  credential-like prompts rather than forwarding them. Ruby conversations
  and messages use per-user RLS; only the service-role server writes assistant
  messages.
- The Ruby chat UI now calls the authenticated Edge Function, loads prior
  conversations through RLS, and presents wallet-specific quick actions.
- Static migration review found least-privilege wallet-card grants, owner RLS,
  no direct client write grants for transaction records or verification
  observations, and separate service-only verification/notification RPC
  execution. Marketplace listings expose a restricted public view without
  seller identity or card credentials.
- The existing project's Auth settings endpoint responded HTTP 200 to the
  configured publishable client; email auth is configured and signup is not
  disabled. This did not authenticate a user or inspect hosted database state.
- Explicit local import filters out demo accounts and all full credentials.

## Blocking gaps before any staging or production use

- Both SQL migrations were applied to the existing project after explicit
  approval. Read-only metadata checks confirmed RLS is enabled on all 17
  public base tables, with policies on the 16 user-facing tables and no direct
  authenticated grants on the Ruby rate-limit table. The pgTAP suite has not
  been executed; actual authenticated RLS behavior remains unverified.
- `ruby-chat` is deployed with JWT verification enabled. An unauthenticated
  POST returned 401 and the local-browser CORS preflight passed. No authenticated
  message has been sent, so the Responses API/provider runtime and Ruby
  conversation behavior remain untested.
- Key wallet, marketplace, import, and Ruby rate-limit RPCs exist with
  authenticated execute grants, confirmed through read-only metadata queries.
  This does not verify runtime behavior. The `OPENAI_API_KEY` secret is present
  by name only; its value was not retrieved. Deno type-checking remains
  unavailable.
- Only `ruby-chat` is deployed. `account-delete` remains undeployed. Hosted
  browser CORS allow-list and JWT behavior must be configured/tested for any
  production web origin; webhook signature validation remains unverified.
- Hosted Auth redirect allow-lists, email confirmation delivery, logging
  policy, monitoring, backup/restore test, retention policy, and incident
  response process have not been verified.
- The browser CORS allow-list currently falls back to local development and
  Capacitor origins because `WALLET_SWAP_ALLOWED_ORIGINS` is not configured.
  Configure the exact production web origin before using the function from a
  hosted browser domain. Keep the OpenAI key server-only and never expose its
  value.
- The request quotas limit each user to five calls/minute and each response to
  600 output tokens; they do not enforce a global monthly spend cap. Set an
  account-level budget/alert before broad beta usage.
- Retailer verification, payment processing, gift-card transfer, payout,
  push delivery, and wallet-pass issuance are disabled or stubbed. Never treat
  an unverified reported balance or marketplace preview as an issued/settled
  asset.
- Native Android/iOS auth, secure storage, camera, and app-link flows still
  require platform builds and physical-device testing.
- iOS barcode scanning and OCR remain blocked by the existing SPM project and
  the ML Kit plugins' CocoaPods-only support; preserve the pre-migration
  checkpoint and do not claim iOS scanning is operational.

Do not put secrets, real card credentials, or production user data in test
fixtures, client configuration, app logs, or issue attachments.
