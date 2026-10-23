create or replace function public.record_card_purchase(
  p_card_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_description text default 'User-recorded purchase'
)
returns public.wallet_cards
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_card public.wallet_cards;
  v_prior public.card_activity;
  v_new_balance numeric(12,2);
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception using errcode = '22023', message = 'Purchase amount is invalid';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128 then
    raise exception using errcode = '22023', message = 'Idempotency key is invalid';
  end if;
  if char_length(coalesce(p_description, '')) > 120 then
    raise exception using errcode = '22023', message = 'Description is too long';
  end if;

  select * into v_card from public.wallet_cards
  where id = p_card_id and owner_id = v_user_id and archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Card not found';
  end if;

  select * into v_prior from public.card_activity
  where owner_id = v_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_prior.card_id <> p_card_id or v_prior.amount <> -p_amount then
      raise exception using errcode = '23505', message = 'Idempotency key was already used';
    end if;
    return v_card;
  end if;

  if p_amount > v_card.reported_balance then
    raise exception using errcode = '22023', message = 'Purchase exceeds reported balance';
  end if;
  v_new_balance := v_card.reported_balance - p_amount;

  update public.wallet_cards set reported_balance = v_new_balance, last_activity_at = now()
  where id = v_card.id returning * into v_card;

  insert into public.card_activity (
    card_id, owner_id, activity_type, amount, previous_balance, new_balance,
    data_source, verification_status, idempotency_key
  ) values (
    v_card.id, v_user_id, 'purchase', -p_amount, v_new_balance + p_amount, v_new_balance,
    'user_reported', 'unverified', p_idempotency_key
  );

  insert into public.notifications (user_id, notification_type, title, message, related_card_id, dedupe_key)
  select v_user_id, 'purchase', 'Card balance updated',
    'A user-recorded purchase changed a gift-card balance.', v_card.id, 'purchase:' || p_idempotency_key
  from public.notification_preferences pref
  where pref.user_id = v_user_id and pref.card_activity_enabled
  on conflict (user_id, dedupe_key) do nothing;

  return v_card;
end;
$$;

