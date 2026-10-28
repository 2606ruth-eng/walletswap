# Gift-card balance verification setup

## Current state

Automatic retailer verification is **disabled**. The migrations
`20261028000500_retailer_favorites.sql` and
`20261028000600_gift_card_verification.sql` have been applied to the linked
Supabase project. The authenticated `check-card-balance` Edge Function is
deployed with JWT verification enabled. It enforces card ownership, retailer
approval, request de-duplication, rate limiting, and protected result
recording. The Adyen test request builder is based on the official Stored Value
API guide, but it is not connected to the function: the function accepts only a
card ID, request ID, and consent flag. It does not accept or log card numbers,
PINs, security codes, provider names, or client balances. Do not enable a
provider until a separately reviewed short-lived credential-handling flow is
approved and implemented.

The app's safe fallback is to open a verified official retailer page without
adding card data to its URL. The user returns to WalletSwap and enters the
balance they saw; that amount stays `USER_REPORTED`, never provider-verified.

## Retailer directory

The migration extends `retailer_integrations` with an official domain and
balance URL, supported card types, method, provider, credential requirement,
and last-checked timestamp. New directory entries default to `MANUAL_ONLY`.
The initial entries are:

| Retailer | Method | Official destination |
|---|---|---|
| Target | `OFFICIAL_WEBSITE` | <https://www.target.com/guest/gift-card-balance> |
| Starbucks | `OFFICIAL_WEBSITE` | <https://www.starbucks.com/gift/card/manage> |
| Other seeded retailers | `MANUAL_ONLY` | No URL configured |

Target's destination is the final same-domain URL documented by Target Help.
Starbucks' destination is its official gift-card management page; it is an
official site entry point, not a verified balance API. Links have no query
parameters, fragments, card number, PIN, or referrer. WalletSwap does not
scrape either page or trust a client-supplied redirect URL.

Sources checked 2026-10-28:

- [Target Help: checking your GiftCard balance](https://www.target.com/help/article/000062295)
- [Starbucks gift-card management](https://www.starbucks.com/gift/card/manage)

## Migration status

Both migrations below have already been applied to the linked WalletSwap
Supabase project. Do not run them again, reset the database, or push pending
migrations from a worktree that does not contain this migration history:

- `20261028000500_retailer_favorites.sql`
- `20261028000600_gift_card_verification.sql`

The verification migration extends the existing schema; it does not recreate
tables or reset data. To verify the deployed directory and columns in SQL
Editor, run:

   ```sql
   select retailer, verification_method, integration_status,
          supports_balance_verification, authorized_provider,
          official_domain, official_balance_url, credentials_required,
          last_checked_at
   from public.retailer_integrations
   where retailer in ('target', 'starbucks')
   order by retailer;

   select column_name
   from information_schema.columns
   where table_schema = 'public'
     and table_name = 'wallet_cards'
     and column_name in (
       'balance_verification_status', 'latest_provider_balance_minor',
       'latest_provider_currency', 'latest_provider_verified_at',
       'verification_provider_id', 'verification_error_category'
     )
   order by column_name;
   ```

The migration preserves existing `retailer_integrations` approval flags on
conflict, but none of the new directory defaults approve an API. Client roles
cannot write verification status or provider result fields. The completion RPC
is service-role-only; the start RPC derives the owner from `auth.uid()`.

## Edge Functions and deployment gate

The deployed function is `check-card-balance`; JWT verification is enabled in
`supabase/config.toml`. Changes to Ruby's read-only verification metadata tool
are in `ruby-chat`; that function was not deployed as part of this verification
deployment. The production endpoint was checked without Authorization and
returned HTTP 401. A valid-user integration test has not been run because no
synthetic test-user session was available; no test card was added to the
production project.

The function was deployed after the migrations had been applied, without
re-running migrations or deploying another function. Future updates, after
review and approval, can deploy only this function from the repository root:

```powershell
npx.cmd supabase functions deploy check-card-balance
npx.cmd supabase functions deploy ruby-chat
```

Do not pass `--no-verify-jwt`. Supabase supplies its standard URL, anon, and
service-role runtime settings; never put the service-role key in the app.

## Adyen TEST onboarding

No Adyen request was made and no API key or merchant account was inspected.
Adyen's official guide documents the `/checkBalance` operation, request fields
(`merchantAccount`, `reference`, optional `store`, and `paymentMethod` with
type, number, and optional credential/card metadata), and response
`resultCode` plus `currentBalance` in minor units. The prepared builder only
accepts the documented online types `svs` and `valuelink`; do not assume Givex
online support or an undocumented Intersolve type.

The API version and the exact merchant-specific field contract must be
confirmed in the official API Explorer for the authorized account before
activation. The adapter factory requires an explicit test enable flag, a
schema-verified flag, an API key, merchant account, selected type, and an
explicit API version; it is only a request builder/adapter factory and is not
connected to the Edge Function. Its isolated fake-fetch tests use synthetic
in-memory inputs and make no provider request. No sandbox balance request has
been made, persisted in the application, or displayed by the app. Test support also
requires an Adyen test merchant account, Stored Value API permissions, and a
matching official simulator card. Only the test host is coded, redirects are
rejected, and a sandbox result must remain labeled `TEST`; it is not a
production balance.

If a later approved implementation wires the adapter, configure the following
values as Supabase Edge Function Secrets (never in source control or client
environment variables):

- `ADYEN_API_KEY`
- `ADYEN_MERCHANT_ACCOUNT`
- `ADYEN_STORED_VALUE_API_VERSION` (only the version verified in API Explorer)
- `ADYEN_STORED_VALUE_TYPE` (`svs` or `valuelink` only after issuer confirmation)
- `ADYEN_STORED_VALUE_TEST_ENABLED`
- `ADYEN_STORED_VALUE_SCHEMA_VERIFIED`

These names are reserved for the future adapter and **are not currently read**.
Do not set them as a way to enable verification. Do not submit a real user's
card details until a separate, reviewed encrypted, short-lived, explicitly
consented credential path is approved. Tillo, InComm, and direct-merchant
adapters remain disabled placeholders; no API request shape is assumed for
them.

## Manual checks and Ruby

1. Select the retailer and explicitly confirm it in Add Card.
2. For Target or Starbucks, use **Check on [retailer]'s Website**. WalletSwap
   opens only the directory's fixed HTTPS URL and sends no card data in the URL
   or referrer.
3. Return to the still-open Add Card form, enter the balance displayed by the
   retailer, and save. The source and timestamp are shown as user-reported.
4. If there is no verified directory link, use the retailer's own app, official
   website, or printed support details manually. WalletSwap does not search or
   scrape retailer pages.

Ruby's `get_card_details` tool reads only safe, owner-scoped card metadata and
the public directory. It can report the supported method, official link,
latest provider balance and time, and safe failure category. It cannot access
card credentials, make retailer requests, or claim a provider balance while
the adapter is disabled.

## Tests and Android debug APK

Run local web tests, build, and Android asset synchronization:

```powershell
npm.cmd test
npm.cmd run build
npx.cmd cap sync android
```

For an unsigned debug APK, open the repository's **Actions → WalletSwap
Android APK → Run workflow** on the desired branch. Download the
`walletswap-android-debug` artifact from the completed run. It is not a signed
store release and does not prove physical-device scanning or retailer
verification.
