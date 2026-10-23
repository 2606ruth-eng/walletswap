create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80))
  on conflict (id) do nothing;
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create table public.wallet_cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  retailer text not null check (retailer ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  nickname text not null default '' check (char_length(nickname) <= 80),
  card_type text not null check (card_type in ('physical', 'digital')),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  original_value numeric(12,2) not null check (original_value > 0),
  reported_balance numeric(12,2) not null check (reported_balance >= 0 and reported_balance <= original_value),
  expiration_date date,
  masked_identifier text not null default '' check (char_length(masked_identifier) <= 8),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'pending', 'verified', 'failed')),
  verification_source text not null default 'user_reported'
    check (verification_source in ('user_reported', 'authorized_retailer', 'manual_entry', 'import')),
  verified_at timestamptz,
  last_activity_at timestamptz not null default now(),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_cards_verified_source check (
    (verification_status = 'verified' and verification_source = 'authorized_retailer' and verified_at is not null)
    or (verification_status <> 'verified' and verified_at is null)
  )
);

create index wallet_cards_owner_active_idx on public.wallet_cards (owner_id, last_activity_at desc)
  where archived_at is null;
create index wallet_cards_expiration_idx on public.wallet_cards (expiration_date)
  where archived_at is null and expiration_date is not null;

create table public.balance_observations (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.wallet_cards(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  balance numeric(12,2) not null check (balance >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  observation_source text not null check (
    observation_source in ('user_reported', 'authorized_retailer', 'manual_entry', 'import')
  ),
  verification_status text not null check (verification_status in ('unverified', 'verified', 'pending', 'failed')),
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint balance_observations_verified_source check (
    verification_status <> 'verified' or observation_source = 'authorized_retailer'
  )
);
create index balance_observations_card_idx on public.balance_observations (card_id, observed_at desc);
create index balance_observations_owner_idx on public.balance_observations (owner_id, observed_at desc);

create table public.card_activity (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.wallet_cards(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  activity_type text not null check (
    activity_type in ('added', 'purchase', 'balance_adjustment', 'verification_update', 'archived', 'listed', 'unlisted')
  ),
  amount numeric(12,2) not null default 0,
  previous_balance numeric(12,2) check (previous_balance is null or previous_balance >= 0),
  new_balance numeric(12,2) check (new_balance is null or new_balance >= 0),
  data_source text not null check (
    data_source in ('user_reported', 'authorized_retailer', 'manual_entry', 'import', 'system')
  ),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'pending', 'failed')),
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint card_activity_idempotency_key_length check (
    idempotency_key is null or char_length(idempotency_key) between 16 and 128
  ),
  constraint card_activity_verified_source check (
    verification_status <> 'verified' or data_source = 'authorized_retailer'
  )
);
create unique index card_activity_idempotency_idx
  on public.card_activity (owner_id, idempotency_key) where idempotency_key is not null;
create index card_activity_owner_created_idx on public.card_activity (owner_id, created_at desc);
create index card_activity_card_created_idx on public.card_activity (card_id, created_at desc);

create table public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.wallet_cards(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  asking_price numeric(12,2) not null check (asking_price > 0),
  discount_percentage numeric(5,2) not null check (discount_percentage between 0 and 100),
  fee_percentage numeric(5,2) not null default 5 check (fee_percentage between 0 and 100),
  estimated_seller_payout numeric(12,2) not null check (estimated_seller_payout >= 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'reserved', 'sold', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_listing_amounts check (
    asking_price - estimated_seller_payout >= 0
    and estimated_seller_payout <= asking_price
  )
);
create unique index marketplace_one_open_listing_per_card_idx
  on public.marketplace_listings (card_id) where status in ('active', 'reserved');
create index marketplace_active_created_idx on public.marketplace_listings (created_at desc)
  where status = 'active';
create index marketplace_seller_status_idx on public.marketplace_listings (seller_id, status, created_at desc);

create table public.swap_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  offered_card_id uuid not null references public.wallet_cards(id) on delete restrict,
  requested_listing_id uuid not null references public.marketplace_listings(id) on delete restrict,
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'rejected', 'cancelled', 'expired', 'completed')),
  requester_confirmed_at timestamptz,
  recipient_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint swap_request_distinct_parties check (requester_id <> recipient_id)
);
create index swap_requests_requester_idx on public.swap_requests (requester_id, created_at desc);
create index swap_requests_recipient_idx on public.swap_requests (recipient_id, created_at desc);
create unique index swap_requests_one_pending_listing_idx
  on public.swap_requests (requested_listing_id) where status = 'accepted';

