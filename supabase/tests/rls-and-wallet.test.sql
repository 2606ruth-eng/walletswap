create extension if not exists pgtap with schema extensions;
begin;
select plan(16);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'wallet-a@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Wallet A"}', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'wallet-b@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Wallet B"}', now(), now())
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok($$
  insert into public.wallet_cards (
    owner_id, retailer, card_type, currency, original_value, reported_balance, masked_identifier
  ) values (
    auth.uid(), 'test-store', 'physical', 'USD', 100, 100, '1234'
  )
$$, 'User A creates an unverified wallet card');

select is(
  (select verification_status from public.wallet_cards where owner_id = auth.uid() and retailer = 'test-store' order by created_at desc limit 1),
  'unverified',
  'New cards cannot start verified'
);

select throws_ok($$
  update public.wallet_cards set verification_status = 'verified'
  where owner_id = auth.uid() and retailer = 'test-store'
$$, '42501', null, 'Clients cannot directly mark cards verified');

select throws_ok($$
  update public.wallet_cards set owner_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  where owner_id = auth.uid() and retailer = 'test-store'
$$, '42501', null, 'Clients cannot reassign card ownership');

select lives_ok($$
  select public.record_card_purchase(
    (select id from public.wallet_cards where owner_id = auth.uid() and retailer = 'test-store' order by created_at desc limit 1),
    25.00, 'purchase-idempotency-key-0001', 'Test purchase'
  )
$$, 'Owner can record a purchase through the atomic operation');

select is(
  (select reported_balance from public.wallet_cards where owner_id = auth.uid() and retailer = 'test-store' order by created_at desc limit 1),
  75.00::numeric(12,2),
  'Atomic purchase updates reported balance'
);

select is(
  (select count(*)::integer from public.card_activity
   where owner_id = auth.uid() and activity_type = 'purchase' and idempotency_key = 'purchase-idempotency-key-0001'),
  1,
  'Purchase creates one activity record'
);

select lives_ok($$
  select public.record_card_purchase(
    (select id from public.wallet_cards where owner_id = auth.uid() and retailer = 'test-store' order by created_at desc limit 1),
    25.00, 'purchase-idempotency-key-0001', 'Duplicate test purchase'
  )
$$, 'Duplicate purchase request is idempotent');

insert into public.wallet_cards (
  owner_id, retailer, card_type, currency, original_value, reported_balance, masked_identifier
) values (auth.uid(), 'listing-test', 'digital', 'USD', 100, 100, '5678');
select is(
  (select asking_price from public.create_marketplace_listing(
    (select id from public.wallet_cards where owner_id = auth.uid() and retailer = 'listing-test' order by created_at desc limit 1)
  )),
  90.00::numeric(12,2),
  'Listing asking price is 90 percent of reported balance'
);

insert into public.wallet_cards (
  owner_id, retailer, card_type, currency, original_value, reported_balance, masked_identifier
) values (auth.uid(), 'custom-listing-test', 'digital', 'USD', 100, 100, '6789');
select is(
  (select asking_price from public.create_marketplace_listing(
    (select id from public.wallet_cards where owner_id = auth.uid() and retailer = 'custom-listing-test' order by created_at desc limit 1),
    85.00
  )),
  85.00::numeric(12,2),
  'Listing keeps the user-confirmed asking price'
);

select lives_ok($$
  insert into public.ruby_conversations (user_id, title)
  values (auth.uid(), 'private conversation')
$$, 'User A creates a private Ruby conversation');

select lives_ok($$
  insert into public.ruby_messages (conversation_id, user_id, role, content)
  select id, auth.uid(), 'user', 'What cards do I have?'
  from public.ruby_conversations where user_id = auth.uid() and title = 'private conversation'
$$, 'User A can add a message to their conversation');

select throws_ok($$
  insert into public.ruby_messages (conversation_id, user_id, role, content)
  select id, auth.uid(), 'assistant', 'Forged assistant response'
  from public.ruby_conversations where user_id = auth.uid() and title = 'private conversation'
$$, '42501', null, 'Authenticated users cannot forge Ruby assistant messages');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select count(*)::integer from public.wallet_cards where retailer = 'test-store'),
  0,
  'User B cannot read User A cards'
);

select is(
  (select count(*)::integer from public.ruby_conversations where title = 'private conversation'),
  0,
  'User B cannot read User A conversations'
);

select is(
  (select count(*)::integer from public.ruby_messages where content = 'What cards do I have?'),
  0,
  'User B cannot read User A Ruby messages'
);

select * from finish();
rollback;
