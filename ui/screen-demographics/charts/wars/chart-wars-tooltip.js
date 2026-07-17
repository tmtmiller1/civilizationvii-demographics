// chart-wars-tooltip.js
//
// The war-timeline hover tooltip CONTENT: the structured tooltip body, the
// per-side cost columns, and the full city-state (suzerain) layout. Extracted
// from chart-conflicts-timeline.js so the gantt module is just rendering + wiring; this
// module owns what the tooltip shows. renderWarTooltip() fills the tooltip
// element the gantt creates.

import {
  COST_METRICS,
  buildCostIcon,
  participantCost,
  formatCostFigure,
  participantMilPower,
  participantMilPowerLost,
  warWindow,
  warAgeScope,
  costMetricTitle
} from "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-cost.js";
import {
  buildCostTable,
  buildVsCell
} from "/demographics/ui/screen-demographics/charts/wars/chart-wars-cost-table.js";
import {
  majorsOnSide,
  warDurationYears
} from "/demographics/ui/screen-demographics/charts/wars/chart-wars-naming.js";
import {
  resolveCsType,
  csTypeMeta
} from "/demographics/ui/screen-demographics/views/relations/relations-edges.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";

/**
 * Build the structured tooltip body for a war.
 * @param {*} w The war record.
 * @param {Object} ctx Shared Gantt context.
 * @param {Map<*, string>} ctx.nameOverride war → display label.
 * @param {Map<number, string>} ctx.turnYearMap chart-turn → year map.
 * @param {number} ctx.latestTurn The latest sampled turn.
 * @param {Snapshot[]} ctx.samples The sample stream.
 * @returns {Record<string, *>} The tooltip body fields.
 */
function buildWarTooltipBody(w, ctx) {
  const { nameOverride, turnYearMap, latestTurn, samples } = ctx;
  // Age-scope the sample stream to the war's age so cost windowing (age-local turns) can't
  // pull in same-numbered turns from other ages; ageLastTurn bounds an ongoing war correctly.
  const { scoped, ageLastTurn } = warAgeScope(samples, w);
  const sTurn = w.startTurn;
  const eTurn = typeof w.endTurn === "number" ? w.endTurn : ageLastTurn;
  const startYr = w.startYear || "T-" + sTurn;
  const endYr =
    typeof w.endTurn === "number" ? w.endYear || "T-" + eTurn : t("LOC_DEMOGRAPHICS_WARS_ONGOING");
  const yrs = warDurationYears(w, turnYearMap, latestTurn);
  const turns = eTurn - sTurn;
  const declared = warDeclaredBy(w);
  return {
    // Use the World War override when 4+ civs are involved; fall back to the
    // bilateral name otherwise.
    title: nameOverride.get(w) || w.name,
    ongoing: typeof w.endTurn !== "number",
    status:
      typeof w.endTurn === "number"
        ? t("LOC_DEMOGRAPHICS_WARS_STATUS_CONCLUDED")
        : t("LOC_DEMOGRAPHICS_WARS_STATUS_ONGOING"),
    sideA: majorsOnSide(w.sideACivs),
    sideB: majorsOnSide(w.sideBCivs),
    // City-state / independent allies on each side (the entries majorsOnSide
    // drops), for the tooltip's "City State Allies" sections + the allied totals.
    csA: csOnSide(w.sideACivs),
    csB: csOnSide(w.sideBCivs),
    declared,
    startYr,
    endYr,
    yrs,
    turns,
    warStart: typeof sTurn === "number" ? sTurn : 0,
    warEnd: eTurn,
    // Age-scoped sample stream for the cost windowing below (warWindow/participantCost).
    scoped
  };
}

/**
 * Filter a war-side roster to its city-state / independent (non-major) entries.
 * @param {*[]} roster A war side's roster.
 * @returns {*[]} The city-state entries.
 */
function csOnSide(roster) {
  return (roster || []).filter((r) => r && r.isCS);
}

/**
 * Sum a side's city-state allies' Military Power and Military Power lost over the
 * war window (nulls treated as 0), for the allied-total parentheticals.
 * @param {*[]} csList The side's city-state entries.
 * @param {Snapshot[]} win The war-window samples.
 * @returns {{ power: number, lost: number }} The summed CS power + power lost.
 */
