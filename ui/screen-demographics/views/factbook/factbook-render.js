import { t } from "/demographics/ui/core/demographics-i18n.js";
import { METRICS } from "/demographics/ui/metrics/demographics-metrics.js";
import { safePlaySound } from "/demographics/ui/core/demographics-audio.js";

import { computeRanks } from "/demographics/ui/screen-demographics/views/factbook/factbook-profiles.js";

/**
 * @typedef {import("/demographics/ui/screen-demographics/views/factbook/factbook-profiles.js").
 *   CivProfile} CivProfile
 */

/**
 * @typedef {import("/demographics/ui/screen-demographics/views/factbook/factbook-profiles.js").
 *   FactbookCtx} FactbookCtx
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
 * Error logger (always emits).
 * @param {...*} a Values to log.
 */
function derr(...a) {
  console.error("[Demographics.view-factbook]", ...a);
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
  wrap.className = "demographics-factbook-avatar";
  // Edge length is the caller-supplied dynamic size; flex-shrink:0 lives in
  // the .demographics-factbook-avatar rule.
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
  placeholder.className = "demographics-factbook-avatar-placeholder";
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
  portrait.classList.add("demographics-factbook-portrait");
  return portrait;
}

/**
 * Append the leader / civ / "formerly" text rows to a civ-header text block.
 * @param {HTMLElement} text The header text container to append into.
 * @param {CivProfile} profile Source civ profile.
 * @param {boolean} maskAsUnmet When true, emit generic unmet placeholders.
 */
export function buildCivHeaderText(text, profile, maskAsUnmet) {
  const leader = document.createElement("div");
  leader.className = "demographics-factbook-civ-header-leader font-title text-sm";
  leader.textContent = maskAsUnmet
    ? t("LOC_DEMOGRAPHICS_FACTBOOK_UNMET_LEADER")
    : profile.leaderName || t("LOC_DEMOGRAPHICS_PLAYER_FALLBACK", profile.pid);
  text.appendChild(leader);

  if (maskAsUnmet) {
    const civ = document.createElement("div");
    civ.className = "demographics-factbook-civ-header-civ font-body text-xs";
    civ.textContent = t("LOC_DEMOGRAPHICS_UNMET_CIV");
    text.appendChild(civ);
  } else if (profile.civName) {
    appendCivNameRows(text, profile);
  }
}

/**
 * Append civ-name + formerly rows for a met civ header.
 * @param {HTMLElement} text Header text container.
 * @param {CivProfile} profile Source civ profile.
 */
function appendCivNameRows(text, profile) {
  const civ = document.createElement("div");
  civ.className = "demographics-factbook-civ-header-civ font-body text-xs";
  civ.textContent = profile.civName || "";
  text.appendChild(civ);

  const all = Array.isArray(profile.civNames) ? profile.civNames : [];
  const prior = all.filter((n) => n && n !== profile.civName);
  if (prior.length <= 0) return;
  const fmr = document.createElement("div");
  fmr.className = "demographics-factbook-civ-header-formerly font-body text-xs";
  fmr.textContent = t("LOC_DEMOGRAPHICS_FACTBOOK_FORMERLY", prior.join(", "));
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
  wrap.className = "demographics-factbook-cell demographics-factbook-civ-header";
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
export function buildValueCell(metric, profile) {
  const cell = document.createElement("div");
  cell.className = "demographics-factbook-cell demographics-factbook-value-cell";

  const v = profile.latest?.[metric.id];
  const value = document.createElement("div");
  value.className = "demographics-factbook-cell-value font-body text-sm";
  if (typeof v === "number" && isFinite(v)) {
    try {
      value.textContent = /** @type {(n: number) => string} */ (metric.format)(v);
    } catch (e) {
      // Own-logic: a metric's format() callback threw - surface it, then fall
      // back to a rounded integer so the cell still shows a value.
      derr("buildValueCell format(" + metric.id + "):", e);
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
export function buildRankCell(rank, total) {
  const cell = document.createElement("div");
  cell.className = "demographics-factbook-cell-rank font-body text-xs";
  cell.textContent =
    typeof rank === "number"
      ? t("LOC_DEMOGRAPHICS_FACTBOOK_RANK_OF", rank, total)
      : "";
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
  col.className = "demographics-factbook-col demographics-factbook-col-labels";

  const header = document.createElement("div");
  header.className = "demographics-factbook-cell demographics-factbook-corner";
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
  btn.className = "demographics-factbook-reset-btn font-body text-xs";
  btn.textContent = t("LOC_DEMOGRAPHICS_FACTBOOK_RESET", opts.hiddenCount);
  btn.title = t("LOC_DEMOGRAPHICS_FACTBOOK_RESET_TOOLTIP");
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
  for (const m of /** @type {MetricDef[]} */ (METRICS).filter((x) => !x.factbookHidden)) {
    const row = document.createElement("div");
    row.className =
      "demographics-factbook-cell demographics-factbook-label-cell font-body text-sm";
    if (rowIdx > 0 && rowIdx % 4 === 0) row.classList.add("is-heavy-divider");
    row.textContent = m.label;
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
 * Build the click-to-hide affordance hint shown above the matrix. Without it
 * the interaction is invisible to first-time users; a subtle italic one-liner
 * reads as guidance rather than chrome.
 * @returns {HTMLElement} The hint element.
 */
export function buildHint() {
  const hint = document.createElement("div");
  hint.className = "demographics-factbook-hint font-body text-xs";
  const hintIcon = document.createElement("div");
  hintIcon.className = "demographics-factbook-hint-icon";
  const hintText = document.createElement("span");
  hintText.textContent = t("LOC_DEMOGRAPHICS_FACTBOOK_HINT");
  hint.appendChild(hintIcon);
  hint.appendChild(hintText);
  return hint;
}

/**
 * Slim "ghost" column shown for hidden civs - just a narrow header with the
 * leader name (or unmet placeholder), no metric cells. Lets the user see who's
 * hidden and click to bring them back. The visible civs flex to fill the
 * remaining space (per the CSS `.demographics-factbook-col { flex: 1 0 9rem }`).
 * @param {CivProfile} profile This civ's profile.
 * @param {boolean} maskAsUnmet When true, show the generic unmet placeholder.
 * @param {HeaderOpts} [_opts] Click affordance options (unused here).
 * @returns {HTMLElement} The ghost-column element.
 */
export function buildGhostCivColumn(profile, maskAsUnmet, _opts) {
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
  leader.textContent = maskAsUnmet
    ? t("LOC_DEMOGRAPHICS_FACTBOOK_UNMET_SHORT")
    : profile.leaderName || t("LOC_DEMOGRAPHICS_PLAYER_FALLBACK", profile.pid);
  text.appendChild(leader);

  const hint = document.createElement("div");
  hint.className = "demographics-factbook-civ-header-civ font-body text-xs";
  hint.textContent = t("LOC_DEMOGRAPHICS_FACTBOOK_HIDDEN_CLICK");
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