create or replace function public.archive_wallet_card(p_card_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_card public.wallet_cards;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  update public.wallet_cards
  set archived_at = coalesce(archived_at, now()), last_activity_at = now()
  where id = p_card_id and owner_id = v_user_id and archived_at is null
  returning * into v_card;
  if not found then
    raise exception using errcode = 'P0002', message = 'Card not found';
  end if;
  insert into public.card_activity (
    card_id, owner_id, activity_type, amount, previous_balance, new_balance, data_source, verification_status
  ) values (
    v_card.id, v_user_id, 'archived', 0, v_card.reported_balance, v_card.reported_balance, 'system', v_card.verification_status
  );
end;
$$;

create or replace function public.adjust_reported_balance(
  p_card_id uuid,
  p_balance numeric,
  p_idempotency_key text
)
returns public.wallet_cards
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_card public.wallet_cards;
  v_prior public.card_activity;
  v_previous_balance numeric(12,2);
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_balance is null or p_balance < 0 or p_balance <> round(p_balance, 2) then
    raise exception using errcode = '22023', message = 'Reported balance is invalid';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128 then
    raise exception using errcode = '22023', message = 'Idempotency key is invalid';
  end if;
  select * into v_card from public.wallet_cards
  where id = p_card_id and owner_id = v_user_id and archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Card not found';
  end if;
  select * into v_prior from public.card_activity
  where owner_id = v_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_prior.card_id <> p_card_id or v_prior.activity_type <> 'balance_adjustment'
      or v_prior.new_balance <> p_balance then
      raise exception using errcode = '23505', message = 'Idempotency key was already used';
    end if;
    return v_card;
  end if;
  if p_balance > v_card.original_value then
    raise exception using errcode = '22023', message = 'Reported balance exceeds original value';
  end if;
  v_previous_balance := v_card.reported_balance;
  update public.wallet_cards set reported_balance = p_balance, last_activity_at = now()
  where id = v_card.id returning * into v_card;
  insert into public.card_activity (
    card_id, owner_id, activity_type, amount, previous_balance, new_balance,
    data_source, verification_status, idempotency_key
  ) values (
    v_card.id, v_user_id, 'balance_adjustment', p_balance - v_previous_balance,
    v_previous_balance, p_balance, 'user_reported', 'unverified', p_idempotency_key
  );
  return v_card;
end;
$$;

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
  v_fee := round(v_price * 0.05, 2);

  insert into public.marketplace_listings (
    card_id, seller_id, currency, asking_price, discount_percentage,
    fee_percentage, estimated_seller_payout, status
  ) values (
    v_card.id, v_user_id, v_card.currency, v_price,
    round((v_card.reported_balance - v_price) * 100 / v_card.reported_balance, 2),
    5, v_price - v_fee, 'active'
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
  v_fee numeric(12,2);
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
  select reported_balance into v_balance
  from public.wallet_cards
  where id = v_listing.card_id;
  if p_asking_price < round(v_balance * 0.50, 2) or p_asking_price >= v_balance then
    raise exception using errcode = '22023', message = 'Asking price is outside the permitted range';
  end if;
  v_fee := round(p_asking_price * 0.05, 2);
  update public.marketplace_listings
  set asking_price = p_asking_price,
      discount_percentage = round((v_balance - p_asking_price) * 100 / v_balance, 2),
      fee_percentage = 5,
      estimated_seller_payout = p_asking_price - v_fee
  where id = p_listing_id returning * into v_listing;
  return v_listing;
end;
$$;

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
    raise exception using errcode = 'P0002', message = 'Active listing not found';
  end if;
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
  select * into v_listing from public.marketplace_listings
  where id = p_requested_listing_id and status = 'active'
  for update;
  if not found or v_listing.seller_id = v_user_id then
    raise exception using errcode = '22023', message = 'Requested listing is unavailable';
  end if;
  insert into public.swap_requests (
    requester_id, recipient_id, offered_card_id, requested_listing_id
  ) values (
    v_user_id, v_listing.seller_id, p_offered_card_id, p_requested_listing_id
  ) returning * into v_proposal;
  return v_proposal;
end;
$$;

create or replace function public.respond_to_swap_proposal(p_request_id uuid, p_response text)
returns public.swap_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_proposal public.swap_requests;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_response not in ('accept', 'reject', 'cancel') then
    raise exception using errcode = '22023', message = 'Swap response is invalid';
  end if;
  select * into v_proposal from public.swap_requests
  where id = p_request_id for update;
  if not found or v_proposal.status <> 'proposed' then
    raise exception using errcode = 'P0002', message = 'Open swap proposal not found';
  end if;

  if p_response = 'cancel' then
    if v_proposal.requester_id <> v_user_id then
      raise exception using errcode = '42501', message = 'Only the requester can cancel this proposal';
    end if;
    v_proposal.status := 'cancelled';
  elsif v_proposal.recipient_id <> v_user_id then
    raise exception using errcode = '42501', message = 'Only the recipient can respond to this proposal';
  elsif p_response = 'accept' then
    update public.marketplace_listings set status = 'reserved'
    where id = v_proposal.requested_listing_id and status = 'active';
    if not found then
      raise exception using errcode = '23505', message = 'Requested listing is no longer available';
    end if;
    v_proposal.status := 'accepted';
    v_proposal.recipient_confirmed_at := now();
  else
    v_proposal.status := 'rejected';
    v_proposal.recipient_confirmed_at := now();
  end if;

  update public.swap_requests
  set status = v_proposal.status,
      requester_confirmed_at = v_proposal.requester_confirmed_at,
      recipient_confirmed_at = v_proposal.recipient_confirmed_at
  where id = v_proposal.id returning * into v_proposal;
  return v_proposal;
end;
$$;

create or replace function public.prepare_simulated_purchase(p_listing_id uuid, p_idempotency_key text)
returns public.transaction_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_listing public.marketplace_listings;
  v_transaction public.transaction_records;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128 then
    raise exception using errcode = '22023', message = 'Idempotency key is invalid';
  end if;
  select * into v_transaction from public.transaction_records
  where buyer_id = v_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_transaction.listing_id <> p_listing_id then
      raise exception using errcode = '23505', message = 'Idempotency key was already used';
    end if;
    return v_transaction;
  end if;
  select * into v_listing from public.marketplace_listings
  where id = p_listing_id and status = 'active' and seller_id <> v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Listing is unavailable';
  end if;

  insert into public.transaction_records (
    buyer_id, seller_id, listing_id, transaction_type, amount, currency,
    platform_fee, status, idempotency_key
  ) values (
    v_user_id, v_listing.seller_id, v_listing.id, 'simulated_purchase',
    v_listing.asking_price, v_listing.currency, round(v_listing.asking_price * 0.05, 2),
    'simulation_pending', p_idempotency_key
  ) returning * into v_transaction;
  return v_transaction;
end;
$$;

create or replace function public.get_wallet_summary()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'currency', grouped.currency,
    'card_count', grouped.card_count,
    'reported_balance', grouped.reported_balance,
    'verified_balance', grouped.verified_balance
  ) order by grouped.currency), '[]'::jsonb)
  from (
    select currency, count(*)::integer as card_count,
      sum(reported_balance)::numeric(12,2) as reported_balance,
      sum(case when verification_status = 'verified' then reported_balance else 0 end)::numeric(12,2) as verified_balance
    from public.wallet_cards
    where owner_id = (select auth.uid()) and archived_at is null
    group by currency
  ) grouped;
