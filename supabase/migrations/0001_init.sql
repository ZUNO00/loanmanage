create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
create policy "profiles_select_own" on profiles for select using (id = auth.uid());
create policy "profiles_insert_own" on profiles for insert with check (id = auth.uid());
create policy "profiles_update_own" on profiles for update using (id = auth.uid());

create table debts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('credit_card','loan','lend_out','borrow_in')),
  name text not null,
  amount numeric,
  due_day int check (due_day between 1 and 31),
  due_time time,
  account_number text,
  bank_name text,
  account_holder text,
  counterparty_name text,
  principal_amount numeric,
  interest_rate_pct numeric,
  repayment_mode text check (repayment_mode in ('recurring','one_time')),
  start_date date,
  due_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table debts enable row level security;
create policy "debts_select_own" on debts for select using (user_id = auth.uid());
create policy "debts_insert_own" on debts for insert with check (user_id = auth.uid());
create policy "debts_update_own" on debts for update using (user_id = auth.uid());
create policy "debts_delete_own" on debts for delete using (user_id = auth.uid());

create table debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references debts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,
  paid_at timestamptz not null default now(),
  unique (debt_id, period)
);

alter table debt_payments enable row level security;
create policy "debt_payments_select_own" on debt_payments for select using (user_id = auth.uid());
create policy "debt_payments_insert_own" on debt_payments for insert with check (user_id = auth.uid());
create policy "debt_payments_delete_own" on debt_payments for delete using (user_id = auth.uid());

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;
create policy "push_subscriptions_select_own" on push_subscriptions for select using (user_id = auth.uid());
create policy "push_subscriptions_insert_own" on push_subscriptions for insert with check (user_id = auth.uid());
create policy "push_subscriptions_delete_own" on push_subscriptions for delete using (user_id = auth.uid());
