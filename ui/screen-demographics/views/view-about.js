// view-about.js
//
// "About" view: long-form explanations that used to live inside tooltips
// (cross-age filter constraints, CSV export plumbing). The tooltips now
// just point here with a one-line summary.
//
// Visual language: matches the rest of the screen (gold accent #f3c34c,
// cream body #e5d2ac/#d6d8dc, parchment dark backgrounds). Uses card
// panels, two-column grids, and dividers so the page reads like a
// designed reference rather than a wall of text.

const DBG = true;
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-about]", ...a);
}

const CROSS_AGE_CHANNELS = [
  ["GameTutorial.setProperty", "wiped at age transition"],
  ["Players[pid].Tutorial.setProperty", "wiped at age transition"],
  ["Catalog hash-scoped Tutorial bag", "same wipe (routes to the above)"],
  ["JS module heap / globalThis", "module reloaded at age transition"],
  ["localStorage.setItem", "does not survive process restart"],
  ["LiveEvent flags", "session-scoped, inverted, 1-bit"],
  ["Modding.setModProperty", "typeof undefined (binding absent)"],
  ["HallofFame.setDataPoint", "typeof undefined"],
  ["HallofFame.adjustDataPoint", "typeof undefined"],
  ["HallofFame.getOrCreateDataPoint", "typeof undefined"],
  ["HallofFame.setDataSetValue", "typeof undefined"],
  ["HallofFame.adjustDataSetValue", "typeof undefined"],
  ["HallofFame.getOrCreateDataSet", "typeof undefined"],
  ["HallofFame.createObject", "typeof undefined"],
  ["HallofFame.addRulesetType", "typeof undefined"],
  [
    "HallofFame.getGraphs(currentGameId)",
    "in-progress game returns []; HoF DB only commits completed games"
  ],
  ["Network.saveGame variants", "deadlocks the game"],
  ["Database.execute", "no such method (query is read-only)"],
  ["engine.call / PlayerOperations", "fixed op enum, no generic K/V"],
  ["GameStateStorage.*", "save-file query API, not a K/V store"],
  ["UI.getClipboardText", "no such symbol in the binary"],
  ["Local file I/O / fetch / coui://", "no JS file-write surface present"]
];

const CROSS_AGE_UNBLOCKERS = [
  {
    h: "Activate Modding.setModProperty",
    d: "The getter <code>Modding.getModProperty(key)</code> exists; the setter is currently undefined. A small C++ binding around a SQLite K/V table that mods can write to."
  },
  {
    h: "Don't wipe Players[pid].Tutorial.setProperty",
    d: "The bag works perfectly within an age. The wipe is presumably a deliberate UI-state reset that could simply skip mod-namespaced keys (e.g. anything prefixed <code>MOD_</code>)."
  },
  {
    h: "Expose HallofFame.getGraphs() for in-progress games",
    d: "The DB schema and per-turn writes already exist; only the JS binding for in-progress reads is missing."
  },
  {
    h: "Documented save-file section per mod",
    d: "One TEXT blob per mod-id, round-tripped through the standard save/load path. Lets mods persist arbitrary state alongside the player's save."
  }
];

const CSV_SIZE_THRESHOLDS = [
  { mark: "< 2 MB", desc: "full clipboard + full log dump", tone: "good" },
  {
    mark: "2 – 8 MB",
    desc: "clipboard only; log summary (avoids stalling the log writer)",
    tone: "warn"
  },
  { mark: "> 8 MB", desc: "refused; lower History sample cap in Options and retry", tone: "bad" }
];

const CSV_EXPECTED_SIZES = [
  "Standard speed, 10 civs, full game (~500 turns) → <b>~1.5&nbsp;MB</b>. Well under all limits.",
  "Marathon speed (~1500 turns), 10 civs → <b>~4&nbsp;MB</b>. Soft path (clipboard OK, log summary only).",
  "Power-user <i>Unlimited samples</i> + Marathon + 14 civs → can exceed <b>8&nbsp;MB</b> and trigger the abort."
];

// ───────────────────────── style tokens ─────────────────────────
const C_GOLD = "#f3c34c";
const C_GOLD_DIM = "rgba(201,162,76,0.55)";
const C_CREAM = "#e5d2ac";
const C_BODY = "#d6d8dc";
const C_MUTED = "#9aa0aa";
const C_PANEL_BG = "rgba(18, 20, 24, 0.55)";
const C_PANEL_BD = "rgba(168,132,90,0.35)";