create table public.transaction_records (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid references auth.users(id) on delete set null,
  seller_id uuid references auth.users(id) on delete set null,
  listing_id uuid references public.marketplace_listings(id) on delete set null,
  transaction_type text not null check (transaction_type in ('simulated_purchase', 'simulated_swap')),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  platform_fee numeric(12,2) not null default 0 check (platform_fee >= 0 and platform_fee <= amount),
  status text not null check (
    status in ('simulation_pending', 'simulation_succeeded', 'simulation_failed', 'cancelled')
  ),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_id, idempotency_key)
);
create index transaction_records_buyer_idx on public.transaction_records (buyer_id, created_at desc);
create index transaction_records_seller_idx on public.transaction_records (seller_id, created_at desc);

create table public.ruby_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'WalletSwap assistant' check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ruby_conversations_user_updated_idx on public.ruby_conversations (user_id, updated_at desc);

create table public.ruby_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ruby_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index ruby_messages_conversation_created_idx on public.ruby_messages (conversation_id, created_at);

create table public.ruby_tool_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.ruby_conversations(id) on delete set null,
  tool_name text not null check (char_length(tool_name) between 1 and 80),
  execution_status text not null check (execution_status in ('succeeded', 'rejected', 'failed')),
  created_at timestamptz not null default now()
);
create index ruby_tool_events_user_created_idx on public.ruby_tool_events (user_id, created_at desc);

create table public.ruby_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope = 'ruby_chat'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (user_id, scope, window_started_at)
);

create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  card_activity_enabled boolean not null default true,
  balance_change_enabled boolean not null default true,
  expiry_reminders_enabled boolean not null default true,
  weekly_summary_enabled boolean not null default false,
  marketplace_alerts_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null check (
    notification_type in ('expiry_reminder', 'purchase', 'balance_change', 'marketplace', 'swap', 'weekly_summary')
  ),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 500),
  related_card_id uuid references public.wallet_cards(id) on delete set null,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  provider text not null check (provider in ('apns', 'fcm', 'webpush')),
  token text not null check (char_length(token) between 20 and 4096),
  enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, provider, token)
);
create index device_tokens_enabled_user_idx on public.device_tokens (user_id) where enabled;

create table public.wallet_passes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.wallet_cards(id) on delete cascade,
  platform text not null check (platform in ('apple', 'google')),
  issuer_reference text,
  pass_identifier text,
  eligibility_status text not null default 'unsupported'
    check (eligibility_status in ('eligible', 'pending_issuer', 'unsupported', 'issued', 'revoked')),
  last_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, card_id, platform)
);
create index wallet_passes_user_idx on public.wallet_passes (user_id, created_at desc);

create table public.retailer_integrations (
  retailer text primary key check (retailer ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  integration_name text not null check (char_length(integration_name) between 1 and 120),
  integration_status text not null default 'unavailable'
    check (integration_status in ('unavailable', 'sandbox', 'approved', 'disabled')),
  supports_balance_verification boolean not null default false,
  supports_pass_issuance boolean not null default false,
  public_notes text not null default '' check (char_length(public_notes) <= 500),
  updated_at timestamptz not null default now()
);

create table public.local_import_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source = 'walletswap_local_v1'),
  imported_count integer not null check (imported_count >= 0),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create or replace function public.record_initial_card_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.balance_observations (
    card_id, owner_id, balance, currency, observation_source, verification_status
  ) values (
    new.id, new.owner_id, new.reported_balance, new.currency, new.verification_source, new.verification_status
  );
  insert into public.card_activity (
    card_id, owner_id, activity_type, amount, previous_balance, new_balance, data_source, verification_status
  ) values (
    new.id, new.owner_id, 'added', new.reported_balance, null, new.reported_balance, new.verification_source, new.verification_status
  );
  return new;
end;
$$;

create or replace function public.record_user_reported_balance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.reported_balance is distinct from old.reported_balance then
    insert into public.balance_observations (
      card_id, owner_id, balance, currency, observation_source, verification_status
    ) values (
      new.id, new.owner_id, new.reported_balance, new.currency, 'user_reported', 'unverified'
    );
    new.last_activity_at = now();
  end if;
  return new;
end;
$$;

create trigger wallet_cards_updated_at before update on public.wallet_cards
  for each row execute function public.set_updated_at();
create trigger wallet_cards_initial_state after insert on public.wallet_cards
  for each row execute function public.record_initial_card_state();
create trigger wallet_cards_reported_balance before update of reported_balance on public.wallet_cards
  for each row execute function public.record_user_reported_balance();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger marketplace_listings_updated_at before update on public.marketplace_listings
  for each row execute function public.set_updated_at();
create trigger swap_requests_updated_at before update on public.swap_requests
  for each row execute function public.set_updated_at();
create trigger transaction_records_updated_at before update on public.transaction_records
  for each row execute function public.set_updated_at();
create trigger ruby_conversations_updated_at before update on public.ruby_conversations
  for each row execute function public.set_updated_at();
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();
create trigger retailer_integrations_updated_at before update on public.retailer_integrations
  for each row execute function public.set_updated_at();

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

