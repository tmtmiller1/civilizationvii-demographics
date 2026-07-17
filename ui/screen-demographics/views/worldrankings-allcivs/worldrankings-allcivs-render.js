import { t, tPlayerFallback } from "/demographics/ui/core/demographics-i18n.js";
import { orderedNames } from "/demographics/ui/core/player-label.js";
import {
  METRICS,
  EXTERNAL_METRIC_GROUPS,
  localizedMetricName
} from "/demographics/ui/metrics/demographics-metrics.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";
import { iconEl } from "/demographics/ui/core/ui-helpers.js";

import { computeRanks } from "/demographics/ui/screen-demographics/views/worldrankings-allcivs/worldrankings-allcivs-profiles.js";

// ── Scaled / Civ number mode ──────────────────────────────────────────────────
// Several metrics come in a matched pair: a scaled-"people" version (the visible
// row) and a raw Civ-numbers twin (registered but hidden), e.g. Population
// (population ↔ population_civ) and every Emigration flow (emig_out_cum ↔
// emig_out_cum_pts). Rather than render both as duplicate rows, the All
// Civilizations matrix shows ONE row per pair and a single Scaled/Civ toggle
// swaps which side every paired row displays — the same toggle pattern the
// history tab uses. The mode is a module-level flag set by the view before it
// (re)builds the strip, so the label column and every civ column read the same
// swapped metric list and stay aligned.
const NUMBER_MODES = ["scaled", "civ"];
let _numberMode = "scaled";

/**
 * Set the active Scaled/Civ number mode for the matrix. Call before rebuilding.
 * @param {string} mode "scaled" or "civ".
 */
export function setMatrixNumberMode(mode) {
  _numberMode = NUMBER_MODES.includes(mode) ? mode : "scaled";
}

/**
 * Add a 2D metric group's scaled→civ member pairs into `map`, when the group
 * exposes both a "scaled" and a "civ" view.
 * @param {Map<string, string>} map Accumulator (mutated).
 * @param {*} g A registered metric group.
 */
function addGroupPairs(map, g) {
  if (!Array.isArray(g.members) || !Array.isArray(g.views)) return;
  const viewIds = g.views.map((/** @type {*} */ v) => v && v.id);
  if (!viewIds.includes("scaled") || !viewIds.includes("civ")) return;
  for (const m of g.members) addMemberPair(map, m);
}

/**
 * Record one group member's scaled→civ id pair (when both are distinct strings).
 * @param {Map<string, string>} map Accumulator (mutated).
 * @param {*} m A group member ({scaled, civ, ...}).
 */
function addMemberPair(map, m) {
  const s = m && m.scaled;
  const c = m && m.civ;
  if (typeof s === "string" && typeof c === "string" && s !== c) map.set(s, c);
}

/**
 * Map every scaled metric id to its raw-Civ-numbers twin id. Seeded with the base
 * Population pair and extended from any registered 2D metric group that exposes
 * scaled/civ views (e.g. the Emigration Migration graphs), so companions get the
 * toggle for free.
 * @returns {Map<string, string>} scaled id → civ id.
 */
function scaledToCivPairs() {
  const map = new Map([["population", "population_civ"]]);
  for (const g of EXTERNAL_METRIC_GROUPS) addGroupPairs(map, g);
  return map;
}

/**
 * True when at least one visible metric has a Civ-numbers twin (so the Scaled/Civ
 * toggle is meaningful). The base Population pair guarantees this in practice.
 * @returns {boolean} Whether the number-mode toggle should be offered.
 */
export function matrixHasNumberModePairs() {
  const pairs = scaledToCivPairs();
  return METRICS.some((m) => !m.worldRankingsAllCivsHidden && pairs.has(m.id));
}

/**
 * The metrics shown in the All Civilizations views (non-hidden), in order. In
 * "civ" mode each scaled metric that has a Civ-numbers twin is swapped for that
 * twin, so the row shows Civ values/ranks under the same (shared) label.
 * @returns {*[]} The shown metric definitions.
 */
function shownMetrics() {
  const base = /** @type {*[]} */ (METRICS).filter((m) => !m.worldRankingsAllCivsHidden);
  if (_numberMode !== "civ") return base;
  const pairs = scaledToCivPairs();
  return base.map((m) => {
    const civId = pairs.get(m.id);
    if (!civId) return m;
    const civ = METRICS.find((x) => x.id === civId);
    return civ || m;
  });
}

