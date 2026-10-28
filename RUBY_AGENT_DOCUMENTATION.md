# Ruby AI agent

## Current implementation

Ruby is available from the floating button for signed-in cloud accounts. The
chat view offers wallet questions and marketplace prompts, loading/error/retry
states, new conversations, and recent conversation selection. Messages are
loaded from Supabase and kept server-side in `ruby_conversations` and
`ruby_messages`. The Edge Function verifies the caller's Supabase session,
derives the user identity from that session, reads only that user's rows through
RLS, and persists assistant replies with the server-only service role.

Ruby's live Edge Function uses the OpenAI Responses API and reads
`OPENAI_API_KEY` only from server-side `Deno.env`. The handler fails closed
unless `RUBY_AI_MODE=live`, the key is present, and model pricing plus a
monthly budget are configured. It does not substitute Demo Mode when the
provider fails or returns unsafe output. The model is selected by
`RUBY_OPENAI_MODEL` (default `gpt-4o-mini`); requests set `store: false`, use
up to four Responses calls and four tool calls, a 20-second provider timeout,
and at most 600 output tokens per response. A database-backed limit allows
five user requests per minute.

Migration `20261023000400_ruby_usage_controls.sql` adds a service-only
reservation ledger. Ruby reserves a conservative estimate using configured
input/output prices and token bounds before calling OpenAI, then settles it
from token usage. The configured monthly cap must be between $0.01 and $100.
This guards estimated model spend across users; it is not an OpenAI billing
guarantee. Keep an OpenAI dashboard usage alert/budget enabled. If usage
metadata is absent or a provider request fails ambiguously, the full reservation
is retained conservatively. Tool arguments are parsed, allow-listed, and
validated before execution.
Card-like numbers, PINs, CVVs, security codes, and redemption codes in the
current message or stored history are rejected before provider submission.
Raw card credentials and photos are not included in Ruby prompts or tool
results. The request body is limited to 16 KB, and credential-like model output
is not persisted or returned. Stored context is limited to 8,000 characters
before the current user turn and bounded tool results.

## Wallet tools

- `get_wallet_summary` reports totals by currency and separates reported from
  verified balances.
- `get_wallet_cards` lists up to 50 of the signed-in user's active cards using
  safe metadata only, including reported balance and verification provenance.
- `get_card_details` returns safe metadata for a card owned by the caller.
- `get_card_activity` returns WalletSwap-recorded activity only.
- `get_expiring_cards` finds upcoming printed expiry dates.
- `get_recent_balance_changes` includes provenance and marks authorized decreases
  that need user review; this is not a fraud determination.
- `get_notification_preferences` and `get_recent_notifications` read the
  signed-in user's preferences and in-app notifications.
- `generate_weekly_wallet_summary` summarizes active balances and activity
  recorded by WalletSwap in the last seven days.
- `get_unused_cards` identifies cards without a recent recorded WalletSwap
  purchase; it cannot detect use outside WalletSwap.
- `estimate_listing_price` estimates 90% of the card's reported balance, a 5%
  fee, and the resulting payout, with balance verification status.
- `search_marketplace_listings` searches the restricted public listing view.
- `find_swap_matches` compares one owned card to public listing amounts.
- `prepare_listing` and `prepare_swap_request` return previews only; neither
  changes state or transfers a card.
- `get_wallet_pass_eligibility` reports unsupported unless an approved issuer
  integration exists.

  There is no configured external retailer transaction feed by default. Ruby must
  state that activity outside WalletSwap is unknown and must not present
  user-reported changes as retailer-verified events.

For a hypothetical amount explicitly supplied by the user, Ruby may show
illustrative pricing using the same 90% asking-price and 5% fee assumptions.
For a $100 example, those figures are $90.00 asking price, $4.50 fee, and
$85.50 estimated payout. This is not a listing, offer, sale, or guaranteed
payout.

## Setup and deployment status

