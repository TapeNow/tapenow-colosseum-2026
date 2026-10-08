-- DeWeb Workbench demo only. Review before running in your own test project.
-- This migration never executes automatically from the workbench.
-- Enable Email authentication and display {{ .Token }} in your email template
-- to use the sample's email OTP form. Supabase email limits still apply.

begin;
create table public.demo_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null check (char_length(name) between 1 and 40),
  message text not null check (char_length(message) between 1 and 300),
  created_at timestamptz not null default now()
);
alter table public.demo_messages enable row level security;
grant select on public.demo_messages to anon, authenticated;
grant insert (user_id, name, message) on public.demo_messages to authenticated;
revoke update, delete on public.demo_messages from anon, authenticated;
create policy "Demo messages are public" on public.demo_messages
  for select to anon, authenticated using (true);
create policy "Signed-in users may leave their own message" on public.demo_messages
  for insert to authenticated with check (auth.uid() = user_id);
commit;

-- This is a small demonstration, not a production comment system.
-- Add moderation, abuse/rate controls and a retention policy before public use.
-- Website rollback does not execute this SQL or change stored messages.