$$;

create or replace function public.get_wallet_pass_eligibility(p_card_id uuid, p_platform text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_card public.wallet_cards;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_platform not in ('apple', 'google') then
    raise exception using errcode = '22023', message = 'Platform is invalid';
  end if;
  select * into v_card from public.wallet_cards
  where id = p_card_id and owner_id = v_user_id and archived_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'Card not found';
  end if;
  return jsonb_build_object(
    'eligible', false,
    'status', 'unsupported',
    'reason', 'No approved issuer integration is configured.',
    'platform', p_platform
  );
end;
$$;

create or replace function public.consume_ruby_rate_limit(p_max_requests integer default 10)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_max_requests not between 1 and 30 then
    raise exception using errcode = '22023', message = 'Rate limit is invalid';
  end if;
  insert into public.ruby_rate_limits (user_id, scope, window_started_at, request_count)
  values (v_user_id, 'ruby_chat', v_window, 1)
  on conflict (user_id, scope, window_started_at)
  do update set request_count = public.ruby_rate_limits.request_count + 1
    where public.ruby_rate_limits.request_count < p_max_requests
  returning request_count into v_count;
  return found;
end;
$$;

create or replace function public.create_expiry_notifications(p_days integer default 14)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_days not between 1 and 90 then
    raise exception using errcode = '22023', message = 'Reminder window is invalid';
  end if;
  insert into public.notifications (user_id, notification_type, title, message, related_card_id, dedupe_key)
  select c.owner_id, 'expiry_reminder', 'Gift card expiry reminder',
    'A gift card is approaching its printed expiry date.', c.id,
    'expiry:' || c.id::text || ':' || c.expiration_date::text
  from public.wallet_cards c
  join public.notification_preferences pref on pref.user_id = c.owner_id
  where pref.expiry_reminders_enabled
    and c.archived_at is null
    and c.expiration_date between current_date and current_date + p_days
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.import_legacy_cards(p_cards jsonb, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_item jsonb;
  v_receipt public.local_import_receipts;
  v_count integer := 0;
  v_retailer text;
  v_card_type text;
  v_currency text;
  v_original numeric(12,2);
  v_balance numeric(12,2);
  v_expiration date;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) > 100 then
    raise exception using errcode = '22023', message = 'Import must contain at most 100 cards';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128 then
    raise exception using errcode = '22023', message = 'Idempotency key is invalid';
  end if;

  select * into v_receipt from public.local_import_receipts
  where user_id = v_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('imported_count', v_receipt.imported_count, 'already_imported', true);
  end if;

  for v_item in select value from jsonb_array_elements(p_cards)
  loop
    v_retailer := lower(trim(coalesce(v_item ->> 'retailer', '')));
    v_card_type := lower(trim(coalesce(v_item ->> 'card_type', '')));
    v_currency := upper(trim(coalesce(v_item ->> 'currency', 'USD')));
    if v_retailer !~ '^[a-z0-9][a-z0-9_-]{0,39}$'
      or v_card_type not in ('physical', 'digital')
      or v_currency !~ '^[A-Z]{3}$' then
      raise exception using errcode = '22023', message = 'Imported card metadata is invalid';
    end if;

    begin
      v_original := (v_item ->> 'original_value')::numeric(12,2);
      v_balance := (v_item ->> 'reported_balance')::numeric(12,2);
      v_expiration := nullif(v_item ->> 'expiration_date', '')::date;
    exception when others then
      raise exception using errcode = '22023', message = 'Imported card values are invalid';
    end;
    if v_original <= 0 or v_balance < 0 or v_balance > v_original then
      raise exception using errcode = '22023', message = 'Imported card values are outside the permitted range';
    end if;

    insert into public.wallet_cards (
      owner_id, retailer, nickname, card_type, currency, original_value, reported_balance,
      expiration_date, masked_identifier, verification_status, verification_source
    ) values (
      v_user_id, v_retailer, left(coalesce(v_item ->> 'nickname', ''), 80),
      v_card_type, v_currency, v_original, v_balance, v_expiration,
      right(regexp_replace(coalesce(v_item ->> 'masked_identifier', ''), '[^0-9]', '', 'g'), 4),
      'unverified', 'import'
    );
    v_count := v_count + 1;
  end loop;

  insert into public.local_import_receipts (user_id, source, imported_count, idempotency_key)
  values (v_user_id, 'walletswap_local_v1', v_count, p_idempotency_key);
  return jsonb_build_object('imported_count', v_count, 'already_imported', false);
end;
$$;

revoke all on function public.record_card_purchase(uuid, numeric, text, text) from public, anon;
revoke all on function public.archive_wallet_card(uuid) from public, anon;
revoke all on function public.adjust_reported_balance(uuid, numeric, text) from public, anon;
revoke all on function public.create_marketplace_listing(uuid, numeric) from public, anon;
revoke all on function public.reprice_marketplace_listing(uuid, numeric) from public, anon;
revoke all on function public.cancel_marketplace_listing(uuid) from public, anon;
revoke all on function public.create_swap_proposal(uuid, uuid) from public, anon;
revoke all on function public.respond_to_swap_proposal(uuid, text) from public, anon;
revoke all on function public.prepare_simulated_purchase(uuid, text) from public, anon;
revoke all on function public.get_wallet_summary() from public, anon;
revoke all on function public.get_wallet_pass_eligibility(uuid, text) from public, anon;
revoke all on function public.consume_ruby_rate_limit(integer) from public, anon;
revoke all on function public.create_expiry_notifications(integer) from public, anon, authenticated;
revoke all on function public.import_legacy_cards(jsonb, text) from public, anon;

grant execute on function public.record_card_purchase(uuid, numeric, text, text) to authenticated;
grant execute on function public.archive_wallet_card(uuid) to authenticated;
grant execute on function public.adjust_reported_balance(uuid, numeric, text) to authenticated;
grant execute on function public.create_marketplace_listing(uuid, numeric) to authenticated;
grant execute on function public.reprice_marketplace_listing(uuid, numeric) to authenticated;
grant execute on function public.cancel_marketplace_listing(uuid) to authenticated;
grant execute on function public.create_swap_proposal(uuid, uuid) to authenticated;
grant execute on function public.respond_to_swap_proposal(uuid, text) to authenticated;
grant execute on function public.prepare_simulated_purchase(uuid, text) to authenticated;
grant execute on function public.get_wallet_summary() to authenticated;
grant execute on function public.get_wallet_pass_eligibility(uuid, text) to authenticated;
grant execute on function public.consume_ruby_rate_limit(integer) to authenticated;
grant execute on function public.create_expiry_notifications(integer) to service_role;
grant execute on function public.import_legacy_cards(jsonb, text) to authenticated;
