alter table public.retailer_integrations
  add column official_domain text,
  add column official_balance_url text,
  add column verification_method text not null default 'MANUAL_ONLY'
    check (verification_method in ('AUTHORIZED_API', 'OFFICIAL_WEBSITE', 'MANUAL_ONLY')),
  add column supported_card_types text[] not null default array['physical', 'digital']::text[]
    check (cardinality(supported_card_types) between 1 and 2
      and supported_card_types <@ array['physical', 'digital']::text[]),
  add column authorized_provider text
    check (authorized_provider is null or authorized_provider in ('adyen', 'tillo', 'incomm', 'direct_merchant')),
  add column credentials_required boolean not null default false,
  add column last_checked_at timestamptz;

alter table public.retailer_integrations
  add constraint retailer_integrations_official_domain_check
    check (official_domain is null or official_domain ~ '^[a-z0-9.-]+$'),
  add constraint retailer_integrations_official_url_check
    check (official_balance_url is null or
      (official_domain is not null
       and official_balance_url like 'https://%'
       and split_part(split_part(official_balance_url, '://', 2), '/', 1) = official_domain
       and official_balance_url !~ '[?#]')),
  add constraint retailer_integrations_website_url_check
    check (verification_method <> 'OFFICIAL_WEBSITE' or official_balance_url is not null);

insert into public.retailer_integrations (
  retailer, integration_name, integration_status, supports_balance_verification,
  supports_pass_issuance, public_notes, official_domain, official_balance_url,
  verification_method, supported_card_types, authorized_provider,
  credentials_required, last_checked_at
) values
  ('target', 'Target', 'unavailable', false, false, 'Official website balance check only; no API integration is approved.',
   'www.target.com', 'https://www.target.com/guest/gift-card-balance', 'OFFICIAL_WEBSITE',
   array['physical', 'digital'], null, false, '2026-10-28T00:00:00Z'),
  ('starbucks', 'Starbucks', 'unavailable', false, false, 'Official website balance check only; no API integration is approved.',
   'www.starbucks.com', 'https://www.starbucks.com/gift/card/manage', 'OFFICIAL_WEBSITE',
   array['physical', 'digital'], null, false, '2026-10-28T00:00:00Z'),
  ('amazon', 'Amazon', 'unavailable', false, false, 'No verified balance-check URL or authorized API is configured.',
   null, null, 'MANUAL_ONLY', array['physical', 'digital'], null, false, null),
  ('apple', 'Apple', 'unavailable', false, false, 'No verified balance-check URL or authorized API is configured.',
   null, null, 'MANUAL_ONLY', array['physical', 'digital'], null, false, null),
  ('bestbuy', 'Best Buy', 'unavailable', false, false, 'No verified balance-check URL or authorized API is configured.',
   null, null, 'MANUAL_ONLY', array['physical', 'digital'], null, false, null),
  ('nike', 'Nike', 'unavailable', false, false, 'No verified balance-check URL or authorized API is configured.',
   null, null, 'MANUAL_ONLY', array['physical', 'digital'], null, false, null),
  ('sephora', 'Sephora', 'unavailable', false, false, 'No verified balance-check URL or authorized API is configured.',
   null, null, 'MANUAL_ONLY', array['physical', 'digital'], null, false, null),
  ('walmart', 'Walmart', 'unavailable', false, false, 'No verified balance-check URL or authorized API is configured.',
   null, null, 'MANUAL_ONLY', array['physical', 'digital'], null, false, null),
  ('uber', 'Uber', 'unavailable', false, false, 'No verified balance-check URL or authorized API is configured.',
   null, null, 'MANUAL_ONLY', array['physical', 'digital'], null, false, null),
  ('airbnb', 'Airbnb', 'unavailable', false, false, 'No verified balance-check URL or authorized API is configured.',
   null, null, 'MANUAL_ONLY', array['physical', 'digital'], null, false, null),
  ('homedepot', 'Home Depot', 'unavailable', false, false, 'No verified balance-check URL or authorized API is configured.',
   null, null, 'MANUAL_ONLY', array['physical', 'digital'], null, false, null),
  ('steam', 'Steam', 'unavailable', false, false, 'No verified balance-check URL or authorized API is configured.',
   null, null, 'MANUAL_ONLY', array['physical', 'digital'], null, false, null)
