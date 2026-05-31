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
import { safePlaySound } from "/demographics/ui/demographics-audio.js";

/**
 * A civ "profile": the latest non-empty value of each identity field folded
 * across the whole history, plus the latest numeric value of each metric.
 * @typedef {Object} CivProfile
 * @property {string} pid Player id (as a string key).
 * @property {string} leaderKey Stable key (leader type or `"pid:<id>"`).
 * @property {string|undefined} leaderName Most recent non-empty leader name.
 * @property {string|undefined} civName Most recent non-empty civ name.
 * @property {string[]} civNames All distinct civ names seen, in first-seen order.
 * @property {string|undefined} leaderTypeString Engine LeaderType string.
 * @property {string|undefined} civTypeString Engine CivilizationType string.
 * @property {string|undefined} primaryColor Civ primary color (hex/css).
 * @property {string|undefined} secondaryColor Civ secondary color (hex/css).
 * @property {boolean} [met] Whether the local player has met this civ.
 * @property {Record<string, number>} latest Latest numeric value per metric id.
 */

/**
 * Persisted-setting accessor surface read off the render context.
 * @typedef {Object} FactbookSettings
 * @property {(key: string, fallback?: *) => *} [getSetting] Read a setting.
 * @property {(key: string, value: *) => void} [setSetting] Write a setting.
 */

/**
 * Render context handed to {@link render}.
 * @typedef {Object} FactbookCtx
 * @property {DemoHistory} [history] The full persisted history blob.
 * @property {FactbookSettings} [settings] Persisted-setting accessor.
 */

/**
 * Per-civ-header click affordance options.
 * @typedef {Object} HeaderOpts
 * @property {boolean} [visible] Whether the civ is currently visible.
 * @property {() => void} [onToggle] Toggle this civ's hidden state.
 */

/**
 * Label-column options (reset affordance).
 * @typedef {Object} LabelColumnOpts
 * @property {number} [hiddenCount] Count of currently hidden civs.
 * @property {() => void} [onReset] Clear all hidden civs.
 */

/**
 * Ranking result for a single metric across all civs.
 * @typedef {Object} RankResult
 * @property {Map<string, number>} ranks Map of pid → 1-based rank (ties share).
 * @property {number} total Count of civs with a numeric value.
 */

const DBG = false;
/**
 * Debug logger, no-op unless {@link DBG} is set.
 * @param {...*} a Values to log.
 * @returns {void}
 */
function dlog(...a) {
  if (DBG) console.warn("[Demographics.view-factbook]", ...a);
}

/**
 * Invoke `fn` and return its result, or `fb` if it throws.
 * @template T
 * @param {() => T} fn Thunk to evaluate.
 * @param {T} [fb] Fallback returned on throw.
 * @returns {T|undefined} `fn()` result, or `fb`.
 */
function safeCall(fn, fb) {
  try {
    return fn();
  } catch (_) {
    return fb;
  }
}

/**
 * Resolve the local player id from the engine `GameContext`, defensively.
 * @returns {number|undefined} Local player (or observer) id, if numeric.
 */
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

/**
 * Create a fresh, empty {@link CivProfile} for a player id.
 * @param {string} pid Player id (string key).
 * @param {CivSample} ps The first per-civ sample seen for this pid.
 * @returns {CivProfile} A blank profile seeded with the stable leader key.
 */