/** @typedef {import("./worldrankings-allcivs-profiles.js").CivProfile} CivProfile */

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
 * Error logger (always emits).
 * @param {...*} a Values to log.
 */
function derr(...a) {
  console.error("[Demographics.view-worldrankings-allcivs]", ...a);
}

/**
 * Build the leader-avatar element: a real `<fxs-icon>` portrait when the
 * profile carries a `LEADER_*` type, otherwise an initial-letter placeholder.
 * @param {CivProfile} profile Source civ profile.
 * @param {number} sizeRem Avatar edge length, in rem.
 * @returns {HTMLElement} The avatar wrapper element.
 */
export function buildLeaderAvatar(profile, sizeRem) {
  const wrap = document.createElement("div");
  wrap.className = "demographics-worldrankings-allcivs-avatar";
  // Edge length is the caller-supplied dynamic size; flex-shrink:0 lives in
  // the .demographics-worldrankings-allcivs-avatar rule.
  wrap.style.width = sizeRem + "rem";
  wrap.style.height = sizeRem + "rem";

  const leaderType = profile.leaderTypeString;
  try {
    if (isLeaderPortraitType(leaderType)) {
      wrap.appendChild(buildLeaderPortrait(leaderType));
      return wrap;
    }
  } catch (e) {
    // Own-logic DOM build (fxs-icon portrait) - surface failures, then fall
    // through to the initial-letter placeholder below.
    derr("buildLeaderAvatar:", e);
  }

  const placeholder = document.createElement("div");
  placeholder.className = "demographics-worldrankings-allcivs-avatar-placeholder";
  const initial = (profile.leaderName || "?").trim().charAt(0).toUpperCase() || "?";
  placeholder.textContent = initial;
  wrap.appendChild(placeholder);
  return wrap;
}

/**
 * Check whether a leader type can resolve to a real portrait icon.
 * @param {*} leaderType Candidate leader type.
 * @returns {leaderType is string} True when the type looks like `LEADER_*`.
 */
function isLeaderPortraitType(leaderType) {
  return !!(leaderType && typeof leaderType === "string" && /^LEADER_/.test(leaderType));
}

/**
 * Build one leader portrait icon element.
 * @param {string} leaderType Leader type string.
 * @returns {HTMLElement} Portrait element.
 */
function buildLeaderPortrait(leaderType) {
  const portrait = document.createElement("fxs-icon");
  portrait.setAttribute("data-icon-id", leaderType);
  portrait.setAttribute("data-icon-context", "LEADER");
  portrait.classList.add("demographics-worldrankings-allcivs-portrait");
  return portrait;
}

/**
 * Append the leader / civ / "formerly" text rows to a civ-header text block.
 * @param {HTMLElement} text The header text container to append into.
 * @param {CivProfile} profile Source civ profile.
 * @param {boolean} maskAsUnmet When true, emit generic unmet placeholders.
 */
export function buildCivHeaderText(text, profile, maskAsUnmet) {
  // Civilization-primary, leader-secondary (player feedback). The prominent
  // "-civ-header-leader" class now carries the CIV name and the smaller
  // "-civ-header-civ" carries the leader beneath it; class names (and their
  // density/font-size CSS) are kept unchanged, only the text is swapped.
  const primary = document.createElement("div");
  primary.className = "demographics-worldrankings-allcivs-civ-header-leader font-title text-base";
  primary.textContent = maskAsUnmet
    ? t("LOC_DEMOGRAPHICS_UNMET_CIV")
    : orderedNames(profile.leaderName, profile.civName)[0] ||
      tPlayerFallback(profile.pid);
  text.appendChild(primary);

  if (maskAsUnmet) {
    const leader = document.createElement("div");
    leader.className = "demographics-worldrankings-allcivs-civ-header-civ font-body text-sm";
    leader.textContent = t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_UNMET_LEADER");
    text.appendChild(leader);
  } else {
    appendCivNameRows(text, profile);
  }
}

/**
 * Append the secondary leader row + "formerly" civ-history row for a met civ
 * header (the civ name is the primary line above, added by buildCivHeaderText).
 * @param {HTMLElement} text Header text container.
 * @param {CivProfile} profile Source civ profile.
 */