const TONE_COLORS = {
  good: "#7fc28a",
  warn: "#e6b34d",
  bad: "#d97c7c"
};

// ───────────────────────── element factories ─────────────────────────

function elDiv(css) {
  const d = document.createElement("div");
  if (css) d.style.cssText = css;
  return d;
}

function pageHeader() {
  const wrap = elDiv(
    "display:flex;flex-direction:column;align-items:flex-start;" +
      "margin:0 0 1.6rem;padding:0 0 1rem;" +
      "border-bottom:1px solid " +
      C_GOLD_DIM +
      ";"
  );
  const eyebrow = elDiv(
    "color:" +
      C_CREAM +
      ";font-family:TitleFont, BodyFont, sans-serif;" +
      "font-size:0.82rem;font-weight:600;letter-spacing:0.18em;" +
      "text-transform:uppercase;margin-bottom:0.35rem;opacity:0.85;"
  );
  eyebrow.textContent = "Demographics Mod";
  const title = elDiv(
    "color:" +
      C_GOLD +
      ";font-family:TitleFont, BodyFont, sans-serif;" +
      "font-size:2rem;font-weight:700;letter-spacing:0.04em;line-height:1.1;"
  );
  title.textContent = "About & Engine Notes";
  const blurb = elDiv(
    "color:" + C_BODY + ";font-size:1rem;line-height:1.5;margin-top:0.6rem;max-width:48rem;"
  );
  blurb.innerHTML =
    "Background on the two parts of the mod that bump into engine-level limits: the " +
    '<b style="color:' +
    C_CREAM +
    ";\">cross-age time filters</b> (which we can't make work today) and the " +
    '<b style="color:' +
    C_CREAM +
    ';">CSV export</b> (which has to go through the clipboard instead of a saved file).';
  wrap.appendChild(eyebrow);
  wrap.appendChild(title);
  wrap.appendChild(blurb);
  return wrap;
}

function panel(title, opts = {}) {
  const card = elDiv(
    "background:" +
      C_PANEL_BG +
      ";" +
      "border:1px solid " +
      C_PANEL_BD +
      ";" +
      "border-left:3px solid " +
      C_GOLD +
      ";" +
      "border-radius:0.25rem;" +
      "padding:1.3rem 1.6rem 1.4rem;" +
      "margin:0 0 1.4rem;"
  );
  const titleWrap = elDiv(
    "display:flex;align-items:baseline;justify-content:space-between;gap:1rem;" +
      "margin-bottom:0.4rem;padding-bottom:0.5rem;" +
      "border-bottom:1px solid " +
      C_GOLD_DIM +
      ";"
  );
  const h = elDiv(
    "color:" +
      C_GOLD +
      ";font-family:TitleFont, BodyFont, sans-serif;" +
      "font-size:1.35rem;font-weight:700;letter-spacing:0.04em;"
  );
  h.textContent = title;
  titleWrap.appendChild(h);
  if (opts.badge) {
    const badge = elDiv(
      "color:" +
        (TONE_COLORS[opts.badgeTone] || C_CREAM) +
        ";" +
        "font-family:TitleFont, BodyFont, sans-serif;font-size:0.78rem;" +
        "font-weight:700;text-transform:uppercase;letter-spacing:0.14em;" +
        "padding:0.18rem 0.55rem;border:1px solid currentColor;border-radius:1rem;" +
        "white-space:nowrap;"
    );
    badge.textContent = opts.badge;
    titleWrap.appendChild(badge);
  }
  card.appendChild(titleWrap);
  return card;
}

function subSection(label) {
  const el = elDiv(
    "color:" +
      C_CREAM +
      ";font-family:TitleFont, BodyFont, sans-serif;" +
      "font-size:0.92rem;font-weight:700;text-transform:uppercase;letter-spacing:0.14em;" +
      "margin:1.1rem 0 0.6rem;"
  );
  el.textContent = label;
  return el;
}

function lead(html) {
  const el = elDiv(
    "color:" + C_BODY + ";font-size:0.98rem;line-height:1.55;margin:0.2rem 0 0.6rem;"
  );
  el.innerHTML = html;
  return el;
}