function csSideTotals(csList, win) {
  let power = 0;
  let lost = 0;
  for (const cs of csList) {
    power += participantMilPower(win, cs.pid, true) || 0;
    lost += participantMilPowerLost(win, cs.pid, true) || 0;
  }
  return { power, lost };
}

/**
 * The "declared by" line for a war (its major declarer, else "unknown").
 * @param {*} w The war record.
 * @returns {string} The declarer label.
 */
function warDeclaredBy(w) {
  if (!w.declaredBy || w.declaredBy.isCS) return t("LOC_DEMOGRAPHICS_WARS_DECLARED_UNKNOWN");
  return w.declaredBy.leader ? w.declaredBy.leader + ", " + w.declaredBy.civ : w.declaredBy.civ;
}

/**
 * Render the tooltip DOM for a war into the shared tooltip element.
 * @param {HTMLElement} tooltip The tooltip element (cleared and repopulated).
 * @param {*} w The war record.
 * @param {*} ctx Shared Gantt context (see {@link buildWarTooltipBody}).
 */
export function renderWarTooltip(tooltip, w, ctx) {
  const tip = buildWarTooltipBody(w, ctx);
  const samples = ctx.samples || [];
  while (tooltip.firstChild) tooltip.removeChild(tooltip.firstChild);

  tooltip.appendChild(buildTooltipHead(tip));

  const declared = document.createElement("div");
  declared.className = "demographics-wars-tooltip-declared";
  declared.textContent = t("LOC_DEMOGRAPHICS_WARS_DECLARED_BY", tip.declared);
  tooltip.appendChild(declared);

  // One column per leader (allies grouped by side, split by "vs"); each column
  // carries the leader's portrait + name, then its cost metrics stacked.
  appendDivider(tooltip);
  const costHead = document.createElement("div");
  costHead.className = "demographics-wars-tooltip-cost-header";
  costHead.textContent =
    t("LOC_DEMOGRAPHICS_WARS_COST_HEADER") + " " + t("LOC_DEMOGRAPHICS_WARS_COST_OBSERVED");
  tooltip.appendChild(costHead);

  const win = warWindow(tip.scoped, tip.warStart, tip.warEnd);
  tooltip.appendChild(buildSidesEl(tip, samples, win));

  appendCsAllies(tooltip, tip, samples, win);

  // Sign key , explains the green/red/dash figure convention right where the
  // figures are (replaces the old Guide tab's intro/legend note).
  appendDivider(tooltip);
  tooltip.appendChild(buildTooltipKey());
}

/** The three sign-key entries (color class + sign glyph + label). */
const SIGN_KEY_ITEMS = [
  { cls: "is-gain", sign: "+", label: "LOC_DEMOGRAPHICS_WARS_KEY_GAIN" },
  { cls: "is-loss", sign: "−", label: "LOC_DEMOGRAPHICS_WARS_KEY_LOSS" },
  { cls: "is-none", sign: "—", label: "LOC_DEMOGRAPHICS_WARS_KEY_NODATA" }
];

/**
 * Append one sign-key entry (an optional separator, the colored sign glyph, and
 * its label) to the key row.
 * @param {HTMLElement} key The key row element.
 * @param {{ cls: string, sign: string, label: string }} it The key entry.
 * @param {boolean} withSep Whether to prepend a "·" separator.
 */
function appendKeyItem(key, it, withSep) {
  if (withSep) {
    const sep = document.createElement("span");
    sep.className = "demographics-wars-tooltip-key-sep";
    sep.textContent = "·";
    key.appendChild(sep);
  }
  const sign = document.createElement("span");
  sign.className = "demographics-wars-tooltip-leader-val " + it.cls;
  sign.textContent = it.sign;
  key.appendChild(sign);
  const lbl = document.createElement("span");
  lbl.className = "demographics-wars-tooltip-key-label";
  lbl.textContent = t(it.label);
  key.appendChild(lbl);
}

/**
 * Build the compact sign-key footer: "+ gain · − loss ·, no data", each sign in
 * the same color the cost figures use.
 * @returns {HTMLElement} The key element.
 */
function buildTooltipKey() {
  const key = document.createElement("div");
  key.className = "demographics-wars-tooltip-key";
  SIGN_KEY_ITEMS.forEach((it, i) => appendKeyItem(key, it, i > 0));
  return key;
}

/**
 * Build the centered tooltip header (title + timeline subtitle + status pill).
 * @param {*} tip The tooltip body model.
 * @returns {HTMLElement} The header element.
 */