**Current deployment status:** Supabase reports `ruby-chat` ACTIVE, version 5,
with JWT verification enabled. Migrations `20261023000100` through
`20261023000400` are applied; a dry-run reports no pending migrations. After
explicit approval, migrations `003` and `004` were applied and only `ruby-chat`
was deployed via the Supabase API bundler. `account-delete` was not deployed.
The server-side settings are `RUBY_AI_MODE=live`,
`RUBY_OPENAI_MODEL=gpt-4o-mini`, input/output prices of `$0.15`/`$0.60` per
million tokens, and the selected `$10` monthly application cap. These match
the standard rates published at
https://developers.openai.com/api/docs/pricing when checked. The existing
`OPENAI_API_KEY` value was neither read nor changed; its current availability
and model access have not been verified, and no live OpenAI request was made.
The application cap estimates/reserves model spend but is not an OpenAI billing
guarantee; keep an OpenAI account-level usage alert/budget enabled.

The browser project uses the existing `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_SUPABASE_AUTH_REDIRECT_URL`
variables. The configured project's public Auth settings endpoint returned
HTTP 200. The Supabase CLI is linked to the existing project. Prior work
reported read-only metadata checks of base-table RLS. An unauthenticated POST
to the deployed function returned HTTP 401. The current function-list query
reports only `ruby-chat` active. Never retrieve secret values. `account-delete`
remains undeployed.

## Deployment and test status

The deployed function is `ruby-chat` version 5 with JWT verification enabled.
The following command deploys only that function for a future, separately
approved update:

```powershell
npx.cmd supabase functions deploy ruby-chat --use-api
```

Historical notes below describe earlier versions and tests and are not current
deployment evidence. The signup/login UI now explains
required email confirmation, preserves the attempted address for sign-in,
offers a confirmation-resend action, and gives a specific message for
Supabase's `email_not_confirmed`, unauthorized-recipient, and email-rate-limit
responses. Actual confirmation email delivery, link completion, and
authenticated sign-in still need a user-controlled test; the initial
confirmation email did arrive, but its Android callback was unreachable. These
UI changes do not alter project Auth or redirect settings. The browser
recovered an authenticated session after reload and completed real authenticated
Demo Mode requests. A synthetic $30 Starbucks card with a dummy identifier and
no PIN was added to the currently signed-in account. Ruby returned the actual
unverified card and balance, calculated $27.00 asking / $1.35 fee / $25.65
estimated payout, and correctly stated it cannot verify the retailer balance.
The conversation and card persisted after reload. No OpenAI request was made.

Remaining manual/test steps:

1. Configure the callback URLs and Confirm signup template as documented in
   `SUPABASE_SETUP.md`. The test account's first confirmation email arrived,
   but its Android click used the old `http://localhost:5173/` redirect, which
   is unreachable from the phone. The old message cannot be retargeted. Open
   it on the Vite host or request a fresh link from the intended device/origin
   after configuration. Check Auth logs if the resend is not delivered; keep
   email confirmation enabled and do not share SMTP credentials in chat.
2. The current browser account is already signed in and has the synthetic $30
   unverified Starbucks sample. If this is not a test account, remove that card.
3. For live verification, use a controlled authenticated test account with a
   synthetic $100 unverified card, compare Ruby's wallet, reported-total,
   illustrative-sale, expiry, and verification answers with the database, then
   repeat with a second account to test isolation. These live authenticated
   checks have not yet been performed; no test-account credentials were
   available in this deployment step.
4. Verify that the existing `OPENAI_API_KEY` is available in Supabase Edge
   Function Secrets without displaying or retrieving its value, then run one
   authenticated live request and confirm actual OpenAI model access. The key
   was not inspected or changed during this deployment.
5. Set `WALLET_SWAP_ALLOWED_ORIGINS` to the exact deployed WalletSwap web
   origin before enabling a hosted browser domain. Its current default allows
   localhost and Capacitor origins.
6. Run the pgTAP suite and authenticated wallet persistence checks in a
   Postgres/Supabase test environment. Deno and local Postgres/Docker are not
   available in this Windows environment.

The `account-delete` function remains unreviewed and undeployed. Notification
and retailer-verification functions remain provider-gated stubs.

No new OpenAI request was made during deployment. The existing OpenAI key value
was never retrieved or changed. No new project or provider was added. Live mode
is configured server-side, but a successful live AI request remains unverified
until key availability and account/model access are checked.
