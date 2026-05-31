// view-factbook.js
//
// "World Factbook" view: a spreadsheet-style matrix built from flex
// columns rather than an HTML <table>.
//
// Layout: each civ is a vertical column, each metric is a horizontal row.
//   Column 1: metric labels                  (sticky-left)
//   Column 2: local player's civ values      (sticky-left, gold border)
//   Column 3+: every other met civ, sorted by leader name
//
// Vanilla Civ7 uses zero <table> elements (a grep across
// Resources/Base/modules turns up no createElement("table") and no
// `<table` literals). Coherent's GameFace renders tables unreliably,
// hence flex.

import { METRICS } from "/demographics/ui/demographics-metrics.js";
import { safePlaySound, playActivate } from "/demographics/ui/demographics-audio.js";

const DBG = true;
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-factbook]", ...a);
}

function safeCall(fn, fb) {
  try {
    return fn();
  } catch (_) {
    return fb;
  }
}

function getLocalId() {
  return safeCall(() => {
    if (typeof GameContext !== "undefined" && GameContext) {
      const v = GameContext.localPlayerID;
      if (typeof v === "number") return v;
      const o = GameContext.localObserverID;
      if (typeof o === "number") return o;
    }
    return undefined;
  });
}

// Build a { pid -> profile } map by folding every newer non-empty field over
// the older one across the full history.
function buildCivProfiles(history) {
  const profiles = {};
  const samples = history?.samples || [];
  for (const s of samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const ps = s.players[pid];
      if (!profiles[pid]) {
        profiles[pid] = {
          pid,
          leaderKey: String(ps?.leaderType ?? "pid:" + pid),
          leaderName: undefined,
          civName: undefined,
          civNames: [],
          leaderTypeString: undefined,
          civTypeString: undefined,
          primaryColor: undefined,
          secondaryColor: undefined,
          latest: {}
        };
      }
      if (typeof ps?.leaderName === "string" && ps.leaderName.length > 0) {
        profiles[pid].leaderName = ps.leaderName;
      }
      if (typeof ps?.civName === "string" && ps.civName.length > 0) {
        profiles[pid].civName = ps.civName;
        const arr = profiles[pid].civNames;
        if (!arr.includes(ps.civName)) arr.push(ps.civName);
      }
      if (typeof ps?.leaderTypeString === "string" && ps.leaderTypeString.length > 0) {
        profiles[pid].leaderTypeString = ps.leaderTypeString;
      }
      if (typeof ps?.civTypeString === "string" && ps.civTypeString.length > 0) {
        profiles[pid].civTypeString = ps.civTypeString;
      }
      if (typeof ps?.primaryColor === "string" && ps.primaryColor.length > 0) {
        profiles[pid].primaryColor = ps.primaryColor;
      }
      if (typeof ps?.secondaryColor === "string" && ps.secondaryColor.length > 0) {
        profiles[pid].secondaryColor = ps.secondaryColor;
      }
      if (typeof ps?.met === "boolean") profiles[pid].met = ps.met;
      const m = ps?.metrics || {};
      for (const k of Object.keys(m)) {
        const v = m[k];
        if (typeof v === "number" && isFinite(v)) profiles[pid].latest[k] = v;
      }
    }
  }
  return profiles;
}

// Map<pid, rank> over all civs that have a numeric value for metricId.
function computeRanks(profiles, metricId) {
  const entries = [];
  for (const pid of Object.keys(profiles)) {
    const v = profiles[pid].latest?.[metricId];
    if (typeof v === "number" && isFinite(v)) entries.push({ pid, v });
  }
  entries.sort((a, b) => b.v - a.v);
  const ranks = new Map();
  let lastV;
  let lastRank = 0;
  entries.forEach((e, i) => {
    if (e.v !== lastV) {
      lastRank = i + 1;
      lastV = e.v;
    }
    ranks.set(e.pid, lastRank);
  });
  return { ranks, total: entries.length };
}

function buildLeaderAvatar(profile, sizeRem) {
  const wrap = document.createElement("div");
  wrap.className = "demographics-factbook-avatar";
  wrap.style.width = sizeRem + "rem";
  wrap.style.height = sizeRem + "rem";
  wrap.style.flexShrink = "0";

  const leaderType = profile.leaderTypeString;
  try {
    if (leaderType && typeof leaderType === "string" && /^LEADER_/.test(leaderType)) {
      const portrait = document.createElement("fxs-icon");
      portrait.setAttribute("data-icon-id", leaderType);
      portrait.setAttribute("data-icon-context", "LEADER");
      portrait.classList.add("demographics-factbook-portrait");
      portrait.style.width = "100%";
      portrait.style.height = "100%";
      wrap.appendChild(portrait);
      return wrap;
    }
  } catch (_) {
    /* fall through */
  }

  const placeholder = document.createElement("div");
  placeholder.className = "demographics-factbook-avatar-placeholder";
  const initial = (profile.leaderName || "?").trim().charAt(0).toUpperCase() || "?";
  placeholder.textContent = initial;
  wrap.appendChild(placeholder);
  return wrap;
}