on conflict (retailer) do update set
  official_domain = excluded.official_domain,
  official_balance_url = excluded.official_balance_url,
  verification_method = case
    when retailer_integrations.integration_status = 'approved'
      and retailer_integrations.supports_balance_verification
      and retailer_integrations.authorized_provider is not null
      then 'AUTHORIZED_API'
    else excluded.verification_method
  end,
  supported_card_types = excluded.supported_card_types,
  authorized_provider = coalesce(retailer_integrations.authorized_provider, excluded.authorized_provider),
  credentials_required = excluded.credentials_required,
  last_checked_at = excluded.last_checked_at,
  public_notes = excluded.public_notes;

alter table public.wallet_cards
  add column balance_verification_status text not null default 'USER_REPORTED'
    check (balance_verification_status in (
      'UNVERIFIED', 'USER_REPORTED', 'PROVIDER_VERIFIED',
      'RECHECK_REQUIRED', 'VERIFICATION_FAILED'
    )),
  add column latest_provider_balance_minor bigint
    check (latest_provider_balance_minor is null or latest_provider_balance_minor >= 0),
  add column latest_provider_currency text
    check (latest_provider_currency is null or latest_provider_currency ~ '^[A-Z]{3}$'),
  add column latest_provider_verified_at timestamptz,
  add column verification_provider_id text,
  add column last_verification_attempt_at timestamptz,
  add column verification_error_category text
    check (verification_error_category is null or verification_error_category in (
      'provider_not_configured', 'unsupported_card_type', 'provider_timeout',
      'provider_refused', 'invalid_provider_response', 'unsupported_currency',
      'rate_limited', 'duplicate_request', 'unknown'
    )),
  add column last_balance_observed_at timestamptz not null default now();

update public.wallet_cards
set balance_verification_status = case
      when verification_status = 'verified' then 'PROVIDER_VERIFIED'
      when verification_status = 'failed' then 'VERIFICATION_FAILED'
      when verification_status = 'pending' then 'RECHECK_REQUIRED'
      when verification_status = 'unverified' and verification_source in ('manual_entry', 'import') then 'USER_REPORTED'
      else 'UNVERIFIED'
    end,
    latest_provider_balance_minor = case when verification_status = 'verified'
      then round(reported_balance * 100)::bigint else null end,
    latest_provider_currency = case when verification_status = 'verified' then currency else null end,
    latest_provider_verified_at = verified_at,
    verification_provider_id = null,
    last_verification_attempt_at = verified_at,
    last_balance_observed_at = updated_at;

alter table public.balance_observations
  add column provider_id text,
  add column balance_minor bigint generated always as (round(balance * 100)::bigint) stored,
  add column error_category text
    check (error_category is null or error_category in (
      'provider_not_configured', 'unsupported_card_type', 'provider_timeout',
      'provider_refused', 'invalid_provider_response', 'unsupported_currency',
      'rate_limited', 'duplicate_request', 'unknown'
    ));