function appendCivNameRows(text, profile) {
  // Secondary line: the leader. Only when a distinct civ name sits above it, so a
  // civ-less profile (primary already fell back to the leader) isn't repeated.
  if (profile.civName && profile.leaderName) {
    const leader = document.createElement("div");
    leader.className = "demographics-worldrankings-allcivs-civ-header-civ font-body text-sm";
    leader.textContent = orderedNames(profile.leaderName, profile.civName)[1];
    text.appendChild(leader);
  }

  const all = Array.isArray(profile.civNames) ? profile.civNames : [];
  const prior = all.filter((n) => n && n !== profile.civName);
  if (prior.length <= 0) return;
  const fmr = document.createElement("div");
  fmr.className = "demographics-worldrankings-allcivs-civ-header-formerly font-body text-xs";
  fmr.textContent = t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_FORMERLY", prior.join(", "));
  text.appendChild(fmr);
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
export function buildCivHeader(profile, isLocal, maskAsUnmet, _opts) {
  const wrap = document.createElement("div");
  wrap.className = "demographics-worldrankings-allcivs-cell demographics-worldrankings-allcivs-civ-header";
  if (isLocal) wrap.classList.add("is-local");
  if (maskAsUnmet) wrap.classList.add("is-unmet");
  // Civ-color accent to match the Cities tab's color-accented cards.
  if (profile.primaryColor && !maskAsUnmet) {
    wrap.style.setProperty("border-top-color", profile.primaryColor);
  }

  // For unmet civs, force the avatar's placeholder rather than the actual
  // leader portrait - build a shallow profile clone with leaderTypeString
  // stripped so buildLeaderAvatar takes the fallback path.
  const avatarProfile = maskAsUnmet
    ? Object.assign({}, profile, { leaderTypeString: undefined, leaderName: "?" })
    : profile;
  const avatar = buildLeaderAvatar(avatarProfile, isLocal ? 4 : 3);
  if (profile.primaryColor && !maskAsUnmet) avatar.style.borderColor = profile.primaryColor;
  wrap.appendChild(avatar);

  const text = document.createElement("div");
  text.className = "demographics-worldrankings-allcivs-civ-header-text";
  wrap.appendChild(text);

  buildCivHeaderText(text, profile, maskAsUnmet);

  return wrap;
}

// Yield/category icon per metric id (when the metric maps to a recognizable
// yield), so the value line can show "(<icon> 55)". Metrics without an entry
// just show "(55)".
/** @type {Record<string, string>} */
export const METRIC_ICONS = {
  score: "blp:popup_laurels",
  gold: "blp:Yield_Gold",
  gpt: "blp:Yield_Gold",
  gdp: "blp:Yield_Gold",
  settlements: "blp:Yield_Cities",
  settlement_cap_pct: "blp:Yield_Cities",
  techs: "blp:Yield_Science",
  civics: "blp:Yield_Culture",
  crops: "blp:Yield_Food",
  production: "blp:Yield_Production",
  science_yield: "blp:Yield_Science",
  culture_yield: "blp:Yield_Culture",
  approval: "blp:bonustype_diplomatic",
  hpt: "blp:Yield_Happiness",
  population: "blp:Yield_Population",
  // Civ-numbers twin of population (shown when the Scaled/Civ toggle is on Civ),
  // so the Population row keeps its icon in both modes.
  population_civ: "blp:Yield_Population",
  influence: "blp:yield_influence",
  deals: "blp:bonustype_diplomatic",
  trade: "blp:bonus_economic",
  milpower: "blp:bonus_militaristic",
  wonders: "blp:fonticon_wonders"
};

/**
 * Format a metric's latest value to a display string (defensive).
 * @param {MetricDef} metric The metric definition.
 * @param {*} v The raw value.
 * @returns {string} The formatted value, or "—".
 */
export function formatMetricValue(metric, v) {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  try {
    return /** @type {(n: number) => string} */ (metric.format)(v);
  } catch (e) {
    // A metric's format() callback threw - surface it, then fall back to a
    // rounded integer so the cell still shows a value.
    derr("formatMetricValue(" + metric.id + "):", e);
    return String(Math.round(v));
  }
}

/**
 * Build the small value line: "(<icon> value)" in the (former rank) small style.
 * A missing value shows a bare "—" (no parens/icon).
 * @param {MetricDef} metric The metric definition.
 * @param {CivProfile} profile Source civ profile.
 * @returns {HTMLElement} The value line.
 */
function buildValueLine(metric, profile) {
  const line = document.createElement("div");
  line.className = "demographics-worldrankings-allcivs-cell-rank font-body text-sm";
  const formatted = formatMetricValue(metric, profile.latest?.[metric.id]);
  if (formatted === "—") {
    line.textContent = "—";
    return line;
  }
  // Flex row of explicit spans + a sized icon item. Coherent will NOT keep a
  // background-image div inline among raw text nodes (it block-breaks, which made
  // "(", icon and "value)" stack and blew up cell height), so each piece is a
  // discrete flex child and the row is nowrap - see the matching CSS. The icon
  // sits INSIDE the parens.
  const blp = METRIC_ICONS[metric.id];
  const open = document.createElement("span");
  open.textContent = blp ? "(" : "(" + formatted + ")";
  line.appendChild(open);
  if (blp) {
    line.appendChild(iconEl(blp, "demographics-worldrankings-allcivs-yield-icon"));
    const val = document.createElement("span");
    val.textContent = formatted + ")";
    line.appendChild(val);
  }
  return line;
}

/**
 * Build a single metric cell, RANK-FORWARD: the bare rank number is the big
 * headline (the column context makes "rank" obvious - no "Rank" word, no /total
 * fraction) and the yield value is the small "(<icon> value)" line below.
 * @param {MetricDef} metric The metric definition for this row.
 * @param {CivProfile} profile Source civ profile.
 * @param {number|undefined} rank 1-based rank, or undefined.
 * @returns {HTMLElement} The cell element.
 */
export function buildValueCell(metric, profile, rank) {
  const cell = document.createElement("div");
  cell.className = "demographics-worldrankings-allcivs-cell demographics-worldrankings-allcivs-value-cell";

  const rankLine = document.createElement("div");
  rankLine.className = "demographics-worldrankings-allcivs-cell-value font-body text-lg";
  rankLine.textContent = typeof rank === "number" ? String(rank) : "—";
  cell.appendChild(rankLine);

  cell.appendChild(buildValueLine(metric, profile));
  return cell;
}

/**
 * Build the metric-label column (column 1), including the optional corner
 * "Reset (N hidden)" affordance.
 * @param {LabelColumnOpts} [opts] Reset affordance options.
 * @returns {HTMLElement} The label-column element.
 */
export function buildLabelColumn(opts) {
  const col = document.createElement("div");
  col.className = "demographics-worldrankings-allcivs-col demographics-worldrankings-allcivs-col-labels";

  const header = document.createElement("div");
  header.className = "demographics-worldrankings-allcivs-cell demographics-worldrankings-allcivs-corner";
  // Header label for the grid: every cell's prominent number is a world rank, so
  // the column header reads "Rank" (matching the rank column on the other tabs).
  const rankLabel = document.createElement("div");
  rankLabel.className = "demographics-worldrankings-allcivs-corner-label font-title text-sm";
  rankLabel.textContent = t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_RANK");
  header.appendChild(rankLabel);
  const resetBtn = buildLabelResetButton(opts);
  if (resetBtn) header.appendChild(resetBtn);
  col.appendChild(header);
  appendMetricLabelRows(col);
  return col;
}

/**
 * Build the label-column reset button when hidden civs exist.
 * @param {LabelColumnOpts|undefined} opts Reset options.
 * @returns {HTMLElement|null} Reset button, or null when not needed.
 */
function buildLabelResetButton(opts) {
  if (!(opts && (opts.hiddenCount ?? 0) > 0 && typeof opts.onReset === "function")) {
    return null;
  }
  const btn = document.createElement("div");
  btn.className = "demographics-worldrankings-allcivs-reset-btn font-body text-xs";
  btn.textContent = t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_RESET", opts.hiddenCount);
  btn.title = t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_RESET_TOOLTIP");
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    safePlaySound("data-audio-activate", "options");
    opts.onReset?.();
  });
  return btn;
}