function buildTooltipHead(tip) {
  const head = document.createElement("div");
  head.className = "demographics-wars-tooltip-head";
  const title = document.createElement("div");
  title.className = "demographics-wars-tooltip-title";
  title.textContent = tip.title;
  head.appendChild(title);
  const sub = document.createElement("div");
  sub.className = "demographics-wars-tooltip-subtitle";
  sub.textContent =
    tip.startYr + " → " + tip.endYr + " · " + t("LOC_DEMOGRAPHICS_WARS_DURATION_TURNS", tip.turns);
  head.appendChild(sub);
  const pill = document.createElement("span");
  pill.className =
    "demographics-wars-tooltip-status " + (tip.ongoing ? "is-ongoing" : "is-concluded");
  pill.textContent = tip.status;
  head.appendChild(pill);
  return head;
}

/**
 * Append the city-state allies table (own divider + header) when present. CS
 * allies get their own table below the majors, same column-with-labels layout.
 * @param {HTMLElement} tooltip The tooltip element.
 * @param {*} tip The tooltip body model.
 * @param {Snapshot[]} samples The sample stream.
 * @param {Snapshot[]} win The war-window samples.
 */
function appendCsAllies(tooltip, tip, samples, win) {
  const csTable = buildCSTable(tip, samples, win);
  if (!csTable) return;
  appendDivider(tooltip);
  const csHead = document.createElement("div");
  csHead.className = "demographics-wars-tooltip-cost-header";
  csHead.textContent = t("LOC_DEMOGRAPHICS_WARS_CS_ALLIES");
  tooltip.appendChild(csHead);
  tooltip.appendChild(csTable);
}

/**
 * Append one side's MAJOR-civ columns. City-states go in a separate table below
 * (see buildCSTable); each major still carries its side's CS totals so its
 * Military Power rows can show the allied-total parenthetical.
 * @param {*[]} cols The accumulating columns.
 * @param {*[]} majors The side's major entries.
 * @param {*[]} csList The side's city-state entries (for the parenthetical total).
 * @param {{ win: Snapshot[], tip: * }} ctx War-window samples and the tooltip body (which
 *   carries the age-scoped sample stream for participant cost).
 */
function pushSideCols(cols, majors, csList, ctx) {
  const { win, tip } = ctx;
  const csTotals = csList.length ? csSideTotals(csList, win) : null;
  for (const entry of majors) {
    cols.push({
      entry,
      cs: csTotals,
      cost: participantCost(tip.scoped, entry, tip.warStart, tip.warEnd)
    });
  }
}

/**
 * A city-state's current suzerain pid (live), via player.Influence.getSuzerain();
 * -1 when it has no suzerain or the lookup throws.
 * @param {*} pid The city-state pid.
 * @returns {number} The suzerain pid, or -1.
 */
function liveSuzerain(pid) {
  try {
    const p = typeof Players !== "undefined" && Players.get ? Players.get(Number(pid)) : null;
    const inf = p && p.Influence;
    const suz = inf && typeof inf.getSuzerain === "function" ? inf.getSuzerain() : -1;
    return typeof suz === "number" ? suz : -1;
  } catch (_) {
    return -1;
  }
}

/**
 * Group a side's city-state allies under their suzerain major (so each CS lands
 * in the same column as the major who suzerains it). A CS whose live suzerain
 * isn't one of this side's majors falls back to the side's lead major.
 * @param {*[]} majors The side's major entries.
 * @param {*[]} csList The side's city-state entries.
 * @returns {Map<number, *[]>} Major pid -> its city-state entries.
 */
function groupCSBySuzerain(majors, csList) {
  /** @type {Map<number, *[]>} */
  const map = new Map();
  for (const m of majors) map.set(Number(m.pid), []);
  if (!majors.length) return map;
  const fallback = Number(majors[0].pid);
  for (const cs of csList) {
    const suz = liveSuzerain(cs.pid);
    const key = map.has(suz) ? suz : fallback;
    const bucket = map.get(key);
    if (bucket) bucket.push(cs);
  }
  return map;
}

/**
 * Resolve a city-state's real display name: Locale.compose(player.name) (the
 * proper independent-power name, e.g. "Carthage"), not its generic civilization
 * name ("Village"). Falls back to the roster civ, then a placeholder.
 * @param {*} ally The ally entry ({ pid, civ }).
 * @returns {string} The display name.
 */