create table public.balance_verification_attempts (
  request_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.wallet_cards(id) on delete cascade,
  provider_id text not null check (provider_id ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  verification_status text not null
    check (verification_status in (
      'UNVERIFIED', 'USER_REPORTED', 'PROVIDER_VERIFIED',
      'RECHECK_REQUIRED', 'VERIFICATION_FAILED'
    )),
  balance_minor bigint check (balance_minor is null or balance_minor >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  error_category text
    check (error_category is null or error_category in (
      'provider_not_configured', 'unsupported_card_type', 'provider_timeout',
      'provider_refused', 'invalid_provider_response', 'unsupported_currency',
      'rate_limited', 'duplicate_request', 'unknown'
    )),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  test_data boolean not null default false,
  unique (owner_id, request_id),
  constraint balance_verification_result_shape check (
    (verification_status = 'PROVIDER_VERIFIED' and balance_minor is not null and currency is not null and error_category is null)
    or (verification_status = 'VERIFICATION_FAILED' and balance_minor is null and currency is null and error_category is not null)
    or (verification_status in ('UNVERIFIED', 'USER_REPORTED', 'RECHECK_REQUIRED')
      and balance_minor is null and currency is null)
  )
);
create index balance_verification_attempts_owner_created_idx
  on public.balance_verification_attempts (owner_id, created_at desc);
create index balance_verification_attempts_card_created_idx
  on public.balance_verification_attempts (card_id, created_at desc);

alter table public.balance_verification_attempts enable row level security;
create policy balance_verification_attempts_select_own on public.balance_verification_attempts
  for select to authenticated using (owner_id = (select auth.uid()));
revoke all on public.balance_verification_attempts from public, anon, authenticated;
grant select on public.balance_verification_attempts to authenticated;
grant select on public.balance_verification_attempts to service_role;

create or replace function public.sync_card_balance_verification_metadata()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.last_balance_observed_at := coalesce(new.last_balance_observed_at, now());
    if new.verification_status = 'verified' and new.verification_source = 'authorized_retailer' then
      new.balance_verification_status := 'PROVIDER_VERIFIED';
      new.latest_provider_balance_minor := round(new.reported_balance * 100)::bigint;
      new.latest_provider_currency := new.currency;
      new.latest_provider_verified_at := coalesce(new.verified_at, now());
      new.verification_provider_id := new.retailer;
      new.last_verification_attempt_at := coalesce(new.verified_at, now());
    else
      new.balance_verification_status := 'USER_REPORTED';
    end if;
  elsif new.reported_balance is distinct from old.reported_balance then
    new.last_balance_observed_at := now();
    if new.verification_status is not distinct from old.verification_status
       and new.verification_source is not distinct from old.verification_source
       and new.verified_at is not distinct from old.verified_at then
      new.verification_status := 'unverified';
      new.verification_source := 'user_reported';
      new.verified_at := null;
      new.balance_verification_status := 'USER_REPORTED';
      new.verification_error_category := null;
    elsif new.verification_status = 'verified' and new.verification_source = 'authorized_retailer' then
      new.balance_verification_status := 'PROVIDER_VERIFIED';
      new.latest_provider_balance_minor := round(new.reported_balance * 100)::bigint;
      new.latest_provider_currency := new.currency;
      new.latest_provider_verified_at := coalesce(new.verified_at, now());
      new.verification_provider_id := new.retailer;
      new.last_verification_attempt_at := coalesce(new.verified_at, now());
    end if;
  elsif new.verification_status = 'verified'
     and new.verification_source = 'authorized_retailer'
     and (
       old.verification_status is distinct from 'verified'
       or new.verified_at is distinct from old.verified_at
     ) then
    new.balance_verification_status := 'PROVIDER_VERIFIED';
    new.latest_provider_balance_minor := round(new.reported_balance * 100)::bigint;
    new.latest_provider_currency := new.currency;
    new.latest_provider_verified_at := coalesce(new.verified_at, now());
    new.verification_provider_id := new.retailer;
    new.last_verification_attempt_at := coalesce(new.verified_at, now());
  end if;
  return new;
end;
$$;
create trigger wallet_cards_verification_metadata
before insert or update of reported_balance, verification_status, verification_source, verified_at
on public.wallet_cards
for each row execute function public.sync_card_balance_verification_metadata();

create or replace function public.begin_card_balance_verification(
  p_card_id uuid,
  p_request_id uuid,
  p_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_card public.wallet_cards;
  v_retailer public.retailer_integrations;
begin
  if auth.uid() is null or p_consent is distinct from true then
    raise exception using errcode = '42501', message = 'Authenticated user consent is required';
  end if;
  if p_card_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'Verification request is invalid';
  end if;
  select * into v_card from public.wallet_cards
  where id = p_card_id and owner_id = auth.uid() and archived_at is null for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Card not found';
  end if;
  select * into v_retailer from public.retailer_integrations
  where retailer = v_card.retailer for share;
  if not found or v_retailer.verification_method <> 'AUTHORIZED_API'
     or v_retailer.integration_status not in ('approved', 'sandbox')
     or not v_retailer.supports_balance_verification
     or v_retailer.authorized_provider is null then
    raise exception using errcode = '42501', message = 'No approved provider is configured';
  end if;
  if v_retailer.integration_status = 'sandbox' and v_retailer.authorized_provider <> 'adyen' then
    raise exception using errcode = '42501', message = 'Sandbox checks are not configured for this provider';
  end if;
  if not (v_card.card_type = any(v_retailer.supported_card_types)) then
    raise exception using errcode = '22023', message = 'Card type is unsupported';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  if exists (
    select 1 from public.balance_verification_attempts
    where owner_id = auth.uid() and request_id = p_request_id
  ) then
    raise exception using errcode = '23505', message = 'Verification request was already used';
  end if;
  if (
    select count(*) from public.balance_verification_attempts
    where owner_id = auth.uid() and created_at > now() - interval '1 minute'
  ) >= 5 then
    raise exception using errcode = 'P0001', message = 'Verification requests are rate limited';
  end if;

  insert into public.balance_verification_attempts (
    request_id, owner_id, card_id, provider_id, verification_status, test_data
  ) values (
    p_request_id, auth.uid(), v_card.id, v_retailer.authorized_provider,
    'RECHECK_REQUIRED', v_retailer.integration_status = 'sandbox'
  );
  if v_retailer.integration_status <> 'sandbox' then
    update public.wallet_cards
    set balance_verification_status = 'RECHECK_REQUIRED',
        last_verification_attempt_at = now(),
        verification_error_category = null
    where id = v_card.id;
  end if;

  return jsonb_build_object(
    'request_id', p_request_id,
    'provider_id', v_retailer.authorized_provider,
    'card_type', v_card.card_type,
    'currency', v_card.currency,
    'original_value', v_card.original_value,
    'test_data', v_retailer.integration_status = 'sandbox'
  );
end;
$$;

create or replace function public.complete_card_balance_verification(
  p_request_id uuid,
  p_status text,
  p_balance_minor bigint default null,
  p_currency text default null,
  p_error_category text default null,
  p_test_data boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.balance_verification_attempts;
  v_card public.wallet_cards;
  v_balance numeric(12,2);
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service authorization required';
  end if;
  if p_status is null or p_status not in ('PROVIDER_VERIFIED', 'VERIFICATION_FAILED') then
    raise exception using errcode = '22023', message = 'Verification result is invalid';
  end if;
  select * into v_attempt from public.balance_verification_attempts
  where request_id = p_request_id for update;
  if not found or v_attempt.verification_status <> 'RECHECK_REQUIRED' then
    raise exception using errcode = 'P0002', message = 'Pending verification was not found';
  end if;
  select * into v_card from public.wallet_cards
  where id = v_attempt.card_id and owner_id = v_attempt.owner_id and archived_at is null for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Card not found';
  end if;
  if p_test_data is distinct from v_attempt.test_data then
    raise exception using errcode = '42501', message = 'Test result mode does not match the request';
  end if;

  if p_status = 'VERIFICATION_FAILED' then
    if p_balance_minor is not null or p_currency is not null
       or p_error_category is null or p_error_category not in (
         'provider_not_configured', 'unsupported_card_type', 'provider_timeout',
         'provider_refused', 'invalid_provider_response', 'unsupported_currency',
         'rate_limited', 'duplicate_request', 'unknown'
       ) then
      raise exception using errcode = '22023', message = 'Safe verification error category is invalid';
    end if;
    update public.balance_verification_attempts
    set verification_status = 'VERIFICATION_FAILED',
        error_category = p_error_category, completed_at = now(),
        test_data = p_test_data
    where request_id = p_request_id;
    if not p_test_data then
      update public.wallet_cards
      set balance_verification_status = 'VERIFICATION_FAILED',
          last_verification_attempt_at = now(),
          verification_error_category = p_error_category
      where id = v_card.id;
    end if;
    return jsonb_build_object('status', 'VERIFICATION_FAILED', 'category', p_error_category, 'test_data', p_test_data);
  end if;

  if p_error_category is not null or p_balance_minor is null or p_balance_minor < 0
     or p_currency is null or p_currency !~ '^[A-Z]{3}$'
     or p_currency <> v_card.currency or p_balance_minor > round(v_card.original_value * 100)::bigint then
    raise exception using errcode = '22023', message = 'Provider balance is invalid';
  end if;
  v_balance := p_balance_minor::numeric / 100;
  if not exists (
    select 1 from public.retailer_integrations
    where retailer = v_card.retailer
      and verification_method = 'AUTHORIZED_API'
      and supports_balance_verification
      and authorized_provider = v_attempt.provider_id
      and v_card.card_type = any(supported_card_types)
      and (
        (not p_test_data and integration_status = 'approved')
        or (p_test_data and integration_status = 'sandbox' and authorized_provider = 'adyen')
      )
  ) then
    raise exception using errcode = '42501', message = 'The provider is no longer approved';
  end if;

  if p_test_data then
    update public.balance_verification_attempts
    set verification_status = 'PROVIDER_VERIFIED',
        balance_minor = p_balance_minor,
        currency = p_currency,
        completed_at = now(),
        test_data = true
    where request_id = p_request_id;
    return jsonb_build_object(
      'status', 'PROVIDER_VERIFIED', 'balance_minor', p_balance_minor,
      'currency', p_currency, 'test_data', true
    );
  end if;

  update public.wallet_cards
  set reported_balance = v_balance,
      verification_status = 'verified',
      verification_source = 'authorized_retailer',
      verified_at = now(),
      balance_verification_status = 'PROVIDER_VERIFIED',
      latest_provider_balance_minor = p_balance_minor,
      latest_provider_currency = p_currency,
      latest_provider_verified_at = now(),
      verification_provider_id = v_attempt.provider_id,
      last_verification_attempt_at = now(),
      verification_error_category = null
  where id = v_card.id;

  insert into public.balance_observations (
    card_id, owner_id, balance, currency, observation_source, verification_status, provider_id
  ) values (
    v_card.id, v_card.owner_id, v_balance, p_currency, 'authorized_retailer', 'verified', v_attempt.provider_id
  );
  if v_balance <> v_card.reported_balance then
    insert into public.card_activity (
      card_id, owner_id, activity_type, amount, previous_balance, new_balance,
      data_source, verification_status
    ) values (
      v_card.id, v_card.owner_id, 'balance_adjustment',
      v_balance - v_card.reported_balance, v_card.reported_balance, v_balance,
      'authorized_retailer', 'verified'
    );
  end if;
  update public.balance_verification_attempts
  set verification_status = 'PROVIDER_VERIFIED',
      balance_minor = p_balance_minor, currency = p_currency, completed_at = now(),
      test_data = false
  where request_id = p_request_id;
  return jsonb_build_object('status', 'PROVIDER_VERIFIED', 'balance_minor', p_balance_minor, 'currency', p_currency);
end;
$$;

revoke all on function public.begin_card_balance_verification(uuid, uuid, boolean) from public, anon;
grant execute on function public.begin_card_balance_verification(uuid, uuid, boolean) to authenticated;
revoke all on function public.complete_card_balance_verification(uuid, text, bigint, text, text, boolean) from public, anon, authenticated;
grant execute on function public.complete_card_balance_verification(uuid, text, bigint, text, text, boolean) to service_role;