// Two-column channel grid styled as a clean table with alternating row tone.
function channelGrid(rows) {
  const grid = elDiv(
    "display:grid;" +
      "grid-template-columns:minmax(20rem,max-content) 1fr;" +
      "column-gap:1.5rem;row-gap:0;" +
      "border:1px solid " +
      C_PANEL_BD +
      ";border-radius:0.2rem;overflow:hidden;"
  );
  rows.forEach(([label, result], i) => {
    const bg = i % 2 === 0 ? "rgba(28,32,40,0.45)" : "rgba(18,20,24,0.45)";
    const k = elDiv(
      "color:" +
        C_CREAM +
        ";font-family:Consolas,'Courier New',monospace;" +
        "font-size:0.88rem;padding:0.45rem 0.85rem;background:" +
        bg +
        ";" +
        "white-space:nowrap;border-right:1px solid " +
        C_PANEL_BD +
        ";"
    );
    k.textContent = label;
    const v = elDiv(
      "color:" +
        C_BODY +
        ";font-size:0.92rem;line-height:1.4;" +
        "padding:0.45rem 0.85rem;background:" +
        bg +
        ";"
    );
    v.textContent = result;
    grid.appendChild(k);
    grid.appendChild(v);
  });
  return grid;
}

// Numbered unblocker cards in a 2-column grid.
function unblockerGrid(items) {
  const grid = elDiv("display:grid;grid-template-columns:1fr 1fr;gap:0.9rem;");
  items.forEach((it, i) => {
    const card = elDiv(
      "background:rgba(18,20,24,0.55);" +
        "border:1px solid " +
        C_PANEL_BD +
        ";border-radius:0.2rem;" +
        "padding:0.85rem 1rem 0.9rem;display:flex;gap:0.85rem;"
    );
    const num = elDiv(
      "color:" +
        C_GOLD +
        ";font-family:TitleFont, BodyFont, sans-serif;" +
        "font-size:1.4rem;font-weight:700;line-height:1;flex-shrink:0;" +
        "min-width:1.8rem;"
    );
    num.textContent = String(i + 1);
    const text = elDiv("flex:1;");
    const h = elDiv(
      "color:" +
        C_CREAM +
        ";font-family:TitleFont, BodyFont, sans-serif;" +
        "font-size:0.98rem;font-weight:700;margin-bottom:0.25rem;line-height:1.25;"
    );
    h.textContent = it.h;
    const d = elDiv("color:" + C_BODY + ";font-size:0.9rem;line-height:1.5;");
    d.innerHTML = it.d;
    text.appendChild(h);
    text.appendChild(d);
    card.appendChild(num);
    card.appendChild(text);
    grid.appendChild(card);
  });
  return grid;
}

// CSV size threshold rows — color-coded mark + description.
function sizeThresholdGrid(rows) {
  const grid = elDiv("display:grid;grid-template-columns:repeat(3, 1fr);gap:0.9rem;");
  rows.forEach(({ mark, desc, tone }) => {
    const card = elDiv(
      "background:rgba(18,20,24,0.55);" +
        "border:1px solid " +
        C_PANEL_BD +
        ";border-radius:0.2rem;" +
        "border-top:3px solid " +
        (TONE_COLORS[tone] || C_CREAM) +
        ";" +
        "padding:0.85rem 1rem 0.9rem;"
    );
    const m = elDiv(
      "color:" +
        (TONE_COLORS[tone] || C_CREAM) +
        ";" +
        "font-family:TitleFont, BodyFont, sans-serif;" +
        "font-size:1.05rem;font-weight:700;margin-bottom:0.35rem;letter-spacing:0.03em;"
    );
    m.textContent = mark;
    const d = elDiv("color:" + C_BODY + ";font-size:0.9rem;line-height:1.45;");
    d.textContent = desc;
    card.appendChild(m);
    card.appendChild(d);
    grid.appendChild(card);
  });
  return grid;
}

function expectedList(items) {
  const ul = document.createElement("ul");
  ul.style.cssText =
    "list-style:none;padding:0;margin:0.4rem 0 0;display:flex;flex-direction:column;gap:0.45rem;";
  items.forEach((html) => {
    const li = document.createElement("li");
    li.style.cssText =
      "color:" +
      C_BODY +
      ";font-size:0.92rem;line-height:1.5;" +
      "padding:0.55rem 0.85rem;background:rgba(18,20,24,0.4);" +
      "border-left:2px solid " +
      C_GOLD_DIM +
      ";border-radius:0.15rem;";
    li.innerHTML = html;
    ul.appendChild(li);
  });
  return ul;
}

// ───────────────────────── render ─────────────────────────

