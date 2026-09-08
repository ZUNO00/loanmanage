create table notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  note_at timestamptz not null,
  reminded_at timestamptz,
  created_at timestamptz not null default now()
);

alter table notes enable row level security;
create policy "notes_select_own" on notes for select using (user_id = auth.uid());
create policy "notes_insert_own" on notes for insert with check (user_id = auth.uid());
create policy "notes_update_own" on notes for update using (user_id = auth.uid());
create policy "notes_delete_own" on notes for delete using (user_id = auth.uid());