// Build a civ-column header div (avatar + leader + civ + formerly suffix).
// `maskAsUnmet` (Fix 4): when true, replace leader/civ names with generic
// "Unmet Leader" / "Unmet Civilization" placeholders and suppress the
// formerly suffix. Avatar falls back to its built-in placeholder (no
// LeaderType lookup).
function buildCivHeader(profile, isLocal, maskAsUnmet, opts) {
  const wrap = document.createElement("div");
  wrap.className = "demographics-factbook-cell demographics-factbook-civ-header";
  if (isLocal) wrap.classList.add("is-local");
  if (maskAsUnmet) wrap.classList.add("is-unmet");

  // For unmet civs, force the avatar's placeholder rather than the actual
  // leader portrait — build a shallow profile clone with leaderTypeString
  // stripped so buildLeaderAvatar takes the fallback path.
  const avatarProfile = maskAsUnmet
    ? Object.assign({}, profile, { leaderTypeString: undefined, leaderName: "?" })
    : profile;
  const avatar = buildLeaderAvatar(avatarProfile, isLocal ? 4 : 3);
  if (profile.primaryColor && !maskAsUnmet) avatar.style.borderColor = profile.primaryColor;
  wrap.appendChild(avatar);

  const text = document.createElement("div");
  text.className = "demographics-factbook-civ-header-text";
  wrap.appendChild(text);

  const leader = document.createElement("div");
  leader.className = "demographics-factbook-civ-header-leader font-title text-sm";
  leader.textContent = maskAsUnmet ? "Unmet Leader" : profile.leaderName || "Player " + profile.pid;
  text.appendChild(leader);

  if (maskAsUnmet) {
    const civ = document.createElement("div");
    civ.className = "demographics-factbook-civ-header-civ font-body text-xs";
    civ.textContent = "Unmet Civilization";
    text.appendChild(civ);
  } else if (profile.civName) {
    const civ = document.createElement("div");
    civ.className = "demographics-factbook-civ-header-civ font-body text-xs";
    civ.textContent = profile.civName;
    text.appendChild(civ);

    const all = Array.isArray(profile.civNames) ? profile.civNames : [];
    const prior = all.filter((n) => n && n !== profile.civName);
    if (prior.length > 0) {
      const fmr = document.createElement("div");
      fmr.className = "demographics-factbook-civ-header-formerly font-body text-xs";
      fmr.textContent = "(formerly " + prior.join(", ") + ")";
      text.appendChild(fmr);
    }
  }

  return wrap;
}

// Build a single value cell (value on top, rank below).
function buildValueCell(metric, profile) {
  const cell = document.createElement("div");
  cell.className = "demographics-factbook-cell demographics-factbook-value-cell";

  const v = profile.latest?.[metric.id];
  const value = document.createElement("div");
  value.className = "demographics-factbook-cell-value font-body text-sm";
  if (typeof v === "number" && isFinite(v)) {
    try {
      value.textContent = metric.format(v);
    } catch (_) {
      value.textContent = String(Math.round(v));
    }
  } else {
    value.textContent = "—";
  }
  cell.appendChild(value);

  return cell;
}

function buildRankCell(rank, total) {
  const cell = document.createElement("div");
  cell.className = "demographics-factbook-cell-rank font-body text-xs";
  cell.textContent = typeof rank === "number" ? "Rank " + rank + "/" + total : "";
  return cell;
}

// Build the metric-label column (column 1).
function buildLabelColumn(opts) {
  const col = document.createElement("div");
  col.className = "demographics-factbook-col demographics-factbook-col-labels";

  const header = document.createElement("div");
  header.className = "demographics-factbook-cell demographics-factbook-corner";
  if (opts && opts.hiddenCount > 0 && typeof opts.onReset === "function") {
    const btn = document.createElement("div");
    btn.className = "demographics-factbook-reset-btn font-body text-xs";
    btn.textContent = "Reset (" + opts.hiddenCount + " hidden)";
    btn.title = "Show all hidden civilizations";
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      safePlaySound("data-audio-activate", "options");
      opts.onReset();
    });
    header.appendChild(btn);
  }
  col.appendChild(header);

  let rowIdx = 0;
  for (const m of METRICS.filter((x) => !x.factbookHidden)) {
    const row = document.createElement("div");
    row.className = "demographics-factbook-cell demographics-factbook-label-cell font-body text-sm";
    if (rowIdx > 0 && rowIdx % 4 === 0) row.classList.add("is-heavy-divider");
    row.textContent = m.label;
    col.appendChild(row);
    rowIdx++;
  }
  return col;
}

