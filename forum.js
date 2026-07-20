/* Myse — the forum ("discuss meal prep and the fitness journey").
 *
 * A standalone page like the log and profile: it renders everything into #forum,
 * loads store.js for the data layer and auth.js for the session, and does NOT
 * load app.js (which binds index.html's DOM). Reading is public; posting needs an
 * account. Because auth.js sends OAuth back to the site root, the *first* sign-in
 * happens on the board — once signed in there, the session persists here, so a
 * signed-out visitor sees a "sign in from the board" prompt rather than a broken
 * sign-in on this page (same constraint as profile.html).
 *
 * Threads and flat replies come from Supabase via MiseStore (loadForumThreads /
 * fetchThread / createThread / createReply / …). Moderation mirrors community
 * recipes: instant post, report, and auto-hide past a report threshold (RLS).
 * Navigation is by hash — #t-<id> opens a thread — so deep links and the back
 * button work.
 */
(function () {
  "use strict";

  var host = document.getElementById("forum");
  if (!host) return;

  var realAuth = typeof MiseAuth !== "undefined" && MiseAuth.enabled;
  var account = realAuth ? null : MiseStore.account();
  var ready = false;         // have threads (or an auth answer) landed yet?
  var unreachable = false;   // gave up reaching the backend

  var CATEGORIES = [
    { id: "general", label: "General" },
    { id: "meal-prep", label: "Meal prep" },
    { id: "fitness", label: "Training & fitness" },
    { id: "journey", label: "Progress & journey" },
    { id: "nutrition", label: "Nutrition & macros" }
  ];
  function catLabel(id) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) return CATEGORIES[i].label;
    return "General";
  }

  var state = { view: "list", category: "all", threadId: null, composing: false };
  var repliesCache = {};   // threadId -> undefined (unfetched) | null (loading) | [replies]

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function me() { return MiseStore.who(account); }
  function myId() { return account && account.id ? account.id : null; }
  function myName() { return (account && account.name) || "Cook"; }
  function $(sel) { return host.querySelector(sel); }
  function fmtDate(iso) { return iso ? String(iso).slice(0, 10) : ""; }

  function threads() { return MiseStore.forumThreads(); }
  function threadById(id) {
    var all = threads();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }

  /* ---------- routing ---------- */

  function readHash() {
    var h = (window.location.hash || "").replace(/^#/, "");
    if (/^t-[a-z0-9-]+$/.test(h)) { state.view = "thread"; state.threadId = h; }
    else { state.view = "list"; state.threadId = null; state.composing = false; }
  }
  window.addEventListener("hashchange", function () { readHash(); render(); });

  /* ---------- shell ---------- */

  function render() {
    if (!ready) { host.innerHTML = '<p class="kit-loading mono">LOADING THE FORUM&hellip;</p>'; return; }
    if (state.view === "thread") renderThread();
    else renderList();
  }

  // A signed-out visitor can read but not post; point them at the board to sign in.
  function postGateHTML(action) {
    return '<p class="forum-signin">Sign in from <a href="index.html">the recipes board</a> to ' + action + '.</p>';
  }

  /* ---------- the thread list ---------- */

  function renderList() {
    var all = threads();
    var list = state.category === "all"
      ? all
      : all.filter(function (t) { return t.category === state.category; });

    var chips = '<button type="button" class="chip forum-cat" data-cat="all" aria-pressed="' + (state.category === "all") + '">All</button>' +
      CATEGORIES.map(function (c) {
        return '<button type="button" class="chip forum-cat" data-cat="' + esc(c.id) + '" aria-pressed="' +
          (state.category === c.id) + '">' + esc(c.label) + "</button>";
      }).join("");

    var composer = "";
    if (state.composing && account) {
      composer =
        '<form id="forum-new" class="forum-compose">' +
          '<div class="cf-field"><label for="fn-cat">Category</label><select id="fn-cat">' +
            CATEGORIES.map(function (c) {
              return '<option value="' + esc(c.id) + '"' + (c.id === state.category ? " selected" : "") + ">" + esc(c.label) + "</option>";
            }).join("") +
          "</select></div>" +
          '<div class="cf-field"><label for="fn-title">Title</label>' +
            '<input id="fn-title" type="text" maxlength="140" placeholder="What\'s it about?"></div>' +
          '<div class="cf-field"><label for="fn-body">Your post</label>' +
            '<textarea id="fn-body" maxlength="5000" rows="5" placeholder="Share the details."></textarea></div>' +
          '<p id="fn-msg" class="auth-error" hidden></p>' +
          '<div class="cf-actions">' +
            '<button type="button" id="fn-cancel" class="cf-cancel mono">Cancel</button>' +
            '<button type="submit" class="review-post">Post thread</button>' +
          "</div>" +
        "</form>";
    }

    // Only offer to post with a real backend behind us: in demo mode (no Supabase)
    // `account` is a name-only local profile and every write would dead-end.
    var startBtn = (realAuth && account)
      ? '<button type="button" id="forum-start" class="review-post forum-start">Start a thread</button>'
      : postGateHTML("start a thread");

    var rows;
    if (!list.length) {
      rows = unreachable
        ? '<p class="kit-none">Can&rsquo;t reach the forum right now &mdash; you may be offline.</p>'
        : '<p class="kit-none">No threads here yet. ' + (account ? "Start the first one." : "Sign in from the board to start the first one.") + "</p>";
    } else {
      rows = '<ul class="forum-list">' + list.map(threadRowHTML).join("") + "</ul>";
    }

    host.innerHTML =
      '<div class="kit-grid forum-grid">' +
        '<div class="kit-sections">' +
          '<section class="kit-section">' +
            '<div class="kit-card">' +
              '<span class="tape mono" aria-hidden="true">THE FORUM</span>' +
              "<h2>Meal prep &amp; the journey</h2>" +
              '<p class="kit-lede">Swap wins, ask questions, and share where you&rsquo;re at. Be supportive &mdash; ' +
                "everyone&rsquo;s on their own timeline, and nothing here is medical advice.</p>" +
              (state.composing ? composer : startBtn) +
            "</div>" +
          "</section>" +
          '<section class="kit-section">' +
            '<div class="forum-cats chip-row">' + chips + "</div>" +
            rows +
          "</section>" +
        "</div>" +
      "</div>";

    var start = $("#forum-start");
    if (start) start.addEventListener("click", function () { state.composing = true; render(); });

    host.querySelectorAll(".forum-cat").forEach(function (b) {
      b.addEventListener("click", function () {
        state.category = this.getAttribute("data-cat");
        render();
      });
    });

    wireComposer();
  }

  function threadRowHTML(t) {
    var mine = myId() && t.userId === myId();
    return '<li class="forum-thread">' +
      '<a class="forum-thread-main" href="#' + esc(t.id) + '">' +
        '<span class="forum-thread-title">' + esc(t.title) + "</span>" +
        '<span class="forum-thread-meta mono">' +
          '<span class="forum-cat-tag">' + esc(catLabel(t.category)) + "</span>" +
          " · " + esc(t.author) + (mine ? " (you)" : "") +
          " · " + esc(fmtDate(t.lastActivity || t.createdAt)) +
          " · " + (t.replyCount || 0) + (t.replyCount === 1 ? " reply" : " replies") +
        "</span>" +
      "</a>" +
    "</li>";
  }

  function wireComposer() {
    var form = $("#forum-new");
    if (!form) return;
    var cancel = $("#fn-cancel");
    if (cancel) cancel.addEventListener("click", function () { state.composing = false; render(); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = $("#fn-msg");
      var show = function (t) { if (msg) { msg.hidden = !t; msg.textContent = t || ""; } };
      if (!account) { show("Sign in from the board to post."); return; }
      var title = ($("#fn-title").value || "").trim();
      var body = ($("#fn-body").value || "").trim();
      if (!title) { show("Give your thread a title."); return; }
      if (!body) { show("Write something in the post."); return; }
      if (typeof MiseModeration !== "undefined") {
        if (MiseModeration.check(myName())) { show("Your display name contains language that isn't allowed here — change it on your account to post."); return; }
        if (MiseModeration.checkAll(title, body)) { show("Please keep it clean — that contains language we don't allow here."); return; }
      }
      var submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      MiseStore.createThread(me(), {
        author: myName(), category: $("#fn-cat").value || "general", title: title, body: body
      }, function (err, id) {
        submit.disabled = false;
        if (err) { show("Couldn't post that. Try again in a moment."); return; }
        state.composing = false;
        if (id) { window.location.hash = id; }   // jump into the new thread
        else render();
      });
    });
  }

  /* ---------- a single thread ---------- */

  function renderThread() {
    var t = threadById(state.threadId);
    if (!t) {
      // Not in the loaded list yet (still loading) or hidden/removed.
      host.innerHTML =
        '<div class="kit-grid forum-grid"><div class="kit-sections"><section class="kit-section">' +
          '<a class="forum-back mono" href="#">&larr; All threads</a>' +
          '<div class="kit-card"><p class="kit-none">' +
            (threads().length ? "This thread isn&rsquo;t available &mdash; it may have been removed." : "Loading&hellip;") +
          "</p></div>" +
        "</section></div></div>";
      wireBack();
      return;
    }

    var mine = myId() && t.userId === myId();
    var replies = repliesCache[t.id];

    var repliesHTML;
    if (replies === undefined) {
      repliesCache[t.id] = null;
      MiseStore.fetchThread(t.id, function (list) {
        repliesCache[t.id] = list || [];
        if (state.view === "thread" && state.threadId === t.id) render();
      });
      repliesHTML = '<p class="kit-none">Loading replies&hellip;</p>';
    } else if (replies === null) {
      repliesHTML = '<p class="kit-none">Loading replies&hellip;</p>';
    } else if (!replies.length) {
      repliesHTML = '<p class="forum-noreplies">No replies yet.</p>';
    } else {
      repliesHTML = '<ul class="forum-replies">' + replies.map(replyHTML).join("") + "</ul>";
    }

    var replyBox = (realAuth && account)
      ? '<form id="forum-reply" class="forum-reply-form">' +
          '<label class="visually-hidden" for="fr-body">Your reply</label>' +
          '<textarea id="fr-body" maxlength="5000" rows="3" placeholder="Write a reply…"></textarea>' +
          '<p id="fr-msg" class="auth-error" hidden></p>' +
          '<button type="submit" class="review-post">Post reply</button>' +
        "</form>"
      : postGateHTML("reply");

    host.innerHTML =
      '<div class="kit-grid forum-grid"><div class="kit-sections">' +
        '<section class="kit-section">' +
          '<a class="forum-back mono" href="#">&larr; All threads</a>' +
          '<div class="kit-card forum-op">' +
            '<span class="forum-cat-tag">' + esc(catLabel(t.category)) + "</span>" +
            '<h2 class="forum-op-title">' + esc(t.title) + "</h2>" +
            '<p class="forum-byline mono">BY ' + esc(t.author).toUpperCase() + (mine ? " (YOU)" : "") + " · " + esc(fmtDate(t.createdAt)) + "</p>" +
            '<p class="forum-body">' + esc(t.body) + "</p>" +
            modActions("thread", t.id, mine) +
          "</div>" +
          '<h3 class="forum-replies-head mono">' + (t.replyCount || 0) + (t.replyCount === 1 ? " REPLY" : " REPLIES") + "</h3>" +
          repliesHTML +
          '<div class="forum-reply-box">' + replyBox + "</div>" +
        "</section>" +
      "</div></div>";

    wireBack();
    wireThreadActions(t);
    wireReply(t);
  }

  function replyHTML(r) {
    var mine = myId() && r.userId === myId();
    return '<li class="forum-reply" data-reply="' + esc(r.id) + '">' +
      '<p class="forum-byline mono">BY ' + esc(r.author).toUpperCase() + (mine ? " (YOU)" : "") + " · " + esc(fmtDate(r.createdAt)) + "</p>" +
      '<p class="forum-body">' + esc(r.body) + "</p>" +
      modActions("reply", r.id, mine) +
    "</li>";
  }

  // Report (others) or Delete (your own). Signed-out sees neither.
  function modActions(kind, id, mine) {
    if (!account) return "";
    if (mine) {
      return '<div class="forum-actions"><button type="button" class="forum-act forum-act--del mono" ' +
        'data-del="' + esc(kind) + '" data-id="' + esc(id) + '">DELETE</button></div>';
    }
    return '<div class="forum-actions"><button type="button" class="forum-act mono" ' +
      'data-report="' + esc(kind) + '" data-id="' + esc(id) + '">REPORT</button></div>';
  }

  function wireBack() {
    var back = $(".forum-back");
    if (back) back.addEventListener("click", function (e) {
      e.preventDefault();
      if (window.history.length > 1) window.history.back();
      else window.location.hash = "";
    });
  }

  function wireReply(t) {
    var form = $("#forum-reply");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = $("#fr-msg");
      var show = function (x) { if (msg) { msg.hidden = !x; msg.textContent = x || ""; } };
      if (!account) { show("Sign in from the board to reply."); return; }
      var body = ($("#fr-body").value || "").trim();
      if (!body) { show("Write something first."); return; }
      if (typeof MiseModeration !== "undefined") {
        if (MiseModeration.check(myName())) { show("Your display name contains language that isn't allowed here — change it on your account to post."); return; }
        if (MiseModeration.check(body)) { show("Please keep it clean — that contains language we don't allow here."); return; }
      }
      var submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      MiseStore.createReply(me(), t.id, body, myName(), function (err) {
        submit.disabled = false;
        if (err) { show("Couldn't post that reply. Try again."); return; }
        repliesCache[t.id] = undefined;   // force a refetch so the new reply shows
        render();
      });
    });
  }

  function wireThreadActions(t) {
    host.querySelectorAll("[data-report]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!account) return;
        var kind = this.getAttribute("data-report");
        var id = this.getAttribute("data-id");
        if (!window.confirm("Report this " + kind + " to the moderators?")) return;
        var btn = this;
        btn.disabled = true;
        MiseStore.reportForum(me(), kind, id, null, function (err) {
          if (err) { btn.disabled = false; return; }
          btn.textContent = "REPORTED";
        });
      });
    });

    host.querySelectorAll("[data-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!account) return;
        var kind = this.getAttribute("data-del");
        var id = this.getAttribute("data-id");
        if (!window.confirm("Delete this " + kind + "? This can't be undone.")) return;
        this.disabled = true;
        if (kind === "thread") {
          MiseStore.deleteThread(me(), id, function (err) {
            if (err) { b.disabled = false; return; }
            window.location.hash = "";   // back to the list; the thread is gone
          });
        } else {
          MiseStore.deleteReply(me(), id, function (err) {
            if (err) { b.disabled = false; return; }
            repliesCache[t.id] = undefined;
            MiseStore.loadForumThreads();   // reply count changed
            render();
          });
        }
      });
    });
  }

  /* ---------- boot ---------- */

  readHash();
  if (threads().length) ready = true;   // instant paint from a prior session's cache
  render();

  MiseStore.onForum(function () { ready = true; render(); });

  if (realAuth) {
    MiseAuth.onChange(function (user) {
      account = user ? { id: user.id, name: user.name, email: user.email } : null;
      // Auth resolved, so the client is ready: we know enough to render now (an
      // empty list if the fetch finds nothing or the tables aren't up yet).
      // onForum re-renders with the threads once the fetch lands.
      ready = true;
      unreachable = false;
      MiseStore.loadForumThreads();
      render();
    });
    MiseStore.onSync(function () {
      var u = MiseAuth.user && MiseAuth.user();
      if (u && u.id && !account) account = { id: u.id, name: u.name, email: u.email };
      render();
    });
    // If onChange never comes (a stalled CDN fetch), give up rather than
    // spinning forever — but slowly, and only claim "can't reach" when the SDK
    // genuinely never landed. See the long note on the same timer in profile.js.
    setTimeout(function () {
      if (ready) return;
      ready = true;
      unreachable = !(MiseAuth.isReady && MiseAuth.isReady());
      render();
    }, 15000);
  } else {
    // No Supabase configured: the forum needs the backend, so say so plainly.
    ready = true;
    unreachable = true;
    render();
  }
})();
