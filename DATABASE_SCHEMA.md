# WalletSwap backend data model

The versioned database definition is in `supabase/migrations/`. All user-owned
tables use Row Level Security (RLS); direct table grants are narrowed and
ownership policies use the authenticated Supabase user ID. Sensitive card
redemption credentials are intentionally absent from this schema.

| Table/view | Purpose |
| --- | --- |
| `profiles` | Display name tied to `auth.users`; profile row created by an auth trigger |
| `wallet_cards` | Retailer, type, currency, printed face value, user-reported balance, masked identifier, expiry, and verification metadata |
| `balance_observations` | Provenance for reported or authorized balance observations |
| `card_activity` | Append-only, idempotent user-reported card activity and balance history |
| `marketplace_listings` | Listing preview, ask, fee estimate, payout estimate, and lifecycle state |
| `swap_requests` | Proposals and responses; no transfer or settlement is implemented |
| `transaction_records` | Simulation-only purchase/swap records and idempotency keys |
| `ruby_conversations`, `ruby_messages`, `ruby_tool_events`, `ruby_rate_limits` | Ruby AI history, tool audit metadata, and request throttling |
| `notifications`, `notification_preferences`, `device_tokens` | In-app notifications, user preferences, and provider-gated device tokens |
| `wallet_passes` | Eligibility metadata; pass issuance is unsupported |
| `retailer_integrations` | Administrative integration configuration; no retailer is enabled |
| `local_import_receipts` | Idempotency receipt for user-confirmed local metadata import |
| `public_marketplace_listings` | Read-only listing view that omits seller identity and card credentials |

The operation migration provides guarded database functions for recording
reported spending and balance adjustments, archiving cards, creating or
repricing listings, responding to swaps, preparing simulated purchases,
checking pass eligibility, scheduling expiry notifications, importing local
metadata, and rate-limiting Ruby requests. Business-critical numeric
calculations use PostgreSQL `numeric` amounts, row locks, and idempotency keys.

Every balance shown in the UI is user-reported unless the database explicitly
marks it `verified` by an authorized retailer source. A printed face value is
never used as a current remaining balance. The public listing view contains
only masked card metadata; full numbers, PINs, security codes, and raw photos
remain outside Supabase.

The included pgTAP test file is an integration-test draft. It has not been run
because Docker/local Postgres is unavailable in the current development
environment. Review and run the migrations and tests against a fresh local
Supabase stack before staging deployment.
