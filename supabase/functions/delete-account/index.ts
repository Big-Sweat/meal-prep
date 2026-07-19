// supabase/functions/delete-account/index.ts
//
// Permanently deletes the CALLING user's own auth account — and nothing else.
//
// ── Why this can't be done from the browser ─────────────────────────────────
// Removing a user from Supabase Auth needs the project's *secret* (service_role)
// key, which has full admin power over every account. That key must NEVER touch
// client-side code: anyone could read it in the browser and delete or
// impersonate any user. So the delete happens here, on Supabase's servers, where
// the secret key is an environment variable that never leaves the machine.
//
// ── Why a caller can only ever delete THEMSELVES ────────────────────────────
// The function never trusts a user id sent by the client. It reads the caller's
// session token (the JWT the app is already signed in with) from the
// Authorization header, asks Supabase to verify it, and deletes the id that
// comes back from that verified token. There is no id to forge — a valid token
// only ever identifies its own owner.
//
// Deploy + configuration steps are in ./README.md.

import { createClient } from "jsr:@supabase/supabase-js@2";

// The browser origins allowed to call this. CORS is enforced by the browser, so
// it isn't the real security boundary (the token check below is) — but scoping
// it to the app's own origins is good hygiene and blocks casual cross-site use.
// Add a new origin here if the site ever moves to a custom domain.
const ALLOWED_ORIGINS = [
  "https://big-sweat.github.io",
  // The Capacitor apps: Android's WebView serves the bundle from
  // https://localhost, iOS from capacitor://localhost. Both app stores require
  // in-app account deletion, and without these two origins the preflight
  // fails and the button is dead in every built app.
  "https://localhost",
  "capacitor://localhost",
  "http://localhost:8347",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin)
    ? origin
    : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // supabase-js attaches x-client-info (and x-supabase-api-version) to every
    // invoke(); the browser's preflight blocks the whole call if they aren't
    // listed here. This is the canonical Supabase set — don't trim it.
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("Origin"));

  // The browser sends this preflight before the real POST; answer it plainly.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Not signed in" }, 401, cors);

  // Auto-injected on the Supabase platform for legacy-key projects. (After a
  // future migration to sb_secret_* keys you may need to set the admin key as an
  // explicit secret instead — see README.md.)
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. Verify the caller and take their id FROM the verified token — never from
  //    the request body. getUser() rejects a missing/expired/tampered token.
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: whoErr } = await caller.auth.getUser();
  if (whoErr || !user) return json({ error: "Not signed in" }, 401, cors);

  // 2. Delete exactly that user with the admin (secret) key. Because user.id
  //    came from the verified token, this can only ever be the caller.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) return json({ error: delErr.message }, 500, cors);

  return json({ ok: true }, 200, cors);
});