function csDisplayName(ally) {
  try {
    return csLiveName(ally.pid) || ally.civ || t("LOC_DEMOGRAPHICS_CITY_STATE") + " " + ally.pid;
  } catch (_) {
    // Players.get()/Locale.compose() can throw mid age-transition; fall back.
    return ally.civ || t("LOC_DEMOGRAPHICS_CITY_STATE") + " " + ally.pid;
  }
}

/**
 * The live Locale-composed independent-power name for a pid, or null.
 * @param {*} pid The city-state pid.
 * @returns {string|null} The composed name, or null.
 */
function csLiveName(pid) {
  const p = typeof Players !== "undefined" && Players.get ? Players.get(Number(pid)) : null;
  if (!p || !p.name) return null;
  if (typeof Locale === "undefined" || typeof Locale.compose !== "function") return null;
  const composed = Locale.compose(p.name);
  return typeof composed === "string" && composed.length > 0 ? composed : null;
}

/**
 * Resolve a city-state's type icon (the same banner glyph the Global Relations
 * city-states screen uses: militaristic/cultural/economic/scientific/etc.), or
 * null when the type is unknown.
 * @param {*} ally The ally entry ({ pid }).
 * @returns {string|null} The `blp:` icon path, or null.
 */
function csTypeIconOf(ally) {
  const meta = csTypeMeta(resolveCsType(Number(ally.pid)));
  return meta ? meta.icon : null;
}

/**
 * Build the per-side columns table: side A's columns, a "vs", then side B's.
 * @param {*} tip The tooltip body (see {@link buildWarTooltipBody}).
 * @param {Snapshot[]} samples The sample stream.
 * @param {Snapshot[]} win The war-window samples.
 * @returns {HTMLElement} The sides element.
 */
function buildSidesEl(tip, samples, win) {
  /** @type {*[]} */
  const cols = [];
  const sideCtx = { samples, win, tip };
  pushSideCols(cols, tip.sideA, tip.csA, sideCtx);
  const aCount = cols.length;
  pushSideCols(cols, tip.sideB, tip.csB, sideCtx);
  const vsAt = aCount > 0 && cols.length > aCount ? aCount : -1;
  return buildCostTable(cols, COST_METRICS, samples, vsAt);
}

/**
 * Build the city-states table shown below the majors. It mirrors the majors'
 * columns (side A's majors, a "vs", then side B's), and under each major column
 * stacks that major's suzerained city-states as rows - so every city-state sits
 * in the SAME column as its suzerain. Empty cells fill the shorter columns.
 * Returns null when neither side has city-state allies.
 * @param {*} tip The tooltip body (see {@link buildWarTooltipBody}).
 * @param {Snapshot[]} samples The sample stream (unused; kept for symmetry).
 * @param {Snapshot[]} win The war-window samples.
 * @returns {HTMLElement|null} The CS table, or null if there are no allies.
 */
function buildCSTable(tip, samples, win) {
  if (!tip.csA.length && !tip.csB.length) return null;
  const { cols, vsAt } = csSuzerainColumns(tip);
  const maxRows = cols.reduce((mx, c) => Math.max(mx, c.css.length), 0);
  if (!maxRows) return null;
  const table = document.createElement("div");
  table.className = "demographics-wars-tooltip-table";
  for (let i = 0; i < maxRows; i++) table.appendChild(buildCSRow(cols, vsAt, i, win));
  return table;
}

/**
 * Build the city-states table's columns: one per major (mirroring the majors
 * table's order + "vs" position), each carrying that major's suzerained allies.
 * @param {*} tip The tooltip body.
 * @returns {{ cols: { entry: *, css: *[] }[], vsAt: number }} Columns + vs index.
 */
function csSuzerainColumns(tip) {
  const grpA = groupCSBySuzerain(tip.sideA, tip.csA);
  const grpB = groupCSBySuzerain(tip.sideB, tip.csB);
  /** @type {{ entry: *, css: *[] }[]} */
  const cols = [];
  for (const m of tip.sideA) cols.push({ entry: m, css: grpA.get(Number(m.pid)) || [] });
  const aCount = cols.length;
  for (const m of tip.sideB) cols.push({ entry: m, css: grpB.get(Number(m.pid)) || [] });
  const vsAt = aCount > 0 && cols.length > aCount ? aCount : -1;
  return { cols, vsAt };
}

