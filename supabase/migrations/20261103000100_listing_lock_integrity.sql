-- REVIEW REQUIRED: not applied to any environment. Requires owner approval before `supabase db push`.
-- Internal WalletSwap listing-lock integrity. This does NOT freeze or reserve a card at the retailer.

create table if not exists public.marketplace_settings (
  singleton boolean primary key default true check (singleton),
  fee_percentage numeric(5,2) not null default 5 check (fee_percentage >= 0 and fee_percentage <= 50),
  updated_at timestamptz not null default now()
);
insert into public.marketplace_settings (singleton) values (true) on conflict do nothing;
alter table public.marketplace_settings enable row level security;
revoke all on public.marketplace_settings from anon, authenticated;
create policy marketplace_settings_read on public.marketplace_settings for select to authenticated using (true);
grant select on public.marketplace_settings to authenticated;

create or replace function public.marketplace_fee_percentage()
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce((select fee_percentage from public.marketplace_settings where singleton), 5) $$;
revoke all on function public.marketplace_fee_percentage() from public, anon;
grant execute on function public.marketplace_fee_percentage() to authenticated;

create or replace function public.card_has_open_listing(p_card_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.marketplace_listings
                 where card_id = p_card_id and status in ('active', 'reserved'))
$$;
revoke all on function public.card_has_open_listing(uuid) from public, anon, authenticated;

-- User-initiated balance changes and archiving are rejected while a listing holds the card.
-- Server-side provider updates (no auth.uid()) are intentionally not blocked.
create or replace function public.enforce_listing_lock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and (new.reported_balance is distinct from old.reported_balance
          or (new.archived_at is distinct from old.archived_at and new.archived_at is not null))
     and public.card_has_open_listing(old.id) then
    raise exception using errcode = '55006',
      message = 'Card is locked for sale in WalletSwap. Cancel the listing first.';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_listing_lock() from public, anon, authenticated;
drop trigger if exists wallet_cards_enforce_listing_lock on public.wallet_cards;
create trigger wallet_cards_enforce_listing_lock before update on public.wallet_cards
  for each row execute function public.enforce_listing_lock();

create or replace function public.create_marketplace_listing(p_card_id uuid, p_asking_price numeric default null)
returns public.marketplace_listings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_card public.wallet_cards;
  v_listing public.marketplace_listings;
  v_price numeric(12,2);
  v_fee_pct numeric := public.marketplace_fee_percentage();
  v_fee numeric(12,2);
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select * into v_card from public.wallet_cards
  where id = p_card_id and owner_id = v_user_id and archived_at is null
  for update;
  if not found or v_card.reported_balance <= 0 then
    raise exception using errcode = 'P0002', message = 'Available card not found';
  end if;
  if exists (select 1 from public.swap_requests
             where offered_card_id = v_card.id and status = 'accepted') then
    raise exception using errcode = '55006', message = 'Card is committed to an accepted swap';
  end if;
  if p_asking_price is not null and p_asking_price <> round(p_asking_price, 2) then
    raise exception using errcode = '22023', message = 'Asking price is invalid';
  end if;
  v_price := coalesce(p_asking_price, round(v_card.reported_balance * 0.90, 2));
  if v_price < round(v_card.reported_balance * 0.50, 2) then
    raise exception using errcode = '22023', message = 'Asking price is below the permitted minimum';
  end if;
  if v_price <= 0 or v_price >= v_card.reported_balance then
    raise exception using errcode = '22023', message = 'Card balance is not eligible for listing';
  end if;
  v_fee := round(v_price * v_fee_pct / 100, 2);

  insert into public.marketplace_listings (
    card_id, seller_id, currency, asking_price, discount_percentage,
    fee_percentage, estimated_seller_payout, status
  ) values (
    v_card.id, v_user_id, v_card.currency, v_price,
    round((v_card.reported_balance - v_price) * 100 / v_card.reported_balance, 2),
    v_fee_pct, v_price - v_fee, 'active'
  ) returning * into v_listing;

  insert into public.card_activity (
    card_id, owner_id, activity_type, amount, previous_balance, new_balance, data_source, verification_status
  ) values (
    v_card.id, v_user_id, 'listed', 0, v_card.reported_balance, v_card.reported_balance, 'system', v_card.verification_status
  );
  return v_listing;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Card already has an active listing';
end;
$$;

