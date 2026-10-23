alter table public.card_activity
  add column notification_status text not null default 'not_requested'
    check (notification_status in ('not_requested', 'created', 'suppressed', 'failed')),
  add column requires_review boolean not null default false,
  add column problem_reported_at timestamptz;

create table public.balance_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  event_id text not null check (char_length(event_id) between 8 and 128),
  card_id uuid not null references public.wallet_cards(id) on delete cascade,
  is_test_event boolean not null default false,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);
alter table public.balance_webhook_events enable row level security;
revoke all on public.balance_webhook_events from public, anon, authenticated;
grant select, insert on public.balance_webhook_events to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end;
$$;

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
  v_activity_id uuid;
  v_notification_id uuid;
  v_new_balance numeric(12,2);
  v_notify boolean := false;
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
  ) returning id into v_activity_id;

  select coalesce(pref.card_activity_enabled, false) into v_notify
  from public.notification_preferences pref where pref.user_id = v_user_id;
  if v_notify then
    insert into public.notifications (user_id, notification_type, title, message, related_card_id, dedupe_key)
    values (v_user_id, 'purchase', 'Card balance updated',
      'A user-recorded purchase changed a gift-card balance.', v_card.id, 'purchase:' || p_idempotency_key)
    on conflict (user_id, dedupe_key) do nothing
    returning id into v_notification_id;
  end if;
  update public.card_activity set notification_status =
    case when not v_notify then 'suppressed'
         when v_notification_id is not null then 'created'
         else 'suppressed' end
  where id = v_activity_id;

  return v_card;
end;
$$;

