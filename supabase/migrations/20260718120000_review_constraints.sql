-- Review-contract fixes (site audit, 18 Jul 2026). Idempotent — safe to re-run.
-- Run in the Supabase SQL editor, same as 20260718000000_profile_backend.sql.

-- 1. A review without a star rating is a supported path in the UI (the form
--    and the stars are independent, and the renderer handles star-less
--    reviews) — but stars was NOT NULL, so those reviews inserted locally,
--    died server-side with 23502, and silently vanished on the next fetch.
--    The existing CHECK (stars between 1 and 5) passes NULL, so dropping the
--    NOT NULL is the whole fix.
alter table public.reviews alter column stars drop not null;

-- 2. Length caps. body/author/recipe_id were unbounded text, and RLS lets any
--    authenticated user UPDATE their own rows past the form's maxlength — one
--    hostile multi-megabyte row would then be downloaded by every visitor who
--    opens that recipe (reviews are world-readable by design). The renderer
--    also truncates (app.js), but the server cap is the real fence. Existing
--    rows all pass: the form has always capped body at 500 and author is an
--    OAuth display name.
alter table public.reviews drop constraint if exists reviews_body_len;
alter table public.reviews add constraint reviews_body_len
  check (char_length(body) <= 1000);

alter table public.reviews drop constraint if exists reviews_author_len;
alter table public.reviews add constraint reviews_author_len
  check (char_length(author) <= 80);

-- 3. recipe_id caps on both shared tables. Ids are kebab-case slugs (longest
--    today is 60 chars); without a cap, junk rows under invented ids grow the
--    recipe_rating_summary view that loadSummaries() downloads unfiltered for
--    every visitor.
alter table public.reviews drop constraint if exists reviews_recipe_id_len;
alter table public.reviews add constraint reviews_recipe_id_len
  check (char_length(recipe_id) <= 80);

alter table public.ratings drop constraint if exists ratings_recipe_id_len;
alter table public.ratings add constraint ratings_recipe_id_len
  check (char_length(recipe_id) <= 80);
