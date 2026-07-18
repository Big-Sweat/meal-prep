/* Mise — tiny dependency-free PDF generator for recipe downloads.
   Lays a recipe out as a single-column printable sheet using the PDF
   base-14 Courier fonts (always present in viewers, monospace so text
   wrapping is exact — no font metrics or embedding needed). */
(function () {
  "use strict";

  var PAGE_W = 612, PAGE_H = 792;      // US Letter, points
  var ML = 54, MR = 54;                // left / right margins
  var TOP = 744, BOTTOM = 60;          // first baseline / bottom limit
  var USABLE = PAGE_W - ML - MR;       // 504pt

  // Brand colors (see styles.css)
  var INK = [0.15, 0.16, 0.12];
  var FADED = [0.43, 0.44, 0.39];
  var KALE = [0.23, 0.42, 0.21];
  var CHILE = [0.66, 0.23, 0.13];
  var LINE = [0.85, 0.83, 0.76];

  /* ---------- text helpers ---------- */

  // Reduce arbitrary text to the ASCII range the base-14 fonts render.
  // Splits "1½" into "1 1/2", turns vulgar fractions into "a/b", and
  // strips diacritics / smart punctuation so nothing drops silently.
  function sanitize(s) {
    return String(s == null ? "" : s)
      .replace(/(\d)\s*([¼-¾⅐-⅞])/g, "$1 $2")
      .normalize("NFKD")
      .replace(/⁄/g, "/")
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„]/g, '"')
      .replace(/[–—―]/g, "-")
      .replace(/[•·]/g, "-")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\t/g, "  ")
      .replace(/[^\x20-\x7e]/g, "");
  }

  function pdfEscape(s) {
    return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  function fmt(n) { return String(Math.round(n * 100) / 100); }
  function sp(n) { return n > 0 ? new Array(n + 1).join(" ") : ""; }
  function padStart(s, n) { s = String(s); return s.length >= n ? s : sp(n - s.length) + s; }
  function padEnd(s, n) { s = String(s); return s.length >= n ? s : s + sp(n - s.length); }

  function charW(size) { return size * 0.6; }            // Courier is 600/1000 em
  function fitChars(size) { return Math.max(1, Math.floor(USABLE / charW(size))); }

  // Greedy word-wrap to a character budget, hard-splitting overlong tokens.
  function wrap(text, maxChars) {
    maxChars = Math.max(4, maxChars);
    var words = String(text).split(/\s+/).filter(Boolean);
    var lines = [], cur = "";
    words.forEach(function (w) {
      while (w.length > maxChars) {
        if (cur) { lines.push(cur); cur = ""; }
        lines.push(w.slice(0, maxChars));
        w = w.slice(maxChars);
      }
      if (!cur) cur = w;
      else if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
      else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  /* ---------- layout ---------- */

  function Layout() {
    this.pages = [{ lines: [], rules: [] }];
    this.y = TOP;
  }
  Layout.prototype.page = function () { return this.pages[this.pages.length - 1]; };
  Layout.prototype.newPage = function () { this.pages.push({ lines: [], rules: [] }); this.y = TOP; };
  Layout.prototype.gap = function (h) { this.y -= h; if (this.y < BOTTOM) this.newPage(); };
  Layout.prototype.ensure = function (h) { if (this.y - h < BOTTOM) this.newPage(); };

  // Emit one already-wrapped visual line at the current cursor.
  Layout.prototype.raw = function (text, o) {
    if (this.y < BOTTOM) this.newPage();
    this.page().lines.push({
      x: ML + (o.indent || 0), y: this.y, size: o.size,
      font: o.font || "F1", color: o.color || INK, text: sanitize(text)
    });
    this.y -= (o.lead || o.size * 1.35);
  };

  // Wrap a paragraph and emit it.
  Layout.prototype.para = function (text, o) {
    var self = this;
    wrap(sanitize(text), fitChars(o.size)).forEach(function (ln) { self.raw(ln, o); });
  };

  // A line with a fixed-width left gutter and hanging indent for wraps.
  // firstPrefix / contPrefix must be the same length.
  Layout.prototype.hang = function (firstPrefix, contPrefix, body, o) {
    var gutter = firstPrefix.length;
    var lines = wrap(sanitize(body), fitChars(o.size) - gutter);
    var self = this;
    lines.forEach(function (ln, i) {
      self.raw((i === 0 ? firstPrefix : contPrefix) + ln, o);
    });
  };

  Layout.prototype.rule = function (color) {
    if (this.y < BOTTOM) this.newPage();
    this.page().rules.push({ x1: ML, x2: PAGE_W - MR, y: this.y + 4, w: 0.75, color: color || LINE });
    this.y -= 8;
  };

  /* ---------- recipe -> layout ---------- */

  function layoutRecipe(m) {
    var L = new Layout();

    if (m.protein) L.raw(m.protein.toUpperCase(), { size: 9, font: "F2", color: KALE, lead: 16 });

    // Title
    wrap(sanitize(m.name), fitChars(20)).forEach(function (ln, i) {
      L.raw(ln, { size: 20, font: "F2", color: INK, lead: i === 0 ? 24 : 23 });
    });
    L.gap(4);

    if (m.description) { L.para(m.description, { size: 10.5, font: "F3", color: FADED, lead: 15 }); L.gap(6); }

    L.rule();
    if (m.meta) L.para(m.meta, { size: 9, font: "F1", color: INK, lead: 13 });
    if (m.contains) L.raw(m.contains, { size: 9, font: "F2", color: m.hasAllergens ? CHILE : KALE, lead: 13 });
    L.rule();
    L.gap(6);

    // Ingredients
    L.ensure(60);
    L.raw("INGREDIENTS", { size: 11, font: "F2", color: KALE, lead: 15 });
    L.raw("servings: " + m.servings + "   (written for " + m.baseServings + ")",
      { size: 8.5, font: "F1", color: FADED, lead: 16 });

    var qtys = m.ingredients.map(function (ing) { return sanitize(ing.qty); });
    var qtyCol = Math.min(16, Math.max.apply(null, qtys.map(function (q) { return q.length; }).concat([1])));
    m.ingredients.forEach(function (ing) {
      var q = sanitize(ing.qty);
      L.hang(padStart(q, qtyCol) + "  ", sp(qtyCol + 2), ing.text,
        { size: 10, font: "F1", color: INK, lead: 14 });
    });
    L.gap(12);

    // Method
    L.ensure(40);
    L.raw("METHOD", { size: 11, font: "F2", color: KALE, lead: 16 });
    var numCol = String(m.steps.length).length + 2; // "N." + space
    m.steps.forEach(function (step, i) {
      L.ensure(24);
      L.hang(padEnd((i + 1) + ".", numCol), sp(numCol), step,
        { size: 10, font: "F1", color: INK, lead: 14 });
      L.gap(4);
    });

    // Storage
    if (m.storageNote) {
      L.gap(6);
      L.ensure(30);
      L.raw("STORAGE", { size: 10, font: "F2", color: KALE, lead: 15 });
      L.para(m.storageNote, { size: 9.5, font: "F1", color: FADED, lead: 13 });
    }

    // Footers
    var total = L.pages.length;
    L.pages.forEach(function (pg, i) {
      pg.lines.push({ x: ML, y: 40, size: 8, font: "F1", color: FADED, text: "MYSE" });
      var stamp = (i + 1) + " / " + total;
      pg.lines.push({
        x: PAGE_W - MR - stamp.length * charW(8), y: 40, size: 8, font: "F1", color: FADED, text: stamp
      });
    });

    return L.pages;
  }

  /* ---------- PDF assembly ---------- */

  function pageStream(pg) {
    var out = [];
    pg.rules.forEach(function (r) {
      out.push(fmt(r.color[0]) + " " + fmt(r.color[1]) + " " + fmt(r.color[2]) + " RG");
      out.push(fmt(r.w) + " w");
      out.push(fmt(r.x1) + " " + fmt(r.y) + " m " + fmt(r.x2) + " " + fmt(r.y) + " l S");
    });
    out.push("BT");
    var cf = null, cs = null, cc = null;
    pg.lines.forEach(function (l) {
      if (l.font !== cf || l.size !== cs) { out.push("/" + l.font + " " + fmt(l.size) + " Tf"); cf = l.font; cs = l.size; }
      var ck = l.color.join(",");
      if (ck !== cc) { out.push(fmt(l.color[0]) + " " + fmt(l.color[1]) + " " + fmt(l.color[2]) + " rg"); cc = ck; }
      out.push("1 0 0 1 " + fmt(l.x) + " " + fmt(l.y) + " Tm");
      out.push("(" + pdfEscape(l.text) + ") Tj");
    });
    out.push("ET");
    return out.join("\n");
  }

  function assemble(pages) {
    var P = pages.length;
    var contentBase = 6, pageBase = 6 + P, total = 5 + 2 * P;
    var objs = [];

    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    var kids = [];
    for (var i = 0; i < P; i++) kids.push((pageBase + i) + " 0 R");
    objs[2] = "<< /Type /Pages /Kids [ " + kids.join(" ") + " ] /Count " + P + " >>";
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>";
    objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>";
    objs[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Oblique >>";
    for (i = 0; i < P; i++) {
      var c = pageStream(pages[i]);
      objs[contentBase + i] = "<< /Length " + c.length + " >>\nstream\n" + c + "\nendstream";
      objs[pageBase + i] =
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_W + " " + PAGE_H + "] " +
        "/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> " +
        "/Contents " + (contentBase + i) + " 0 R >>";
    }

    var body = "%PDF-1.4\n";
    var offsets = [];
    for (var n = 1; n <= total; n++) {
      offsets[n] = body.length;
      body += n + " 0 obj\n" + objs[n] + "\nendobj\n";
    }
    var xrefAt = body.length;
    var xref = "xref\n0 " + (total + 1) + "\n0000000000 65535 f \n";
    for (n = 1; n <= total; n++) xref += padStart(offsets[n], 10).replace(/ /g, "0") + " 00000 n \n";
    var trailer = "trailer\n<< /Size " + (total + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefAt + "\n%%EOF";
    return body + xref + trailer;
  }

  function buildRecipePDF(model) { return assemble(layoutRecipe(model)); }

  function download(model, filename) {
    var blob = new Blob([buildRecipePDF(model)], { type: "application/pdf" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename || "recipe.pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  window.MisePDF = { buildRecipePDF: buildRecipePDF, download: download };
})();
