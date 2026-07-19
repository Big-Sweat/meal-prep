-- Myse — the forum (discuss meal prep and the fitness journey).
--
-- Threads and flat replies, world-readable, writable only by their author. Same
-- shape and moderation as community recipes (20260719000000): instant post +
-- report, and a thread or reply auto-hides from the public read once
-- REPORT_HIDE_THRESHOLD distinct users report it (its author still sees it, to
-- edit or delete). Hard takedown before the threshold is the project owner via
-- this SQL editor.
--
-- SECURITY: the anon key is public, so RLS is the whole fence. Reports are
-- private (the reporter's identity never leaks — read only through the
-- SECURITY DEFINER count). Idempotent; run in the Supabase SQL editor.

-- ── threads ─────────────────────────────────────────────────────────────────

create table if not exists public.forum_threads (
  id         text primary key,          -- client-generated ("t-...")
  user_id    uuid not null references auth.users(id) on delete cascade,
  author     text not null,             -- display-name snapshot shown publicly
  category   text not null,             -- one of a fixed client-side set
  title      text not null,
  body       text not null,             -- the opening post
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forum_threads_author_len   check (char_length(author) <= 80),
  constraint forum_threads_category_len check (char_length(category) <= 40),
  constraint forum_threads_title_len    check (char_length(title) between 1 and 140),
  constraint forum_threads_body_len     check (char_length(body) between 1 and 5000),
  constraint forum_threads_id_len       check (char_length(id) <= 80)
);
alter table public.forum_threads enable row level security;
grant select on public.forum_threads to anon, authenticated;
grant insert, update, delete on public.forum_threads to authenticated;
create index if not exists forum_threads_user on public.forum_threads (user_id);

-- ── replies (flat) ──────────────────────────────────────────────────────────

create table if not exists public.forum_replies (
  id         text primary key,          -- client-generated ("r-...")
  thread_id  text not null references public.forum_threads(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  author     text not null,
  body       text not null,
  created_at timestamptz not null default now(),
  constraint forum_replies_author_len check (char_length(author) <= 80),
  constraint forum_replies_body_len   check (char_length(body) between 1 and 5000),
  constraint forum_replies_id_len     check (char_length(id) <= 80)
);
alter table public.forum_replies enable row level security;
grant select on public.forum_replies to anon, authenticated;
grant insert, update, delete on public.forum_replies to authenticated;
create index if not exists forum_replies_thread on public.forum_replies (thread_id);

-- ── reports (private) ───────────────────────────────────────────────────────

create table if not exists public.forum_reports (
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_kind text not null check (target_kind in ('thread','reply')),
  target_id   text not null,
  reason      text,
  created_at  timestamptz not null default now(),
  primary key (reporter_id, target_kind, target_id),
  constraint forum_reports_reason_len check (reason is null or char_length(reason) <= 400)
);
alter table public.forum_reports enable row level security;
revoke all on public.forum_reports from anon;
grant select, insert, delete on public.forum_reports to authenticated;
create index if not exists forum_reports_target on public.forum_reports (target_kind, target_id);

drop policy if exists forum_reports_author_read on public.forum_reports;
create policy forum_reports_author_read on public.forum_reports
  for select to authenticated using (auth.uid() = reporter_id);
drop policy if exists forum_reports_author_insert on public.forum_reports;
create policy forum_reports_author_insert on public.forum_reports
  for insert to authenticated with check (auth.uid() = reporter_id);
drop policy if exists forum_reports_author_delete on public.forum_reports;
create policy forum_reports_author_delete on public.forum_reports
  for delete to authenticated using (auth.uid() = reporter_id);

-- Report count for one target. SECURITY DEFINER so the public read policies can
-- consult it without granting anyone select on forum_reports (which would leak
-- who reported what). Returns only a number. REPORT_HIDE_THRESHOLD = 3.
create or replace function public.forum_report_count(kind text, tid text)
  returns integer
  language sql
  security definer
  stable
  set search_path = public
as $$
  select count(*)::int from public.forum_reports
  where target_kind = kind and target_id = tid;
$$;
grant execute on function public.forum_report_count(text, text) to anon, authenticated;

-- ── policies: author sees own always; everyone else only under the threshold ──

drop policy if exists forum_threads_owner_all on public.forum_threads;
create policy forum_threads_owner_all on public.forum_threads
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists forum_threads_public_read on public.forum_threads;
create policy forum_threads_public_read on public.forum_threads
  for select to anon, authenticated
  using (public.forum_report_count('thread', id) < 3);

drop policy if exists forum_replies_owner_all on public.forum_replies;
create policy forum_replies_owner_all on public.forum_replies
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists forum_replies_public_read on public.forum_replies;
create policy forum_replies_public_read on public.forum_replies
  for select to anon, authenticated
  using (public.forum_report_count('reply', id) < 3);

-- Per-thread reply count + last activity for the thread list. security_invoker
-- so it only counts replies the caller can actually see (the public read policy
-- above already hides over-reported ones).
create or replace view public.forum_thread_meta
  with (security_invoker = on) as
  select thread_id,
         count(*)::int as reply_count,
         max(created_at) as last_reply_at
  from public.forum_replies
  group by thread_id;
grant select on public.forum_thread_meta to anon, authenticated;
