-- Myse — content moderation (block banned words in UGC).
--
-- Policy (19 Jul 2026): recipe text, forum threads/replies, and the poster's
-- display name may not contain hate slurs or strong profanity. This is the REAL
-- fence — the anon key is public, so a hand-rolled API POST bypasses the
-- client-side check in moderation.js. A BEFORE INSERT/UPDATE trigger on each UGC
-- table rejects the write (SQLSTATE 23514) if any relevant field trips
-- has_banned_word().
--
-- KEEP THE `pat` PATTERN BELOW BYTE-FOR-BYTE IN SYNC with moderation.js's BODY
-- (that file uses \b where this uses \y; everything else is identical). The
-- translate(...) leet-fold mirrors moderation.js's LEET map.
--
-- Whole-word matching (\y) keeps cooking words safe (asparagus/bass/class/cockle
-- don't trip ass/cock). Known false positive: "faggots" the British offal dish
-- (the slur wins) — whitelist here + in moderation.js if a community needs it.
--
-- Idempotent; run in the Supabase SQL editor.

create or replace function public.has_banned_word(txt text)
  returns boolean
  language plpgsql
  immutable
  set search_path = public
as $fn$
declare
  low text := lower(coalesce(txt, ''));
  pat text := '\y(?:fuck(?:ing|in|ed|er|ers|s|wit|tard)?|motherfuck(?:er|ers|ing|in)?|shit(?:ty|ting|s|head|hole|bag)?|bullshit|bitch(?:es|ing|y)?|cunt(?:s|y)?|dick(?:s|head|wad|face)?|cock(?:s|sucker|suckers)?|puss(?:y|ies)|ass(?:hole|holes|hat|wipe|es|clown)?|(?:dumb|jack|bad|smart|fat|hard)ass(?:es)?|bastard(?:s)?|damn(?:ed)?|goddamn(?:ed)?|crap(?:py|s|ping)?|piss(?:ing|ed|es|er)?|prick(?:s)?|slut(?:s|ty)?|whore(?:s)?|douche(?:bag|bags)?|wank(?:er|ers|ing)?|twat(?:s)?|bollock(?:s)?|bugger|hell|nigg(?:er|ers|a|as|ah|ahs)|fag(?:got|gots|gy|s)?|retard(?:ed|s)?|spic(?:s)?|chink(?:s)?|kike(?:s)?|gook(?:s)?|wetback(?:s)?|trann(?:y|ies)|dyke(?:s)?|coon(?:s)?|paki(?:s)?|beaner(?:s)?|raghead(?:s)?|towelhead(?:s)?|jap(?:s)?|wop(?:s)?|dago(?:s|es)?)\y';
begin
  if low = '' then return false; end if;
  -- raw pass, then a leetspeak-folded pass (a$$ / sh1t / f4g)
  return low ~ pat or translate(low, '013457@$!', 'oieastasi') ~ pat;
end;
$fn$;
grant execute on function public.has_banned_word(text) to anon, authenticated;

-- ── triggers ────────────────────────────────────────────────────────────────
-- Community recipes: the display name + the whole recipe object (name,
-- description, ingredients, steps — data::text covers them all).

create or replace function public.reject_banned_user_recipe()
  returns trigger language plpgsql set search_path = public as $$
begin
  if public.has_banned_word(new.author) or public.has_banned_word(new.data::text) then
    raise exception 'Content contains disallowed language' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists user_recipes_moderation on public.user_recipes;
create trigger user_recipes_moderation before insert or update on public.user_recipes
  for each row execute function public.reject_banned_user_recipe();

-- Forum threads: display name + title + opening body.
create or replace function public.reject_banned_forum_thread()
  returns trigger language plpgsql set search_path = public as $$
begin
  if public.has_banned_word(new.author) or public.has_banned_word(new.title)
     or public.has_banned_word(new.body) then
    raise exception 'Content contains disallowed language' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists forum_threads_moderation on public.forum_threads;
create trigger forum_threads_moderation before insert or update on public.forum_threads
  for each row execute function public.reject_banned_forum_thread();

-- Forum replies: display name + body.
create or replace function public.reject_banned_forum_reply()
  returns trigger language plpgsql set search_path = public as $$
begin
  if public.has_banned_word(new.author) or public.has_banned_word(new.body) then
    raise exception 'Content contains disallowed language' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists forum_replies_moderation on public.forum_replies;
create trigger forum_replies_moderation before insert or update on public.forum_replies
  for each row execute function public.reject_banned_forum_reply();
