create table public.retailer_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  retailer text not null check (retailer ~ '^[a-z0-9][a-z0-9_-]{0,39}$' and retailer <> 'other'),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 48 and display_name !~ '[[:cntrl:]]'),
  created_at timestamptz not null default now(),
  primary key (user_id, retailer)
);

alter table public.retailer_favorites enable row level security;
revoke all on public.retailer_favorites from public, anon, authenticated;

create policy retailer_favorites_select_own on public.retailer_favorites
  for select to authenticated using (user_id = (select auth.uid()));
create policy retailer_favorites_insert_own on public.retailer_favorites
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy retailer_favorites_delete_own on public.retailer_favorites
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, delete on public.retailer_favorites to authenticated;
