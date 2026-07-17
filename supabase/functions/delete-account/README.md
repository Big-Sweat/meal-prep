# `delete-account` Edge Function

Permanently deletes the **signed-in user's own** Supabase Auth account. The app
calls this when someone confirms "Delete account" on the profile page; the
client then also wipes that user's local data and signs out.

This is the one piece of the site that runs on a server instead of in the
browser, because deleting a user requires the project's **secret
(service_role) key**, which must never be shipped to a browser.

## How it stays secure

- **The admin key never leaves the server.** It's an environment variable inside
  the function, not in any file that reaches the browser.
- **You can only delete yourself.** The function ignores any user id sent by the
  client. It reads your session token, has Supabase verify it, and deletes the
  id that comes back from that verified token — there's nothing to forge.
- **No token, no action.** A request without a valid, current session is
  rejected with `401` before anything is deleted.

Nothing secret is committed to this repo. The anon key already in `auth.js` is
public by design; the service_role key lives only in Supabase.

## Deploy it

You need the [Supabase CLI](https://supabase.com/docs/guides/cli) and to be an
owner/admin of the project. From the repo root:

```bash
supabase login                       # one-time, opens a browser
supabase link --project-ref bypeqzvxgqjsylerzxlk
supabase functions deploy delete-account
```

That's it. On a legacy-key project (this one, today) the function's three
environment variables — `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` — are **injected automatically**; you don't set them.

### Prefer the dashboard instead of the CLI?

You can paste `index.ts` into **Dashboard → Edge Functions → Create function**
(`delete-account`). If you go this route, turn **off** "Verify JWT" for the
function in its settings — same reason as the `verify_jwt = false` in
`../../config.toml` (it lets the browser's CORS preflight through; the function
still checks your token itself).

## Test it

1. Sign in on the site, open the profile page, and use **Delete account →
   Yes, delete everything**.
2. In **Dashboard → Authentication → Users**, confirm the account is gone.
3. Sign up again with the same email: you should come back as a brand-new user
   with none of the old data.

## After a future migration to the new API keys

If you later move the project to `sb_publishable_…` / `sb_secret_…` keys, the
auto-injected `SUPABASE_SERVICE_ROLE_KEY` may lag or stop being provided. If the
function starts failing with a key/JWT error, set the admin key explicitly:

```bash
supabase secrets set MISE_ADMIN_KEY=sb_secret_xxx
```

then change `index.ts` to read
`Deno.env.get("MISE_ADMIN_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`.
Nothing else changes.
