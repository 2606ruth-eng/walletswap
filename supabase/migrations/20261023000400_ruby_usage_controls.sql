create table public.ruby_ai_usage (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null check (char_length(model) between 1 and 64),
  status text not null check (status in ('reserved', 'settled')),
  estimated_cost_microusd bigint not null check (estimated_cost_microusd > 0),
  actual_cost_microusd bigint check (actual_cost_microusd >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  check (
    (status = 'reserved' and actual_cost_microusd is null and settled_at is null)
    or (status = 'settled' and actual_cost_microusd is not null and settled_at is not null)
  )
);

create index ruby_ai_usage_month_idx on public.ruby_ai_usage (created_at, status);
alter table public.ruby_ai_usage enable row level security;
revoke all on public.ruby_ai_usage from public, anon, authenticated;
grant select, insert, update on public.ruby_ai_usage to service_role;

create or replace function public.reserve_ruby_ai_budget(
  p_request_id uuid,
  p_user_id uuid,
  p_model text,
  p_estimated_cost_microusd bigint,
  p_monthly_limit_microusd bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_used_microusd bigint;
  v_prior_status text;
  v_month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service authorization required';
  end if;
  if p_request_id is null or p_user_id is null
     or p_model is null or p_model !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
     or p_estimated_cost_microusd is null or p_estimated_cost_microusd <= 0
     or p_monthly_limit_microusd is null or p_monthly_limit_microusd not between 1 and 100000000 then
    raise exception using errcode = '22023', message = 'Ruby usage reservation is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext('walletswap-ruby-monthly-budget'));
  select status into v_prior_status
  from public.ruby_ai_usage where request_id = p_request_id;
  if found then
    return v_prior_status in ('reserved', 'settled');
  end if;

  select coalesce(sum(
    case when status = 'reserved' then estimated_cost_microusd
         else actual_cost_microusd end
  ), 0)
  into v_used_microusd
  from public.ruby_ai_usage
  where created_at >= v_month_start;

  if v_used_microusd + p_estimated_cost_microusd > p_monthly_limit_microusd then
    return false;
  end if;

  insert into public.ruby_ai_usage (
    request_id, user_id, model, status, estimated_cost_microusd
  ) values (
    p_request_id, p_user_id, p_model, 'reserved', p_estimated_cost_microusd
  );
  return true;
end;
$$;

create or replace function public.settle_ruby_ai_budget(
  p_request_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_actual_cost_microusd bigint
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estimated_cost_microusd bigint;
  v_status text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service authorization required';
  end if;
  if p_request_id is null or p_input_tokens is null or p_input_tokens < 0
     or p_output_tokens is null or p_output_tokens < 0
     or p_actual_cost_microusd is null or p_actual_cost_microusd < 0 then
    raise exception using errcode = '22023', message = 'Ruby usage settlement is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtext('walletswap-ruby-monthly-budget'));
  select status, estimated_cost_microusd
  into v_status, v_estimated_cost_microusd
  from public.ruby_ai_usage where request_id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Ruby usage reservation was not found';
  end if;
  if v_status = 'settled' then
    return true;
  end if;
  if p_actual_cost_microusd > v_estimated_cost_microusd then
    raise exception using errcode = '22023', message = 'Ruby usage exceeded its reservation';
  end if;

  update public.ruby_ai_usage
  set status = 'settled',
      actual_cost_microusd = p_actual_cost_microusd,
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      settled_at = now()
  where request_id = p_request_id;
  return true;
end;
$$;

revoke all on function public.reserve_ruby_ai_budget(uuid, uuid, text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.settle_ruby_ai_budget(uuid, integer, integer, bigint) from public, anon, authenticated;
grant execute on function public.reserve_ruby_ai_budget(uuid, uuid, text, bigint, bigint) to service_role;
grant execute on function public.settle_ruby_ai_budget(uuid, integer, integer, bigint) to service_role;