// Build a civ column: header on top, one value+rank cell per metric below.
function buildCivColumn(profile, profiles, isLocal, maskAsUnmet, opts) {
  const col = document.createElement("div");
  col.className = "demographics-factbook-col demographics-factbook-col-civ";
  if (isLocal) col.classList.add("is-local");

  col.appendChild(buildCivHeader(profile, isLocal, maskAsUnmet, opts));

  let rowIdx = 0;
  for (const m of METRICS.filter((x) => !x.factbookHidden)) {
    const { ranks, total } = computeRanks(profiles, m.id);
    const cell = buildValueCell(m, profile);
    if (rowIdx > 0 && rowIdx % 4 === 0) cell.classList.add("is-heavy-divider");
    cell.appendChild(buildRankCell(ranks.get(profile.pid), total));
    col.appendChild(cell);
    rowIdx++;
  }
  return col;
}

export function render(host, ctx) {
  while (host.firstChild) host.removeChild(host.firstChild);

  const profiles = buildCivProfiles(ctx.history);
  // Apply `showEliminatedCivs` option (default true). When disabled,
  // strip eliminated civs from the factbook profile list so only living
  // civs appear in the matrix. Eliminated map comes from history.eliminated
  // populated by the sampler at civ death.
  let showEliminatedCivs = true;
  try {
    showEliminatedCivs = !!ctx.settings?.getSetting?.("showEliminatedCivs", true);
  } catch (_) {
    showEliminatedCivs = true;
  }
  if (!showEliminatedCivs) {
    const elim =
      ctx.history && ctx.history.eliminated && typeof ctx.history.eliminated === "object"
        ? ctx.history.eliminated
        : {};
    for (const pid of Object.keys(profiles)) {
      if (elim[pid] || elim[Number(pid)]) {
        delete profiles[pid];
      }
    }
  }
  const allPids = Object.keys(profiles);
  if (allPids.length === 0) {
    const empty = document.createElement("div");
    empty.className = "demographics-empty font-body text-base";
    empty.textContent = "No samples yet — play a turn and reopen.";
    host.appendChild(empty);
    return;
  }

  const localId = getLocalId();
  let localPid =
    typeof localId === "number" && profiles[String(localId)] ? String(localId) : allPids[0];
  const otherPids = allPids
    .filter((p) => p !== localPid)
    .sort((a, b) => {
      const na = profiles[a].leaderName || a;
      const nb = profiles[b].leaderName || b;
      return na.localeCompare(nb);
    });

  // Read "show unmet names" setting (Fix 4). When false, mask unmet civs.
  let showUnmetNames = false;
  try {
    showUnmetNames = !!ctx.settings?.getSetting?.("showUnmetNames", false);
  } catch (_) {
    showUnmetNames = false;
  }
  function isUnmet(pid) {
    if (showUnmetNames) return false;
    if (pid === localPid) return false;
    const p = profiles[pid];
    // Defensive: only mask when met is EXPLICITLY false.
    return p && p.met === false;
  }

  dlog("rendering factbook; local=", localPid, "others=", otherPids.length);

  // Per-civ visibility set persists in modSettings.demographics.factbookHiddenCivs
  // as an array of pid strings. Local player is never hidden.
  let hiddenCivs = new Set();
  try {
    const raw = ctx.settings?.getSetting?.("factbookHiddenCivs", []);
    if (Array.isArray(raw)) hiddenCivs = new Set(raw.map((v) => String(v)));
  } catch (_) {
    /* */
  }
  function saveHidden() {
    try {
      ctx.settings?.setSetting?.("factbookHiddenCivs", Array.from(hiddenCivs));
    } catch (_) {
      /* */
    }
  }
  function toggleCiv(pid) {
    const k = String(pid);
    if (hiddenCivs.has(k)) hiddenCivs.delete(k);
    else hiddenCivs.add(k);
    saveHidden();
    renderStrip();
  }
  function resetHidden() {
    hiddenCivs.clear();
    saveHidden();
    renderStrip();
  }

  // Affordance hint — without this, the click-to-hide interaction is
  // invisible to first-time users. A subtle one-liner above the matrix
  // ("👆"-style cursor glyph + plain text), styled to read as guidance
  // rather than chrome.
  const hint = document.createElement("div");
  hint.className = "demographics-factbook-hint font-body text-xs";
  hint.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:0.4rem",
    "padding:0.3rem 0.6rem 0.45rem",
    "color:#e5d2ac",
    "opacity:0.85",
    "font-style:italic"
  ].join(";");
  const hintIcon = document.createElement("div");
  hintIcon.style.cssText = [
    "width:1rem",
    "height:1rem",
    "background-image:url('blp:icon_info')",
    "background-size:contain",
    "background-repeat:no-repeat",
    "background-position:center",
    "flex:0 0 auto",
    "opacity:0.85"
  ].join(";");
  const hintText = document.createElement("span");
  hintText.textContent =
    "Tip: click any civilization's header to hide it and focus the comparison. Click again (in the slim column on the right) to bring it back.";
  hint.appendChild(hintIcon);
  hint.appendChild(hintText);
  host.appendChild(hint);

  // Scroll container (horizontal scroll).
  const scrollWrap = document.createElement("div");
  scrollWrap.className = "demographics-factbook-matrix";
  host.appendChild(scrollWrap);

  const strip = document.createElement("div");
  strip.className = "demographics-factbook-strip";
  scrollWrap.appendChild(strip);

  function renderStrip() {
    while (strip.firstChild) strip.removeChild(strip.firstChild);

    // Column 1: metric labels (sticky-left).
    const labelCol = buildLabelColumn({
      hiddenCount: hiddenCivs.size,
      onReset: resetHidden
    });
    labelCol.classList.add("demographics-factbook-col-sticky");
    strip.appendChild(labelCol);

    // Column 2: local player (sticky-left, never hidable).
    const localCol = buildCivColumn(profiles[localPid], profiles, true, false);
    localCol.classList.add("demographics-factbook-col-sticky-2");
    strip.appendChild(localCol);

    // Columns 3+: visible civs first (preserve sort), then any hidden
    // ones pushed to the far right as thin "ghost" columns. Keeping the
    // visible columns adjacent to the local-player column makes
    // comparisons easier.
    const visiblePids = [];
    const hiddenPids = [];
    for (const pid of otherPids) {
      if (hiddenCivs.has(String(pid))) hiddenPids.push(pid);
      else visiblePids.push(pid);
    }
    const ordered = visiblePids.concat(hiddenPids);
    for (const pid of ordered) {
      const isHidden = hiddenCivs.has(String(pid));
      const headerOpts = {
        visible: !isHidden,
        onToggle: () => toggleCiv(pid)
      };
      const col = isHidden
        ? buildGhostCivColumn(profiles[pid], isUnmet(pid), headerOpts)
        : buildCivColumn(profiles[pid], profiles, false, isUnmet(pid), headerOpts);
      const header = col.querySelector(".demographics-factbook-civ-header");
      if (header) {
        header.style.cursor = "pointer";
        header.title = isHidden ? "Click to show" : "Click to hide";
        header.addEventListener("click", () => {
          safePlaySound("data-audio-checkbox-press", "audio-screen-unlocks");
          dlog("factbook header click pid=" + pid, "wasHidden=" + isHidden);
          toggleCiv(pid);
        });
      }
      strip.appendChild(col);
    }
  }
  renderStrip();
}

// Slim "ghost" column shown for hidden civs — just a narrow header with
// the leader name (or unmet placeholder), no metric cells. Lets the user
// see who's hidden and click to bring them back. The visible civs flex
// to fill the remaining space (per the CSS `.demographics-factbook-col
// { flex: 1 0 9rem }`).
function buildGhostCivColumn(profile, maskAsUnmet, opts) {
  const col = document.createElement("div");
  col.className = "demographics-factbook-col demographics-factbook-col-civ is-hidden";

  const wrap = document.createElement("div");
  wrap.className = "demographics-factbook-cell demographics-factbook-civ-header is-ghost";
  col.appendChild(wrap);

  const text = document.createElement("div");
  text.className = "demographics-factbook-civ-header-text";
  wrap.appendChild(text);

  const leader = document.createElement("div");
  leader.className = "demographics-factbook-civ-header-leader font-title text-xs";
  leader.textContent = maskAsUnmet ? "Unmet" : profile.leaderName || "Player " + profile.pid;
  text.appendChild(leader);

  const hint = document.createElement("div");
  hint.className = "demographics-factbook-civ-header-civ font-body text-xs";
  hint.textContent = "(hidden — click to show)";
  text.appendChild(hint);

  return col;
}