alter table public.profiles enable row level security;
alter table public.wallet_cards enable row level security;
alter table public.balance_observations enable row level security;
alter table public.card_activity enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.swap_requests enable row level security;
alter table public.transaction_records enable row level security;
alter table public.ruby_conversations enable row level security;
alter table public.ruby_messages enable row level security;
alter table public.ruby_tool_events enable row level security;
alter table public.ruby_rate_limits enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.device_tokens enable row level security;
alter table public.wallet_passes enable row level security;
alter table public.retailer_integrations enable row level security;
alter table public.local_import_receipts enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy wallet_cards_select_own on public.wallet_cards for select to authenticated
  using (owner_id = (select auth.uid()));
create policy wallet_cards_insert_own on public.wallet_cards for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and verification_status = 'unverified'
    and verification_source in ('user_reported', 'manual_entry', 'import')
    and verified_at is null
  );
create policy wallet_cards_update_own on public.wallet_cards for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy wallet_cards_delete_own on public.wallet_cards for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy balance_observations_select_own on public.balance_observations for select to authenticated
  using (owner_id = (select auth.uid()));
create policy card_activity_select_own on public.card_activity for select to authenticated
  using (owner_id = (select auth.uid()));

create policy marketplace_listings_select_seller on public.marketplace_listings for select to authenticated
  using (seller_id = (select auth.uid()));

create policy swap_requests_select_participant on public.swap_requests for select to authenticated
  using (requester_id = (select auth.uid()) or recipient_id = (select auth.uid()));

create policy transaction_records_select_participant on public.transaction_records for select to authenticated
  using (buyer_id = (select auth.uid()) or seller_id = (select auth.uid()));

create policy ruby_conversations_select_own on public.ruby_conversations for select to authenticated
  using (user_id = (select auth.uid()));
create policy ruby_conversations_insert_own on public.ruby_conversations for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy ruby_conversations_update_own on public.ruby_conversations for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy ruby_conversations_delete_own on public.ruby_conversations for delete to authenticated
  using (user_id = (select auth.uid()));

create policy ruby_messages_select_own on public.ruby_messages for select to authenticated
  using (user_id = (select auth.uid()));
create policy ruby_messages_insert_user_message on public.ruby_messages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'user'
    and exists (
      select 1 from public.ruby_conversations c
      where c.id = conversation_id and c.user_id = (select auth.uid())
    )
  );

create policy ruby_tool_events_select_own on public.ruby_tool_events for select to authenticated
  using (user_id = (select auth.uid()));

create policy notification_preferences_select_own on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_preferences_update_own on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy device_tokens_select_own on public.device_tokens for select to authenticated
  using (user_id = (select auth.uid()));
create policy device_tokens_insert_own on public.device_tokens for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy device_tokens_update_own on public.device_tokens for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy device_tokens_delete_own on public.device_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

create policy wallet_passes_select_own on public.wallet_passes for select to authenticated
  using (user_id = (select auth.uid()));

create policy retailer_integrations_read_public on public.retailer_integrations for select to anon, authenticated
  using (integration_status <> 'disabled');

create policy local_import_receipts_select_own on public.local_import_receipts for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (id, display_name) on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select on public.wallet_cards to authenticated;
grant insert (owner_id, retailer, nickname, card_type, currency, original_value, reported_balance, expiration_date, masked_identifier)
  on public.wallet_cards to authenticated;
grant update (nickname, card_type, expiration_date) on public.wallet_cards to authenticated;

grant select on public.balance_observations, public.card_activity to authenticated;
grant select on public.marketplace_listings, public.swap_requests, public.transaction_records to authenticated;
grant select, insert, update, delete on public.ruby_conversations to authenticated;
grant select, insert on public.ruby_messages to authenticated;
grant select on public.ruby_tool_events to authenticated;
grant select, update (card_activity_enabled, balance_change_enabled, expiry_reminders_enabled, weekly_summary_enabled, marketplace_alerts_enabled)
  on public.notification_preferences to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update (enabled, last_seen_at), delete on public.device_tokens to authenticated;
grant select (id, user_id, platform, provider, enabled, last_seen_at, created_at)
  on public.device_tokens to authenticated;
grant select on public.wallet_passes to authenticated;
grant select on public.retailer_integrations to anon, authenticated;
grant select on public.local_import_receipts to authenticated;

create view public.public_marketplace_listings
with (security_barrier = true)
as
select
  l.id,
  c.retailer,
  c.card_type,
  c.currency,
  c.reported_balance,
  l.asking_price,
  l.discount_percentage,
  l.fee_percentage,
  l.estimated_seller_payout,
  l.created_at
from public.marketplace_listings l
join public.wallet_cards c on c.id = l.card_id
where l.status = 'active'
  and c.archived_at is null
  and c.verification_status in ('unverified', 'pending', 'verified', 'failed');
grant select on public.public_marketplace_listings to anon, authenticated;