/**
 * Build one row of the city-states table: an empty label spacer (to align with
 * the majors' label column), then each major column's i-th city-state cell.
 * @param {{ entry: *, css: *[] }[]} cols The major columns + their CS lists.
 * @param {number} vsAt The column index the "vs" spacer precedes (-1 for none).
 * @param {number} i The row (ally) index.
 * @param {Snapshot[]} win The war-window samples.
 * @returns {HTMLElement} The row element.
 */
function buildCSRow(cols, vsAt, i, win) {
  const row = document.createElement("div");
  row.className = "demographics-wars-tooltip-trow";
  row.appendChild(buildCSLabelCell());
  cols.forEach((c, ci) => {
    if (ci === vsAt) row.appendChild(buildVsCell(""));
    row.appendChild(buildCSAllyCell(c.css[i], win));
  });
  return row;
}

/** The two military metrics shown for each city-state ally (Current + Lost). */
function csMetrics() {
  return COST_METRICS.filter((m) => m.id === "milpowerLevel" || m.id === "milpower");
}

/**
 * Build a city-state row's label cell: an empty spacer aligned with the ally's
 * name line, then the Military Power (Current) / (Lost) labels aligned with that
 * ally's two stacked value lines - matching the major metric-row labels.
 * @returns {HTMLElement} The label cell.
 */
function buildCSLabelCell() {
  const cell = document.createElement("div");
  cell.className = "demographics-wars-tooltip-tlabel demographics-wars-tooltip-cs-label";
  const spacer = document.createElement("div");
  spacer.className = "demographics-wars-tooltip-cs-ally-name";
  cell.appendChild(spacer);
  for (const m of csMetrics()) {
    const lbl = document.createElement("div");
    lbl.className = "demographics-wars-tooltip-cs-ally-val";
    lbl.textContent = costMetricTitle(m);
    cell.appendChild(lbl);
  }
  return cell;
}

/**
 * Build one city-state ally cell: its type icon + real name, then its Military
 * Power (Current) and Military Power (Lost) figures stacked. An absent ally (a
 * column with fewer allies than this row index) yields an empty spacer cell.
 * @param {*} cs The city-state entry, or undefined.
 * @param {Snapshot[]} win The war-window samples.
 * @returns {HTMLElement} The cell element.
 */
function buildCSAllyCell(cs, win) {
  const cell = document.createElement("div");
  cell.className = "demographics-wars-tooltip-tcell demographics-wars-tooltip-cs-cell";
  if (!cs) return cell;
  cell.appendChild(buildCSAllyName(cs));
  cell.appendChild(buildCSStat(participantMilPower(win, cs.pid, true), "level"));
  cell.appendChild(buildCSStat(participantMilPowerLost(win, cs.pid, true), "losses"));
  return cell;
}

/**
 * Build a city-state ally's name row: its type icon (or colored dot) + name.
 * @param {*} cs The city-state entry.
 * @returns {HTMLElement} The name-row element.
 */
function buildCSAllyName(cs) {
  const name = document.createElement("div");
  name.className = "demographics-wars-tooltip-cs-ally-name";
  const icon = csTypeIconOf(cs);
  if (icon) {
    name.appendChild(buildCostIcon(icon));
  } else {
    const dot = document.createElement("span");
    dot.className = "demographics-wars-tooltip-dot";
    if (cs.color) dot.style.backgroundColor = cs.color;
    name.appendChild(dot);
  }
  const txt = document.createElement("span");
  txt.textContent = csDisplayName(cs);
  name.appendChild(txt);
  return name;
}

/**
 * Build one stacked city-state stat figure (Military Power current / lost).
 * @param {number|null} val The figure.
 * @param {string} mode The format mode ("level" / "losses").
 * @returns {HTMLElement} The figure element.
 */
function buildCSStat(val, mode) {
  const fig = formatCostFigure(val, mode);
  const el = document.createElement("div");
  el.className = "demographics-wars-tooltip-cs-ally-val demographics-wars-tooltip-leader-val " + fig.cls;
  el.textContent = fig.text;
  return el;
}


/**
 * Append a thin horizontal divider to the tooltip.
 * @param {HTMLElement} tooltip The tooltip element.
 */
function appendDivider(tooltip) {
  const d = document.createElement("div");
  d.className = "demographics-wars-tooltip-divider";
  tooltip.appendChild(d);
}