export function render(host, _ctx) {
  while (host.firstChild) host.removeChild(host.firstChild);

  // Host is a flex column (.demographics-view-host: flex:1; display:flex;
  // flex-direction:column; min-height:0). To actually scroll inside it the
  // scroll container must itself be flex:1 + min-height:0 + overflow-y:auto.
  // Fill the full width (no max-width / centering — empty side gutters were
  // the "wasted space on the tab" complaint), with generous side padding so
  // content never touches the surrounding parchment frame.
  const scroll = elDiv(
    "flex:1 1 auto;min-height:0;width:100%;" +
      "overflow-y:auto;overflow-x:hidden;" +
      "padding:1.6rem 2.5rem 2.5rem;" +
      "font-family:BodyFont, sans-serif;color:" +
      C_BODY +
      ";" +
      "text-align:left;box-sizing:border-box;"
  );
  host.appendChild(scroll);

  scroll.appendChild(pageHeader());

  // ─── Cross-age graphs panel ─────────────────────────────────────────
  const crossAge = panel("Cross-Age Graphs", {
    badge: "Blocked by engine",
    badgeTone: "bad"
  });
  crossAge.appendChild(
    lead(
      '<b style="color:' +
        C_CREAM +
        ';">A single graph spanning Antiquity, Exploration, and Modern is not possible in Civ&nbsp;7 today.</b> ' +
        "The mod can only ever plot the age you're currently in — there's no way for it to carry the samples " +
        "it collected during Antiquity into the Exploration chart, or Exploration's into Modern."
    )
  );
  crossAge.appendChild(
    lead(
      "The blocker is storage, not display. Every channel a mod can reach to save data is either " +
        '<b style="color:' +
        C_CREAM +
        ';">wiped at the age transition</b> or ' +
        '<b style="color:' +
        C_CREAM +
        ';">absent from the engine binary entirely</b>. ' +
        "When the new age boots, the mod restarts with an empty history and re-samples from turn one of that age."
    )
  );
  crossAge.appendChild(
    lead(
      "That's also why the cross-age time-range filters (<b style=\"color:" +
        C_CREAM +
        ';">All Time</b>, ' +
        '<b style="color:' +
        C_CREAM +
        ';">1st Age</b>, <b style="color:' +
        C_CREAM +
        ';">2nd Age</b>, ' +
        '<b style="color:' +
        C_CREAM +
        ";\">3rd Age</b>) are greyed out — they'd need data the mod can't access. " +
        "Until Firaxis exposes a persistent storage API, only within-age windows are meaningful. Pick any year-range " +
        'filter or <b style="color:' +
        C_CREAM +
        ';">Current&nbsp;Age</b> on the chart toolbar.'
    )
  );
  crossAge.appendChild(subSection("Channels tested"));
  crossAge.appendChild(channelGrid(CROSS_AGE_CHANNELS));
  crossAge.appendChild(subSection("What would unblock this"));
  crossAge.appendChild(unblockerGrid(CROSS_AGE_UNBLOCKERS));
  scroll.appendChild(crossAge);

  // ─── CSV export panel ────────────────────────────────────────────────
  const csv = panel("CSV Export", {
    badge: "Clipboard-routed",
    badgeTone: "warn"
  });
  csv.appendChild(
    lead(
      'Copies <b style="color:' +
        C_CREAM +
        ';">every sampled turn</b> for <b style="color:' +
        C_CREAM +
        ';">every civilization</b> ' +
        "into a comma-separated table on your clipboard. Paste into Excel, Google Sheets, or save as a <code>.csv</code> file. " +
        "Includes identity columns plus every metric the chart shows."
    )
  );

  csv.appendChild(subSection("Why no file export?"));
  csv.appendChild(
    lead(
      "Civ&nbsp;7's UI runs inside the Coherent GameFace sandbox, which strips the browser APIs that would normally " +
        "drive a download: <code>URL.createObjectURL</code>, the <code>download</code> attribute on <code>&lt;a&gt;</code>, " +
        "the File System Access API, and direct disk writes are all absent. The engine also exposes no scripting hook " +
        "for &lt;Save&nbsp;As&gt; dialogs to mods."
    )
  );
  csv.appendChild(
    lead(
      "The clipboard is the one reliable hand-off available, so we route through <code>UI.setClipboardText</code> and " +
        "let you paste into any app that can save the file for you. A full copy is also written to <code>UI.log</code> " +
        "as a fallback when the payload is small enough."
    )
  );

  csv.appendChild(subSection("Size thresholds"));
  csv.appendChild(sizeThresholdGrid(CSV_SIZE_THRESHOLDS));

  csv.appendChild(subSection("Expected sizes"));
  csv.appendChild(expectedList(CSV_EXPECTED_SIZES));

  scroll.appendChild(csv);

  dlog("about view mounted");
}