/**
 * Append all metric label rows to the label column.
 * @param {HTMLElement} col The label column element.
 */
function appendMetricLabelRows(col) {
  let rowIdx = 0;
  for (const m of shownMetrics()) {
    const row = document.createElement("div");
    row.className =
      "demographics-worldrankings-allcivs-cell demographics-worldrankings-allcivs-label-cell font-body text-base";
    if (rowIdx > 0 && rowIdx % 4 === 0) row.classList.add("is-heavy-divider");
    // Icon (when we have one for this metric) + name, so the row headings read at a
    // glance. The text carries the font-fit; the icon is a fixed-size leading glyph.
    const icon = METRIC_ICONS[m.id];
    if (icon) row.appendChild(iconEl(icon, "demographics-worldrankings-allcivs-metric-icon"));
    const label = document.createElement("span");
    label.className = "demographics-worldrankings-allcivs-metric-label-text";
    label.textContent = localizedMetricName(m);
    row.appendChild(label);
    col.appendChild(row);
    rowIdx++;
  }
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
export function buildCivColumn(profile, profiles, isLocal, maskAsUnmet, opts) {
  const col = document.createElement("div");
  col.className = "demographics-worldrankings-allcivs-col demographics-worldrankings-allcivs-col-civ";
  if (isLocal) col.classList.add("is-local");

  col.appendChild(buildCivHeader(profile, isLocal, maskAsUnmet, opts));

  let rowIdx = 0;
  for (const m of shownMetrics()) {
    const { ranks } = computeRanks(profiles, m.id);
    const cell = buildValueCell(m, profile, ranks.get(profile.pid));
    if (rowIdx > 0 && rowIdx % 4 === 0) cell.classList.add("is-heavy-divider");
    col.appendChild(cell);
    rowIdx++;
  }
  return col;
}

/**
 * Build the click-to-hide affordance hint shown above the matrix. Without it
 * the interaction is invisible to first-time users; a subtle italic one-liner
 * reads as guidance rather than chrome.
 * @returns {HTMLElement} The hint element.
 */
export function buildHint() {
  const hint = document.createElement("div");
  hint.className = "demographics-worldrankings-allcivs-hint font-body text-xs";
  const hintIcon = document.createElement("div");
  hintIcon.className = "demographics-worldrankings-allcivs-hint-icon";
  const hintText = document.createElement("span");
  hintText.textContent = t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_HINT");
  hint.appendChild(hintIcon);
  hint.appendChild(hintText);
  return hint;
}

/**
 * Slim "ghost" column shown for hidden civs - just a narrow header with the
 * leader name (or unmet placeholder), no metric cells. Lets the user see who's
 * hidden and click to bring them back. The visible civs flex to fill the
 * remaining space (per the CSS `.demographics-worldrankings-allcivs-col { flex: 1 0 9rem }`).
 * @param {CivProfile} profile This civ's profile.
 * @param {boolean} maskAsUnmet When true, show the generic unmet placeholder.
 * @param {HeaderOpts} [_opts] Click affordance options (unused here).
 * @returns {HTMLElement} The ghost-column element.
 */
export function buildGhostCivColumn(profile, maskAsUnmet, _opts) {
  const col = document.createElement("div");
  col.className = "demographics-worldrankings-allcivs-col demographics-worldrankings-allcivs-col-civ is-hidden";

  const wrap = document.createElement("div");
  wrap.className = "demographics-worldrankings-allcivs-cell demographics-worldrankings-allcivs-civ-header is-ghost";
  col.appendChild(wrap);

  const text = document.createElement("div");
  text.className = "demographics-worldrankings-allcivs-civ-header-text";
  wrap.appendChild(text);

  // Civilization-primary (see buildCivHeaderText): the ghost's prominent line is
  // the civ name so a hidden civ reads by civ, consistent with the live headers.
  const primary = document.createElement("div");
  primary.className = "demographics-worldrankings-allcivs-civ-header-leader font-title text-xs";
  primary.textContent = maskAsUnmet
    ? t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_UNMET_SHORT")
    : profile.civName || profile.leaderName || tPlayerFallback(profile.pid);
  text.appendChild(primary);

  const hint = document.createElement("div");
  hint.className = "demographics-worldrankings-allcivs-civ-header-civ font-body text-sm";
  hint.textContent = t("LOC_DEMOGRAPHICS_WORLDRANKINGS_ALLCIVS_HIDDEN_CLICK");
  text.appendChild(hint);

  return col;
}

/**
 * Append the "no samples yet" empty-state notice to the host.
 * @param {HTMLElement} host The view host element.
 */
export function appendEmptyState(host) {
  const empty = document.createElement("div");
  empty.className = "demographics-empty font-body text-base";
  empty.textContent = t("LOC_DEMOGRAPHICS_EMPTY_NO_SAMPLES");
  host.appendChild(empty);
}