create or replace function public.record_authorized_balance_update(
  p_provider text,
  p_event_id text,
  p_card_id uuid,
  p_balance numeric,
  p_currency text,
  p_test_event boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_card public.wallet_cards;
  v_activity_id uuid;
  v_notification_id uuid;
  v_notify boolean := false;
  v_previous numeric(12,2);
  v_source text;
  v_status text;
  v_requires_review boolean;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service authorization required';
  end if;
  if p_provider is null or p_provider !~ '^[a-z0-9][a-z0-9_-]{0,39}$'
     or p_event_id is null or char_length(p_event_id) not between 8 and 128 then
    raise exception using errcode = '22023', message = 'Webhook event is invalid';
  end if;
  if p_balance is null or p_balance < 0 or p_balance <> round(p_balance, 2)
     or p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'Balance update is invalid';
  end if;
  if p_test_event then
    if p_provider <> 'walletswap-test' then
      raise exception using errcode = '22023', message = 'Test provider is invalid';
    end if;
    v_source := 'system';
    v_status := 'unverified';
  else
    if not exists (
      select 1 from public.retailer_integrations
      where retailer = p_provider and integration_status = 'approved'
        and supports_balance_verification
    ) then
      raise exception using errcode = '42501', message = 'No approved provider is configured';
    end if;
    v_source := 'authorized_retailer';
    v_status := 'verified';
  end if;

  insert into public.balance_webhook_events (provider, event_id, card_id, is_test_event)
  values (p_provider, p_event_id, p_card_id, p_test_event)
  on conflict (provider, event_id) do nothing;
  if not found then
    return jsonb_build_object('applied', false, 'duplicate', true, 'test_event', p_test_event);
  end if;

  select * into v_card from public.wallet_cards
  where id = p_card_id and archived_at is null for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Card not found';
  end if;
  if p_currency <> v_card.currency or p_balance > v_card.original_value then
    raise exception using errcode = '22023', message = 'Balance does not match the card';
  end if;
  if not p_test_event and v_card.retailer <> p_provider then
    raise exception using errcode = '42501', message = 'Provider does not match the card retailer';
  end if;
  v_previous := v_card.reported_balance;

  if not p_test_event then
    update public.wallet_cards
    set reported_balance = p_balance, verification_status = 'verified',
        verification_source = 'authorized_retailer', verified_at = now(), last_activity_at = now()
    where id = v_card.id;
  else
    update public.wallet_cards set reported_balance = p_balance, last_activity_at = now()
    where id = v_card.id;
  end if;

  if p_balance = v_previous then
    return jsonb_build_object('applied', true, 'changed', false, 'duplicate', false, 'test_event', p_test_event);
  end if;

  insert into public.balance_observations (
    card_id, owner_id, balance, currency, observation_source, verification_status
  ) values (
    v_card.id, v_card.owner_id, p_balance, v_card.currency,
    case when p_test_event then 'user_reported' else 'authorized_retailer' end,
    case when p_test_event then 'unverified' else 'verified' end
  );
  v_requires_review := not p_test_event and p_balance < v_previous;
  insert into public.card_activity (
    card_id, owner_id, activity_type, amount, previous_balance, new_balance,
    data_source, verification_status, requires_review
  ) values (
    v_card.id, v_card.owner_id, 'balance_adjustment', p_balance - v_previous,
    v_previous, p_balance, v_source, v_status, v_requires_review
  ) returning id into v_activity_id;

  select coalesce(pref.balance_change_enabled, false) into v_notify
  from public.notification_preferences pref where pref.user_id = v_card.owner_id;
  if v_notify then
    insert into public.notifications (user_id, notification_type, title, message, related_card_id, dedupe_key)
    values (
      v_card.owner_id, 'balance_change',
      case when p_test_event then 'Test balance update'
           when v_requires_review then 'Balance decrease needs review'
           else 'Gift-card balance updated' end,
      case when p_test_event then 'A signed test event changed a reported balance; it is not a retailer verification.'
           when v_requires_review then 'An authorized provider reported a balance decrease. Review it and report a problem if it looks wrong.'
           else 'An authorized provider reported a gift-card balance change.' end,
      v_card.id, 'balance:' || p_provider || ':' || p_event_id
    ) on conflict (user_id, dedupe_key) do nothing
    returning id into v_notification_id;
  end if;
  update public.card_activity set notification_status =
    case when not v_notify then 'suppressed'
         when v_notification_id is not null then 'created'
         else 'suppressed' end
  where id = v_activity_id;

  return jsonb_build_object(
    'applied', true, 'changed', true, 'duplicate', false, 'test_event', p_test_event,
    'requires_review', v_requires_review, 'activity_id', v_activity_id
  );
end;
$$;

create or replace function public.report_card_activity_problem(p_activity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  update public.card_activity
  set problem_reported_at = coalesce(problem_reported_at, now())
  where id = p_activity_id and owner_id = auth.uid() and requires_review;
  if not found then
    raise exception using errcode = 'P0002', message = 'Reviewable activity not found';
  end if;
end;
$$;

create or replace function public.create_weekly_wallet_summary_notifications()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  insert into public.notifications (user_id, notification_type, title, message, dedupe_key)
  select pref.user_id, 'weekly_summary', 'Your weekly wallet summary',
    'Your wallet summary is ready in Ruby. It includes activity recorded in WalletSwap only.',
    'weekly:' || date_trunc('week', current_date)::date::text
  from public.notification_preferences pref
  where pref.weekly_summary_enabled
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.notify_marketplace_participants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_notification_type text;
  v_title text;
  v_message text;
  v_event_id uuid;
begin
  if tg_table_name = 'transaction_records' then
    v_event_id := new.id;
    v_notification_type := 'marketplace';
    v_title := 'Marketplace simulation activity';
    v_message := 'A simulated marketplace transaction was recorded. No payment or card transfer occurred.';
    for v_user_id in
      select distinct participant from (values (new.buyer_id), (new.seller_id)) as parties(participant)
      where participant is not null
    loop
      insert into public.notifications (user_id, notification_type, title, message, related_card_id, dedupe_key)
      select v_user_id, v_notification_type, v_title, v_message, null,
        'marketplace:' || v_event_id::text || ':' || v_user_id::text
      where exists (
        select 1 from public.notification_preferences
        where user_id = v_user_id and marketplace_alerts_enabled
      )
      on conflict (user_id, dedupe_key) do nothing;
    end loop;
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_user_id := new.recipient_id;
    v_title := 'New swap proposal';
    v_message := 'A user proposed a simulated card swap. Review it in WalletSwap; no transfer has occurred.';
    v_event_id := new.id;
  elsif new.status is distinct from old.status then
    v_user_id := case when auth.uid() = new.requester_id then new.recipient_id else new.requester_id end;
    v_title := 'Swap proposal updated';
    v_message := 'A simulated swap proposal changed status. Review it in WalletSwap; no transfer has occurred.';
    v_event_id := new.id;
  else
    return new;
  end if;
  insert into public.notifications (user_id, notification_type, title, message, dedupe_key)
  select v_user_id, 'swap', v_title, v_message,
    'swap:' || v_event_id::text || ':' || new.status || ':' || v_user_id::text
  where exists (
    select 1 from public.notification_preferences
    where user_id = v_user_id and marketplace_alerts_enabled
  )
  on conflict (user_id, dedupe_key) do nothing;
  return new;
end;
$$;

create trigger transaction_records_notify_participants
after insert on public.transaction_records
for each row execute function public.notify_marketplace_participants();
create trigger swap_requests_notify_participants
after insert or update of status on public.swap_requests
for each row execute function public.notify_marketplace_participants();

revoke all on function public.record_authorized_balance_update(text, text, uuid, numeric, text, boolean) from public, anon, authenticated;
grant execute on function public.record_authorized_balance_update(text, text, uuid, numeric, text, boolean) to service_role;
revoke all on function public.report_card_activity_problem(uuid) from public, anon;
grant execute on function public.report_card_activity_problem(uuid) to authenticated;
revoke all on function public.create_weekly_wallet_summary_notifications() from public, anon, authenticated;
grant execute on function public.create_weekly_wallet_summary_notifications() to service_role;
revoke all on function public.notify_marketplace_participants() from public, anon, authenticated;
