-- Myse — community recipes (user-submitted recipes on the board).
--
-- The first user-generated content that isn't a rating or review: signed-in
-- users publish their own recipes, and everyone (signed in or out) can browse,
-- open, review, favorite and plan them exactly like house recipes. On the client
-- these rows are mapped to the recipe schema and merged into the global RECIPES
-- array (see store.js loadCommunity + app.js applyCommunity).
--
-- SECURITY: the anon key is public, so RLS is the whole fence. A community recipe
-- is world-readable (that's the point), but writable only by its author. Reports
-- are private (the reporter's identity never leaks). Moderation is server-code-
-- free: a recipe auto-hides from the public read once REPORT_HIDE_THRESHOLD
-- distinct users report it, while its author still sees it (to edit or delete).
-- Hard takedown before the threshold is the project owner via this SQL editor.
--
-- Idempotent: every policy/constraint is dropped before it is (re)created. Run in
-- the Supabase SQL editor, same as 20260718000000_profile_backend.sql. It also
-- creates the `recipe-photos` Storage bucket + policies at the bottom.

-- ── the recipes ─────────────────────────────────────────────────────────────

create table if not exists public.user_recipes (
  id         text primary key,          -- client-generated, kebab-safe ("u-...")
  user_id    uuid not null references auth.users(id) on delete cascade,
  author     text not null,             -- display-name snapshot shown publicly
  data       jsonb not null,            -- the recipe object minus id (schema-shaped)
  photo_path text,                       -- Storage object path in recipe-photos, or null
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Length caps, same reasoning as reviews: any author can UPDATE their own row
  -- past the form's limits, and every visitor downloads it (rows are public).
  constraint user_recipes_author_len check (char_length(author) <= 80),
  constraint user_recipes_data_len   check (char_length(data::text) <= 20000),
  constraint user_recipes_id_len     check (char_length(id) <= 80)
);
alter table public.user_recipes enable row level security;
grant select on public.user_recipes to anon, authenticated;
grant insert, update, delete on public.user_recipes to authenticated;
create index if not exists user_recipes_user on public.user_recipes (user_id);

-- ── reports (private) ───────────────────────────────────────────────────────

create table if not exists public.recipe_reports (
  reporter_id uuid not null references auth.users(id) on delete cascade,
  recipe_id   text not null references public.user_recipes(id) on delete cascade,
  reason      text,
  created_at  timestamptz not null default now(),
  primary key (reporter_id, recipe_id),  -- one report per person per recipe
  constraint recipe_reports_reason_len check (reason is null or char_length(reason) <= 400)
);
alter table public.recipe_reports enable row level security;
-- No anon access at all; a report can only be filed by, and read by, its author.
revoke all on public.recipe_reports from anon;
grant select, insert, delete on public.recipe_reports to authenticated;
create index if not exists recipe_reports_recipe on public.recipe_reports (recipe_id);

drop policy if exists recipe_reports_author_read on public.recipe_reports;
create policy recipe_reports_author_read on public.recipe_reports
  for select to authenticated using (auth.uid() = reporter_id);
drop policy if exists recipe_reports_author_insert on public.recipe_reports;
create policy recipe_reports_author_insert on public.recipe_reports
  for insert to authenticated with check (auth.uid() = reporter_id);
drop policy if exists recipe_reports_author_delete on public.recipe_reports;
create policy recipe_reports_author_delete on public.recipe_reports
  for delete to authenticated using (auth.uid() = reporter_id);

-- Report count for one recipe. SECURITY DEFINER so the public read policy below
-- can consult it WITHOUT granting anyone select on recipe_reports (which would
-- leak who reported what). Returns only a number. Pinned search_path per the
-- definer-function convention.
create or replace function public.community_report_count(rid text)
  returns integer
  language sql
  security definer
  stable
  set search_path = public
as $$
  select count(*)::int from public.recipe_reports where recipe_id = rid;
$$;
grant execute on function public.community_report_count(text) to anon, authenticated;

-- ── policies on user_recipes ────────────────────────────────────────────────
-- Two permissive SELECT policies OR together: the author always sees their own
-- rows (even once hidden, so they can edit/delete); everyone else sees a row
-- only while it's under the report threshold. Write policies pin to the author.
-- REPORT_HIDE_THRESHOLD = 3 (tunable: change the literal below).

drop policy if exists user_recipes_owner_all on public.user_recipes;
create policy user_recipes_owner_all on public.user_recipes
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_recipes_public_read on public.user_recipes;
create policy user_recipes_public_read on public.user_recipes
  for select to anon, authenticated
  using (public.community_report_count(id) < 3);

-- ── Storage: the recipe-photos bucket ───────────────────────────────────────
-- Public-read bucket. A user may only write under their own uid folder
-- (path convention "<uid>/<recipeId>.webp"), enforced on storage.objects.

insert into storage.buckets (id, name, public)
values ('recipe-photos', 'recipe-photos', true)
on conflict (id) do nothing;

drop policy if exists recipe_photos_public_read on storage.objects;
create policy recipe_photos_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'recipe-photos');

drop policy if exists recipe_photos_owner_insert on storage.objects;
create policy recipe_photos_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists recipe_photos_owner_update on storage.objects;
create policy recipe_photos_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists recipe_photos_owner_delete on storage.objects;
create policy recipe_photos_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'recipe-photos' and (storage.foldername(name))[1] = auth.uid()::text);