create or replace function public.reprice_marketplace_listing(p_listing_id uuid, p_asking_price numeric)
returns public.marketplace_listings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_listing public.marketplace_listings;
  v_balance numeric(12,2);
  v_fee_pct numeric := public.marketplace_fee_percentage();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_asking_price is null or p_asking_price <> round(p_asking_price, 2) then
    raise exception using errcode = '22023', message = 'Asking price is invalid';
  end if;
  select l.* into v_listing
  from public.marketplace_listings l
  join public.wallet_cards c on c.id = l.card_id
  where l.id = p_listing_id and l.seller_id = v_user_id and l.status = 'active' and c.archived_at is null
  for update of l, c;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active listing not found';
  end if;
  select reported_balance into v_balance from public.wallet_cards where id = v_listing.card_id;
  if p_asking_price < round(v_balance * 0.50, 2) or p_asking_price >= v_balance then
    raise exception using errcode = '22023', message = 'Asking price is outside the permitted range';
  end if;
  update public.marketplace_listings
  set asking_price = p_asking_price,
      discount_percentage = round((v_balance - p_asking_price) * 100 / v_balance, 2),
      fee_percentage = v_fee_pct,
      estimated_seller_payout = p_asking_price - round(p_asking_price * v_fee_pct / 100, 2)
  where id = p_listing_id returning * into v_listing;
  return v_listing;
end;
$$;

-- Cancelling an active listing also closes open proposals against it.
create or replace function public.cancel_marketplace_listing(p_listing_id uuid)
returns public.marketplace_listings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_listing public.marketplace_listings;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  update public.marketplace_listings
  set status = 'cancelled'
  where id = p_listing_id and seller_id = v_user_id and status = 'active'
  returning * into v_listing;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active listing not found (reserved listings cannot be cancelled)';
  end if;
  update public.swap_requests set status = 'cancelled'
  where requested_listing_id = p_listing_id and status = 'proposed';
  insert into public.card_activity (
    card_id, owner_id, activity_type, amount, data_source, verification_status
  ) values (
    v_listing.card_id, v_user_id, 'unlisted', 0, 'system', 'unverified'
  );
  return v_listing;
end;
$$;

create or replace function public.create_swap_proposal(p_offered_card_id uuid, p_requested_listing_id uuid)
returns public.swap_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_listing public.marketplace_listings;
  v_proposal public.swap_requests;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  perform 1 from public.wallet_cards
  where id = p_offered_card_id and owner_id = v_user_id and archived_at is null and reported_balance > 0
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Offered card not found';
  end if;
  if public.card_has_open_listing(p_offered_card_id) then
    raise exception using errcode = '55006', message = 'Offered card is locked for sale';
  end if;
  select * into v_listing from public.marketplace_listings
  where id = p_requested_listing_id and status = 'active'
  for update;
  if not found or v_listing.seller_id = v_user_id then
    raise exception using errcode = '22023', message = 'Requested listing is unavailable';
  end if;
  if exists (select 1 from public.swap_requests
             where requester_id = v_user_id and requested_listing_id = p_requested_listing_id
               and status in ('proposed', 'accepted')) then
    raise exception using errcode = '23505', message = 'You already have an open proposal for this listing';
  end if;
  if exists (select 1 from public.swap_requests
             where offered_card_id = p_offered_card_id and status = 'accepted') then
    raise exception using errcode = '55006', message = 'Offered card is committed to an accepted swap';
  end if;
  insert into public.swap_requests (requester_id, recipient_id, offered_card_id, requested_listing_id)
  values (v_user_id, v_listing.seller_id, p_offered_card_id, p_requested_listing_id)
  returning * into v_proposal;
  return v_proposal;
end;
$$;

-- Public view now exposes how the balance was established, never credentials.
create or replace view public.public_marketplace_listings
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
  l.created_at,
  case when c.verification_status = 'verified' and c.verification_source = 'authorized_retailer'
       then 'PROVIDER_VERIFIED' else 'USER_REPORTED' end as balance_verification
from public.marketplace_listings l
join public.wallet_cards c on c.id = l.card_id
where l.status = 'active'
  and c.archived_at is null
  and c.verification_status in ('unverified', 'pending', 'verified', 'failed');
grant select on public.public_marketplace_listings to anon, authenticated;

-- Least-privilege grants: CREATE OR REPLACE keeps prior ACLs, restated explicitly for review.
-- Authenticated-only; anon and PUBLIC cannot execute any listing RPC.
revoke all on function public.create_marketplace_listing(uuid, numeric) from public, anon;
revoke all on function public.reprice_marketplace_listing(uuid, numeric) from public, anon;
revoke all on function public.cancel_marketplace_listing(uuid) from public, anon;
revoke all on function public.create_swap_proposal(uuid, uuid) from public, anon;
grant execute on function public.create_marketplace_listing(uuid, numeric) to authenticated;
grant execute on function public.reprice_marketplace_listing(uuid, numeric) to authenticated;
grant execute on function public.cancel_marketplace_listing(uuid) to authenticated;
grant execute on function public.create_swap_proposal(uuid, uuid) to authenticated;

-- Double-listing protection is a database invariant, not application logic:
-- marketplace_one_open_listing_per_card_idx (unique partial index on card_id for
-- status in (active, reserved), from 20261023000100) plus the row lock taken by
-- `select ... for update` on wallet_cards in create_marketplace_listing. Re-assert it idempotently.
create unique index if not exists marketplace_one_open_listing_per_card_idx
  on public.marketplace_listings (card_id) where status in ('active', 'reserved');