function makeBlankProfile(pid, ps) {
  return {
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

/**
 * Fold one per-civ sample's numeric metrics into a profile's `latest` map,
 * keeping every finite value.
 * @param {CivProfile} profile Profile to mutate.
 * @param {Record<string, *>} metrics Per-metric values from the sample.
 * @returns {void}
 */
function mergeProfileMetrics(profile, metrics) {
  for (const k of Object.keys(metrics)) {
    const v = metrics[k];
    if (typeof v === "number" && isFinite(v)) profile.latest[k] = v;
  }
}

/**
 * Return `v` when it is a non-empty string, otherwise `undefined`. Mirrors the
 * `typeof x === "string" && x.length > 0` guard used across the sample fold.
 * @param {*} v Candidate value.
 * @returns {string|undefined} The string if non-empty, else `undefined`.
 */
function nonEmptyString(v) {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Fold one sample's leader-name and civ-name identity fields into a profile,
 * tracking distinct civ names in first-seen order.
 * @param {CivProfile} profile Profile to mutate.
 * @param {CivSample} ps One civ's sample.
 * @returns {void}
 */
function mergeCivNames(profile, ps) {
  const leaderName = nonEmptyString(ps?.leaderName);
  if (leaderName) profile.leaderName = leaderName;
  const civName = nonEmptyString(ps?.civName);
  if (civName) {
    profile.civName = civName;
    const arr = profile.civNames;
    if (!arr.includes(civName)) arr.push(civName);
  }
}

/**
 * Fold one sample's engine type strings and civ colors into a profile.
 * @param {CivProfile} profile Profile to mutate.
 * @param {CivSample} ps One civ's sample.
 * @returns {void}
 */
function mergeCivTypesAndColors(profile, ps) {
  const leaderTypeString = nonEmptyString(ps?.leaderTypeString);
  if (leaderTypeString) profile.leaderTypeString = leaderTypeString;
  const civTypeString = nonEmptyString(ps?.civTypeString);
  if (civTypeString) profile.civTypeString = civTypeString;
  const primaryColor = nonEmptyString(ps?.primaryColor);
  if (primaryColor) profile.primaryColor = primaryColor;
  const secondaryColor = nonEmptyString(ps?.secondaryColor);
  if (secondaryColor) profile.secondaryColor = secondaryColor;
}

/**
 * Fold one per-civ sample over an existing profile, overwriting each identity
 * field only when the newer sample carries a non-empty value.
 * @param {CivProfile} profile Profile to mutate.
 * @param {CivSample} ps One civ's sample.
 * @returns {void}
 */
function mergeCivSample(profile, ps) {
  mergeCivNames(profile, ps);
  mergeCivTypesAndColors(profile, ps);
  if (typeof ps?.met === "boolean") profile.met = ps.met;
  mergeProfileMetrics(profile, ps?.metrics || {});
}

/**
 * Build a `{ pid -> profile }` map by folding every newer non-empty field over
 * the older one across the full history.
 * @param {DemoHistory|undefined} history The persisted history blob.
 * @returns {Record<string, CivProfile>} Profiles keyed by player id.
 */
function buildCivProfiles(history) {
  /** @type {Record<string, CivProfile>} */
  const profiles = {};
  const samples = history?.samples || [];
  for (const s of samples) {
    if (!s?.players) continue;
    for (const pid of Object.keys(s.players)) {
      const ps = s.players[pid];
      if (!profiles[pid]) profiles[pid] = makeBlankProfile(pid, ps);
      mergeCivSample(profiles[pid], ps);
    }
  }
  return profiles;
}

/**
 * Compute a `Map<pid, rank>` over all civs that have a numeric value for
 * `metricId`. Ranks are 1-based and ties share a rank.
 * @param {Record<string, CivProfile>} profiles All civ profiles.
 * @param {string} metricId Metric id to rank by.
 * @returns {RankResult} The rank map and the count of ranked civs.
 */
function computeRanks(profiles, metricId) {
  /** @type {{ pid: string, v: number }[]} */
  const entries = [];
  for (const pid of Object.keys(profiles)) {
    const v = profiles[pid].latest?.[metricId];
    if (typeof v === "number" && isFinite(v)) entries.push({ pid, v });
  }
  entries.sort((a, b) => b.v - a.v);
  const ranks = new Map();
  /** @type {number|undefined} */
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

/**
 * Build the leader-avatar element: a real `<fxs-icon>` portrait when the
 * profile carries a `LEADER_*` type, otherwise an initial-letter placeholder.
 * @param {CivProfile} profile Source civ profile.
 * @param {number} sizeRem Avatar edge length, in rem.
 * @returns {HTMLElement} The avatar wrapper element.
 */
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

/**
 * Append the leader / civ / "formerly" text rows to a civ-header text block.
 * @param {HTMLElement} text The header text container to append into.
 * @param {CivProfile} profile Source civ profile.
 * @param {boolean} maskAsUnmet When true, emit generic unmet placeholders.
 * @returns {void}
 */
function buildCivHeaderText(text, profile, maskAsUnmet) {
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
}

/**
 * Build a civ-column header div (avatar + leader + civ + formerly suffix).
 * `maskAsUnmet` (Fix 4): when true, replace leader/civ names with generic
 * "Unmet Leader" / "Unmet Civilization" placeholders and suppress the
 * formerly suffix. Avatar falls back to its built-in placeholder (no
 * LeaderType lookup).
 * @param {CivProfile} profile Source civ profile.
 * @param {boolean} isLocal Whether this is the local player's column.
 * @param {boolean} maskAsUnmet When true, mask names as generic placeholders.
 * @param {HeaderOpts} [_opts] Click affordance options (unused here).
 * @returns {HTMLElement} The civ-header element.
 */
function buildCivHeader(profile, isLocal, maskAsUnmet, _opts) {
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

  buildCivHeaderText(text, profile, maskAsUnmet);

  return wrap;
}

/**
 * Build a single value cell (value on top; the rank row is appended by the
 * caller).
 * @param {MetricDef} metric The metric definition for this row.
 * @param {CivProfile} profile Source civ profile.
 * @returns {HTMLElement} The value-cell element.
 */
function buildValueCell(metric, profile) {
  const cell = document.createElement("div");
  cell.className = "demographics-factbook-cell demographics-factbook-value-cell";

  const v = profile.latest?.[metric.id];
  const value = document.createElement("div");
  value.className = "demographics-factbook-cell-value font-body text-sm";
  if (typeof v === "number" && isFinite(v)) {
    try {
      value.textContent = /** @type {(n: number) => string} */ (metric.format)(v);
    } catch (_) {
      value.textContent = String(Math.round(v));
    }
  } else {
    value.textContent = "—";
  }
  cell.appendChild(value);

  return cell;
}

/**
 * Build the small rank line shown under a value cell.
 * @param {number|undefined} rank 1-based rank, or undefined for no rank.
 * @param {number} total Count of ranked civs (denominator).
 * @returns {HTMLElement} The rank-line element.
 */
function buildRankCell(rank, total) {
  const cell = document.createElement("div");
  cell.className = "demographics-factbook-cell-rank font-body text-xs";
  cell.textContent = typeof rank === "number" ? "Rank " + rank + "/" + total : "";
  return cell;
}

/**
 * Build the metric-label column (column 1), including the optional corner
 * "Reset (N hidden)" affordance.
 * @param {LabelColumnOpts} [opts] Reset affordance options.
 * @returns {HTMLElement} The label-column element.
 */
function buildLabelColumn(opts) {
  const col = document.createElement("div");
  col.className = "demographics-factbook-col demographics-factbook-col-labels";

  const header = document.createElement("div");
  header.className = "demographics-factbook-cell demographics-factbook-corner";
  if (opts && (opts.hiddenCount ?? 0) > 0 && typeof opts.onReset === "function") {
    const btn = document.createElement("div");
    btn.className = "demographics-factbook-reset-btn font-body text-xs";
    btn.textContent = "Reset (" + opts.hiddenCount + " hidden)";
    btn.title = "Show all hidden civilizations";
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      safePlaySound("data-audio-activate", "options");
      opts.onReset?.();
    });
    header.appendChild(btn);
  }
  col.appendChild(header);

  let rowIdx = 0;
  for (const m of /** @type {MetricDef[]} */ (METRICS).filter((x) => !x.factbookHidden)) {
    const row = document.createElement("div");
    row.className = "demographics-factbook-cell demographics-factbook-label-cell font-body text-sm";
    if (rowIdx > 0 && rowIdx % 4 === 0) row.classList.add("is-heavy-divider");
    row.textContent = m.label;
    col.appendChild(row);
    rowIdx++;
  }
  return col;
}

/**
 * Build a civ column: header on top, one value+rank cell per metric below.
 * @param {CivProfile} profile This column's civ profile.
 * @param {Record<string, CivProfile>} profiles All profiles (for ranking).
 * @param {boolean} isLocal Whether this is the local player's column.
 * @param {boolean} maskAsUnmet When true, mask the header as unmet.
 * @param {HeaderOpts} [opts] Click affordance options.
 * @returns {HTMLElement} The civ-column element.
 */
function buildCivColumn(profile, profiles, isLocal, maskAsUnmet, opts) {
  const col = document.createElement("div");
  col.className = "demographics-factbook-col demographics-factbook-col-civ";
  if (isLocal) col.classList.add("is-local");

  col.appendChild(buildCivHeader(profile, isLocal, maskAsUnmet, opts));

  let rowIdx = 0;
  for (const m of /** @type {MetricDef[]} */ (METRICS).filter((x) => !x.factbookHidden)) {
    const { ranks, total } = computeRanks(profiles, m.id);
    const cell = buildValueCell(m, profile);
    if (rowIdx > 0 && rowIdx % 4 === 0) cell.classList.add("is-heavy-divider");
    cell.appendChild(buildRankCell(ranks.get(profile.pid), total));
    col.appendChild(cell);
    rowIdx++;
  }
  return col;
}

/**
 * Read a boolean persisted setting defensively, returning `fallback` on any
 * error.
 * @param {FactbookCtx} ctx Render context.
 * @param {string} key Setting key.
 * @param {boolean} fallback Value used when reading throws or is unavailable.
 * @returns {boolean} The coerced setting value.
 */
function readBoolSetting(ctx, key, fallback) {
  try {
    return !!ctx.settings?.getSetting?.(key, fallback);
  } catch (_) {
    return fallback;
  }
}

/**
 * Strip eliminated civs from the profile map in place. The eliminated map
 * comes from `history.eliminated`, populated by the sampler at civ death.
 * @param {Record<string, CivProfile>} profiles Profiles to filter (mutated).
 * @param {DemoHistory|undefined} history Source history blob.
 * @returns {void}
 */
function stripEliminatedCivs(profiles, history) {
  const elim =
    history && history.eliminated && typeof history.eliminated === "object"
      ? history.eliminated
      : {};
  for (const pid of Object.keys(profiles)) {
    if (elim[pid] || elim[Number(pid)]) {
      delete profiles[pid];
    }
  }
}

/**
 * Append the "no samples yet" empty-state notice to the host.
 * @param {HTMLElement} host The view host element.
 * @returns {void}
 */
function appendEmptyState(host) {
  const empty = document.createElement("div");
  empty.className = "demographics-empty font-body text-base";
  empty.textContent = "No samples yet — play a turn and reopen.";
  host.appendChild(empty);
}

/**
 * Pick the local player's pid: the resolved engine id when it has a profile,
 * otherwise the first available pid.
 * @param {Record<string, CivProfile>} profiles All profiles.
 * @param {string[]} allPids All profile pids.
 * @returns {string} The local-column pid.
 */
function pickLocalPid(profiles, allPids) {
  const localId = getLocalId();
  return typeof localId === "number" && profiles[String(localId)] ? String(localId) : allPids[0];
}

/**
 * Order the non-local pids by leader name (locale-aware), falling back to the
 * pid string when a leader name is absent.
 * @param {Record<string, CivProfile>} profiles All profiles.
 * @param {string[]} allPids All profile pids.
 * @param {string} localPid The local-column pid to exclude.
 * @returns {string[]} The sorted non-local pids.
 */
function sortOtherPids(profiles, allPids, localPid) {
  return allPids
    .filter((p) => p !== localPid)
    .sort((a, b) => {
      const na = profiles[a].leaderName || a;
      const nb = profiles[b].leaderName || b;
      return na.localeCompare(nb);
    });
}

/**
 * Build the click-to-hide affordance hint shown above the matrix. Without it
 * the interaction is invisible to first-time users; a subtle italic one-liner
 * reads as guidance rather than chrome.
 * @returns {HTMLElement} The hint element.
 */
function buildHint() {
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
  return hint;
}

/**
 * Slim "ghost" column shown for hidden civs — just a narrow header with the
 * leader name (or unmet placeholder), no metric cells. Lets the user see who's
 * hidden and click to bring them back. The visible civs flex to fill the
 * remaining space (per the CSS `.demographics-factbook-col { flex: 1 0 9rem }`).
 * @param {CivProfile} profile This civ's profile.
 * @param {boolean} maskAsUnmet When true, show the generic unmet placeholder.
 * @param {HeaderOpts} [_opts] Click affordance options (unused here).
 * @returns {HTMLElement} The ghost-column element.
 */
function buildGhostCivColumn(profile, maskAsUnmet, _opts) {
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

/**
 * Mutable state backing the interactive strip, threaded through the
 * module-scope render/toggle helpers.
 * @typedef {Object} StripState
 * @property {HTMLElement} strip The strip container to populate.
 * @property {Record<string, CivProfile>} profiles All civ profiles.
 * @property {string} localPid The local-column pid.
 * @property {string[]} otherPids Sorted non-local pids.
 * @property {FactbookCtx} ctx Render context.
 * @property {boolean} showUnmetNames When false, unmet civs are masked.
 * @property {Set<string>} hiddenCivs The currently hidden pid set.
 */

/**
 * Controller exposing the strip's re-render entry point.
 * @typedef {Object} StripController
 * @property {() => void} render Re-render the strip into its container.
 */

/**
 * Whether `pid` should be masked as unmet. Defensive: only mask when `met` is
 * EXPLICITLY false.
 * @param {StripState} st The strip state.
 * @param {string} pid Player id to test.
 * @returns {boolean} True when the civ should be masked.
 */
function stripIsUnmet(st, pid) {
  if (st.showUnmetNames) return false;
  if (pid === st.localPid) return false;
  const p = st.profiles[pid];
  return !!(p && p.met === false);
}

/**
 * Read the persisted hidden-civ set, defensively, into a string `Set`.
 * @param {FactbookCtx} ctx Render context.
 * @returns {Set<string>} The persisted hidden pids (empty on any error).
 */
function readHiddenCivs(ctx) {
  try {
    const raw = ctx.settings?.getSetting?.("factbookHiddenCivs", []);
    if (Array.isArray(raw)) return new Set(raw.map((v) => String(v)));
  } catch (_) {
    /* */
  }
  return new Set();
}

/**
 * Persist the current hidden-civ set, defensively.
 * @param {StripState} st The strip state.
 * @returns {void}
 */
function saveHiddenCivs(st) {
  try {
    st.ctx.settings?.setSetting?.("factbookHiddenCivs", Array.from(st.hiddenCivs));
  } catch (_) {
    /* */
  }
}

/**
 * Toggle one civ's hidden state, persist, and re-render the strip.
 * @param {StripState} st The strip state.
 * @param {string} pid Player id to toggle.
 * @returns {void}
 */
function toggleCiv(st, pid) {
  const k = String(pid);
  if (st.hiddenCivs.has(k)) st.hiddenCivs.delete(k);
  else st.hiddenCivs.add(k);
  saveHiddenCivs(st);
  renderStrip(st);
}

/**
 * Clear all hidden civs, persist, and re-render the strip.
 * @param {StripState} st The strip state.
 * @returns {void}
 */
function resetHidden(st) {
  st.hiddenCivs.clear();
  saveHiddenCivs(st);
  renderStrip(st);
}

/**
 * Build one non-local civ column (ghost or full) and wire its header click.
 * @param {StripState} st The strip state.
 * @param {string} pid Player id for the column.
 * @returns {HTMLElement} The column element.
 */
function buildOtherColumn(st, pid) {
  const isHidden = st.hiddenCivs.has(String(pid));
  const headerOpts = {
    visible: !isHidden,
    onToggle: () => toggleCiv(st, pid)
  };
  const col = isHidden
    ? buildGhostCivColumn(st.profiles[pid], stripIsUnmet(st, pid), headerOpts)
    : buildCivColumn(st.profiles[pid], st.profiles, false, stripIsUnmet(st, pid), headerOpts);
  const header = /** @type {HTMLElement|null} */ (
    col.querySelector(".demographics-factbook-civ-header")
  );
  if (header) {
    header.style.cursor = "pointer";
    header.title = isHidden ? "Click to show" : "Click to hide";
    header.addEventListener("click", () => {
      safePlaySound("data-audio-checkbox-press", "audio-screen-unlocks");
      dlog("factbook header click pid=" + pid, "wasHidden=" + isHidden);
      toggleCiv(st, pid);
    });
  }
  return col;
}

/**
 * Append the label column (1) and sticky local-player column (2) to the strip.
 * @param {StripState} st The strip state.
 * @returns {void}
 */
function appendStickyColumns(st) {
  // Column 1: metric labels (sticky-left).
  const labelCol = buildLabelColumn({
    hiddenCount: st.hiddenCivs.size,
    onReset: () => resetHidden(st)
  });
  labelCol.classList.add("demographics-factbook-col-sticky");
  st.strip.appendChild(labelCol);

  // Column 2: local player (sticky-left, never hidable).
  const localCol = buildCivColumn(st.profiles[st.localPid], st.profiles, true, false);
  localCol.classList.add("demographics-factbook-col-sticky-2");
  st.strip.appendChild(localCol);
}

/**
 * Re-render the full strip: label column, local column, then visible and
 * hidden (ghost) civ columns. Visible columns stay adjacent to the local
 * column to make comparisons easier; hidden ones are pushed to the far right.
 * @param {StripState} st The strip state.
 * @returns {void}
 */
function renderStrip(st) {
  while (st.strip.firstChild) st.strip.removeChild(st.strip.firstChild);

  appendStickyColumns(st);

  // Columns 3+: visible civs first (preserve sort), then any hidden
  // ones pushed to the far right as thin "ghost" columns.
  const visiblePids = [];
  const hiddenPids = [];
  for (const pid of st.otherPids) {
    if (st.hiddenCivs.has(String(pid))) hiddenPids.push(pid);
    else visiblePids.push(pid);
  }
  const ordered = visiblePids.concat(hiddenPids);
  for (const pid of ordered) {
    st.strip.appendChild(buildOtherColumn(st, pid));
  }
}

/**
 * Mount the interactive factbook strip and return a controller exposing its
 * re-render entry point. Owns the per-civ visibility set, which persists in
 * `modSettings.demographics.factbookHiddenCivs` as an array of pid strings;
 * the local player is never hidden.
 * @param {HTMLElement} strip The strip container to populate.
 * @param {Record<string, CivProfile>} profiles All civ profiles.
 * @param {string} localPid The local-column pid.
 * @param {string[]} otherPids Sorted non-local pids.
 * @param {FactbookCtx} ctx Render context.
 * @param {boolean} showUnmetNames When false, unmet civs are masked.
 * @returns {StripController} The mounted strip controller.
 */
function mountFactbookStrip(strip, profiles, localPid, otherPids, ctx, showUnmetNames) {
  /** @type {StripState} */
  const st = {
    strip,
    profiles,
    localPid,
    otherPids,
    ctx,
    showUnmetNames,
    hiddenCivs: readHiddenCivs(ctx)
  };
  renderStrip(st);
  return { render: () => renderStrip(st) };
}

/**
 * Render the World Factbook matrix into `host`. Clears the host, folds the
 * history into per-civ profiles, applies the `showEliminatedCivs` /
 * `showUnmetNames` settings, then mounts the interactive strip.
 * @param {HTMLElement} host The view host element (cleared and repopulated).
 * @param {FactbookCtx} ctx Render context (history + settings accessors).
 * @returns {void}
 */
export function render(host, ctx) {
  while (host.firstChild) host.removeChild(host.firstChild);

  const profiles = buildCivProfiles(ctx.history);
  // Apply `showEliminatedCivs` option (default true). When disabled,
  // strip eliminated civs from the factbook profile list so only living
  // civs appear in the matrix.
  const showEliminatedCivs = readBoolSetting(ctx, "showEliminatedCivs", true);
  if (!showEliminatedCivs) {
    stripEliminatedCivs(profiles, ctx.history);
  }
  const allPids = Object.keys(profiles);
  if (allPids.length === 0) {
    appendEmptyState(host);
    return;
  }

  const localPid = pickLocalPid(profiles, allPids);
  const otherPids = sortOtherPids(profiles, allPids, localPid);

  // Read "show unmet names" setting (Fix 4). When false, mask unmet civs.
  const showUnmetNames = readBoolSetting(ctx, "showUnmetNames", false);

  dlog("rendering factbook; local=", localPid, "others=", otherPids.length);

  host.appendChild(buildHint());

  // Scroll container (horizontal scroll).
  const scrollWrap = document.createElement("div");
  scrollWrap.className = "demographics-factbook-matrix";
  host.appendChild(scrollWrap);

  const strip = document.createElement("div");
  strip.className = "demographics-factbook-strip";
  scrollWrap.appendChild(strip);

  mountFactbookStrip(strip, profiles, localPid, otherPids, ctx, showUnmetNames);
}
