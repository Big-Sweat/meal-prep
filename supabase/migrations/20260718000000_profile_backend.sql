-- Myse — profile data backend.
--
-- Per-user profile data plus shared ratings/reviews, moved out of the browser's
-- localStorage and into Postgres so it follows a person across devices and
-- survives a cache wipe. store.js keeps its synchronous API; localStorage
-- becomes a cache hydrated from these tables on sign-in and written through.
--
-- SECURITY: the anon key is public (committed in auth.js), so Row-Level Security
-- is the ONLY thing protecting these rows. Private tables (favorites, allergies,
-- nutrition_profiles, log_entries) allow the owning user alone. ratings/reviews
-- are world-readable (aggregates + review text are public, like any recipe site)
-- but writable only by their author. Every policy pins ownership to auth.uid().
--
-- Idempotent: every policy is dropped before it is (re)created, since Postgres
-- has no "create policy if not exists". Safe to run more than once.

-- ── private: one owner, nobody else ────────────────────────────────────────

create table if not exists public.favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  recipe_id  text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);
alter table public.favorites enable row level security;
grant select, insert, update, delete on public.favorites to authenticated;
drop policy if exists favorites_owner_all on public.favorites;
create policy favorites_owner_all on public.favorites
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.allergies (
  user_id     uuid not null references auth.users(id) on delete cascade,
  allergen_id text not null,
  primary key (user_id, allergen_id)
);
alter table public.allergies enable row level security;
grant select, insert, update, delete on public.allergies to authenticated;
drop policy if exists allergies_owner_all on public.allergies;
create policy allergies_owner_all on public.allergies
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.nutrition_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  profile    jsonb not null,           -- opaque; MiseNutrition.valid() gates use
  updated_at timestamptz not null default now()
);
alter table public.nutrition_profiles enable row level security;
grant select, insert, update, delete on public.nutrition_profiles to authenticated;
drop policy if exists nutrition_owner_all on public.nutrition_profiles;
create policy nutrition_owner_all on public.nutrition_profiles
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.log_entries (
  id         text primary key,         -- client-generated (Date.now()-rand)
  user_id    uuid not null references auth.users(id) on delete cascade,
  d          date not null,
  t          text not null check (t in ('weight','lift','run')),
  data       jsonb not null,           -- type-specific: {kg} | {ex,sets,reps,kg} | {km,mins}
  created_at timestamptz not null default now()
);
alter table public.log_entries enable row level security;
grant select, insert, update, delete on public.log_entries to authenticated;
drop policy if exists log_owner_all on public.log_entries;
create policy log_owner_all on public.log_entries
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists log_entries_user_d on public.log_entries (user_id, d);

-- Defense-in-depth: strip the anon role's default-privilege grants on the
-- private tables. RLS already returns zero rows to a signed-out request, but
-- with no grant at all a signed-out request fails outright (permission denied)
-- instead of relying on RLS to filter every row — these tables are never meant
-- to be reachable without a session.
revoke all on public.favorites, public.allergies, public.nutrition_profiles, public.log_entries from anon;

-- ── shared: world-readable, author-writable ────────────────────────────────

create table if not exists public.ratings (
  user_id    uuid not null references auth.users(id) on delete cascade,
  recipe_id  text not null,
  stars      smallint not null check (stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);
alter table public.ratings enable row level security;
grant select on public.ratings to anon;
grant select, insert, update, delete on public.ratings to authenticated;
drop policy if exists ratings_public_read on public.ratings;
create policy ratings_public_read on public.ratings
  for select to anon, authenticated using (true);
drop policy if exists ratings_author_insert on public.ratings;
create policy ratings_author_insert on public.ratings
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists ratings_author_update on public.ratings;
create policy ratings_author_update on public.ratings
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists ratings_author_delete on public.ratings;
create policy ratings_author_delete on public.ratings
  for delete to authenticated using (auth.uid() = user_id);
create index if not exists ratings_recipe on public.ratings (recipe_id);

create table if not exists public.reviews (
  user_id    uuid not null references auth.users(id) on delete cascade,
  recipe_id  text not null,
  stars      smallint not null check (stars between 1 and 5),
  body       text not null,
  author     text not null,            -- display name shown publicly on the review
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, recipe_id)     -- one review per person per recipe
);
alter table public.reviews enable row level security;
grant select on public.reviews to anon;
grant select, insert, update, delete on public.reviews to authenticated;
drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read on public.reviews
  for select to anon, authenticated using (true);
drop policy if exists reviews_author_insert on public.reviews;
create policy reviews_author_insert on public.reviews
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists reviews_author_update on public.reviews;
create policy reviews_author_update on public.reviews
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists reviews_author_delete on public.reviews;
create policy reviews_author_delete on public.reviews
  for delete to authenticated using (auth.uid() = user_id);
create index if not exists reviews_recipe on public.reviews (recipe_id);

-- Efficient public aggregate so ratingSummary() fetches one row per recipe
-- instead of every rating. security_invoker makes it respect the caller's RLS
-- (the public read policy on ratings above), so anon and authenticated can read.
create or replace view public.recipe_rating_summary
  with (security_invoker = on) as
  select recipe_id,
         round(avg(stars)::numeric, 1) as avg,
         count(*)::int as count
  from public.ratings
  group by recipe_id;
grant select on public.recipe_rating_summary to anon, authenticated;
