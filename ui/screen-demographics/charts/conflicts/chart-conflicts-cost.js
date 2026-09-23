// chart-conflicts-cost.js
//
// The shared "war cost" unit for the Conflicts views: the COST_METRICS catalog,
// the series-reduction + formatting helpers that turn a participant's sampled
// metric series into a displayed figure, and the cost-metric icon builder.
// Each entry's `id` IS the snapshot.metrics key it reads, so the same catalog
// drives the Gantt tooltip figures and the War Graphs sub-tab.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { scaleCasualtiesAt } from "/demographics/ui/metrics/demographics-metrics-helpers.js";
import { findStartSample } from "/demographics/ui/sampler/sampler-wars-augment.js";
import { sampleAgeKey } from "/demographics/ui/screen-demographics/charts/crises/crisis-stage-data.js";

/**
 * Scope the full multi-age sample stream to just the war's age (recovered from its
 * global startChartTurn), so age-local turn windowing can't pull in same-numbered
 * turns from other ages. Also returns that age's last sampled turn.
 * @param {Snapshot[]} samples The full sample stream.
 * @param {*} war The war record (carries startChartTurn).
 * @returns {{scoped: Snapshot[], ageLastTurn: number}} Age-scoped samples + the age's last turn.
 */
export function warAgeScope(samples, war) {
  const all = Array.isArray(samples) ? samples : [];
  const start = war && typeof war.startChartTurn === "number" ? war.startChartTurn : Infinity;
  const warAge = sampleAgeKey(findStartSample(all, start));
  const scoped = all.filter((/** @type {*} */ s) => sampleAgeKey(s) === warAge);
  let ageLastTurn = 0;
  for (const s of scoped) {
    if (typeof s?.turn === "number" && s.turn > ageLastTurn) ageLastTurn = s.turn;
  }
  return { scoped, ageLastTurn };
}

/**
 * Descriptive display title per cost-metric id, shared by the tooltip and the
 * War Graphs tab. Ids missing here (deliberately, milpowerLevel) fall back to
 * the metric's short `label`; the graph overrides via {@link graphMetricTitle}.
 * @type {Record<string, string>}
 */
const GRAPH_TITLE = {
  milpower: "LOC_DEMOGRAPHICS_WAR_GRAPHS_T_STRENGTH",
  warProdCum: "LOC_DEMOGRAPHICS_WAR_GRAPHS_T_WARPROD",
  cityWarNetCum: "LOC_DEMOGRAPHICS_WAR_GRAPHS_T_SETTLEMENTS",
  razedCum: "LOC_DEMOGRAPHICS_WAR_GRAPHS_T_RAZED",
  warLandCum: "LOC_DEMOGRAPHICS_WAR_GRAPHS_T_LAND",
  populationRaw: "LOC_DEMOGRAPHICS_WAR_GRAPHS_T_POP",
  production: "LOC_DEMOGRAPHICS_WARS_COST_LBL_PRODLOST",
  crops: "LOC_DEMOGRAPHICS_WARS_COST_LBL_CROPLOST"
};

/**
 * The display title for a cost metric in the TOOLTIP (and the default elsewhere):
 * the shared descriptive title, else the metric's short label.
 * @param {{ id: string, label: string }} m A COST_METRICS entry.
 * @returns {string} The localized title.
 */
export function costMetricTitle(m) {
  return t(GRAPH_TITLE[m.id] || m.label);
}

/**
 * The display title for a metric on the WAR GRAPHS tab: same as the tooltip,
 * except standing Military Power reads "(Over Time)" there (a trajectory) vs
 * "(Current)" in the tooltip (a single end-of-war value).
 * @param {{ id: string, label: string }} m A COST_METRICS entry.
 * @returns {string} The localized title.
 */
export function graphMetricTitle(m) {
  if (m.id === "milpowerLevel") return t("LOC_DEMOGRAPHICS_WAR_GRAPHS_MILPOWER");
  return costMetricTitle(m);
}

/**
 * Format a positive magnitude with a K/M/B suffix.
 * @param {number} n The value.
 * @returns {string} The formatted value ("-" for non-finite/non-positive).
 */
export function formatMagnitude(n) {
  if (!isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

/**
 * Build one participant's metric series across the samples in a window.
 * @param {Snapshot[]} windowSamples Samples inside the participant's active window.
 * @param {Pid | string} pid The participant pid.
 * @param {string} metricId Metric key (e.g. "milpower").
 * @returns {number[]} The participant's values (samples lacking the value skipped).
 */
function participantMetricSeries(windowSamples, pid, metricId) {
  const series = [];
  for (const s of windowSamples) {
    const v = s?.players?.[pid]?.metrics?.[metricId];
    if (typeof v === "number" && isFinite(v)) series.push(v);
  }
  return series;
}

/**
 * Maximum drawdown of a series: the largest drop from a running peak. Returns 0
 * when the series only ever rises, so "losses" are never fabricated from growth.
 * @param {number[]} values The series.
 * @returns {number} The largest peak→trough decline.
 */
function maxDrawdown(values) {
  let peak = -Infinity;
  let maxDD = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak - v > maxDD) maxDD = peak - v;
  }
  return maxDD;
}

/**
 * Cumulative decline of a series: the sum of every turn-over-turn drop, so
 * repeated losses accumulate instead of collapsing to the single largest dip
 * ({@link maxDrawdown}). Rises are ignored, so growth never offsets a loss.
 * @param {number[]} values The series.
 * @returns {number} The summed magnitude of all declines (>= 0).
 */
function sumDeclines(values) {
  let total = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) total += values[i - 1] - values[i];
  }
  return total;
}

/**
 * One side's observed cost over a war window. Fields are null when the samples
 * don't cover the window (fewer than two data points).
 * @typedef {Object} SideWarCost
 * @property {number | null} milLost Combat strength lost: true casualties
 *   (increase in cumulative units-killed strength) over the window, or the
 *   standing-army decline proxy for pre-tracking saves.
 * @property {number | null} settlementsChange Net cities won/lost by capture
 *   (event-based; +captured / -lost; founding excluded; null pre-tracking).
 * @property {number | null} razed Settlements permanently razed (accrued; null
 *   for pre-tracking wars).
 * @property {number | null} landChange Net territory change in km² (signed: +gained / -ceded).
 * @property {number | null} popLost Gross population lost (sum of every
 *   per-turn decline; growth never masks it).
 * @property {number | null} cropLost Crop yield (food/turn) lost: sum of every
 *   per-turn decline.
 * @property {number | null} prodLost Production lost: sum of every per-turn
 *   drop in production-per-turn.
 * @property {number | null} warProd Production directed to war (military units
 *   + buildings), accrued over the window.
 */

/**
 * The metrics that make up a side's war cost: the result field each feeds, how
 * its series reduces to a figure (`"drawdown"` peak-to-trough loss, `"losses"`
 * sum of every decline, `"net"` signed end-start change, `"accrued"` increase of
 * a cumulative counter, `"spent"` the same shown as neutral spending), its `blp:`
 * texture, and a `glossary` LOC key rendered by the Conflicts "Guide" sub-tab.
 * @type {{
 *   id: string,
 *   key: string,
 *   mode: "drawdown" | "net" | "losses" | "accrued" | "spent" | "level",
 *   label: string,
 *   blp: string,
 *   glossary: string,
 *   series?: string
 * }[]}
 */
export const COST_METRICS = [
  {
    // Standing Military Power - a LEVEL, not a loss: the `milpower` series'
    // value at the end of the war window. Matches the War Graphs line.
    id: "milpowerLevel",
    key: "milPower",
    series: "milpower",
    mode: "level",
    label: "LOC_DEMOGRAPHICS_WARS_COST_LBL_MILPOWER",
    blp: "blp:fi_military_64",
    glossary: "LOC_DEMOGRAPHICS_WARS_GLOSSARY_MILPOWER"
  },
  {
    id: "milpower",
    key: "milLost",
    mode: "losses",
    label: "LOC_DEMOGRAPHICS_WARS_COST_LBL_STRENGTH",
    blp: "blp:fi_military_64",
    glossary: "LOC_DEMOGRAPHICS_WARS_GLOSSARY_STRENGTH"
  },
  {
    // Units LOST (body count): the increase in the cumulative unitsLostCum counter
    // over the war window. The tooltip appends a scaled "soldiers killed" estimate.
    id: "unitsLostCum",
    key: "unitsLost",
    mode: "accrued",
    label: "LOC_DEMOGRAPHICS_WARS_COST_LBL_UNITS_LOST",
    blp: "blp:fi_military_64",
    glossary: "LOC_DEMOGRAPHICS_WARS_GLOSSARY_UNITS_LOST"
  },
  {
    // Net cities won/lost by CAPTURE over the war (event-based cityWarNetCum: +1
    // to a captor, -1 to the prior owner). Net so a city that changes hands
    // several times settles to its real end state; founding never counts.
    id: "cityWarNetCum",
    key: "settlementsChange",
    mode: "net",
    label: "LOC_DEMOGRAPHICS_WARS_COST_LBL_SETTLEMENTS",
    blp: "blp:Yield_Towns",
    glossary: "LOC_DEMOGRAPHICS_WARS_GLOSSARY_SETTLEMENTS"
  },
  {
    // Settlements PERMANENTLY razed out from under this civ (attributed to the
    // pre-capture owner), distinct from captures that can be retaken. The figure
    // is the cumulative counter's increase over the war window.
    id: "razedCum",
    key: "razed",
    mode: "accrued",
    label: "LOC_DEMOGRAPHICS_WARS_COST_LBL_RAZED",
    blp: "blp:fi_plot_burning_64",
    glossary: "LOC_DEMOGRAPHICS_WARS_GLOSSARY_RAZED"
  },
  {
    // Territory (km2) that CHANGED HANDS through city capture (event-based
    // `warLandCum`), +gained / -ceded. Not the owned-tile total, whose swing
    // also includes peaceful settling and border growth.
    id: "warLandCum",
    key: "landChange",
    mode: "net",
    label: "LOC_DEMOGRAPHICS_WARS_COST_LBL_LAND",
    blp: "blp:fi_homeland_64",
    glossary: "LOC_DEMOGRAPHICS_WARS_GLOSSARY_LAND"
  },
  {
    // Gross population lost over the war: the sum of every per-turn decline.
    // Reads RAW population, not the line chart's scaled `population`, whose
    // turn factor inflates the series and masks real drops.
    id: "populationRaw",
    key: "popLost",
    mode: "losses",
    label: "LOC_DEMOGRAPHICS_WARS_COST_LBL_POP",
    blp: "blp:action_specialists",
    glossary: "LOC_DEMOGRAPHICS_WARS_GLOSSARY_POP"
  },
  {
    // Crop yield (net food/turn) LOST: sum of every per-turn drop in the food
    // rate (a disruption proxy, not a food total); growth can't mask the loss.
    id: "crops",
    key: "cropLost",
    mode: "losses",
    label: "LOC_DEMOGRAPHICS_WARS_COST_LBL_CROPLOST",
    blp: "blp:Yield_Food",
    glossary: "LOC_DEMOGRAPHICS_WARS_GLOSSARY_CROPLOST"
  },
  {
    // Production LOST: the sum of every per-turn drop in production-per-turn (a
    // disruption proxy, not a quantity total), so growth can't mask it.
    // Production directed to war is tracked separately (warProdCum).
    id: "production",
    key: "prodLost",
    mode: "losses",
    label: "LOC_DEMOGRAPHICS_WARS_COST_LBL_PRODLOST",
    blp: "blp:Yield_Production",
    glossary: "LOC_DEMOGRAPHICS_WARS_GLOSSARY_PRODLOST"
  },
  {
    // Production DIRECTED TO WAR: production spent on military units/buildings
    // during the war (cumulative `warProdCum`). Shown as neutral spending (mode
    // "spent"), not a red loss, since it is investment rather than destruction.
    id: "warProdCum",
    key: "warProd",
    mode: "spent",
    label: "LOC_DEMOGRAPHICS_WARS_COST_LBL_WARPROD",
    blp: "blp:Yield_Production",
    glossary: "LOC_DEMOGRAPHICS_WARS_GLOSSARY_WARPROD"
  },
  {
    // Refugees produced during the war , population displaced by siege, pillage, or
    // conquest , contributed per-civ by the Emigration mod (metrics.refugeesCum).
    // Accrued (cumulative); renders "— no data" when Emigration isn't installed.
    id: "refugeesCum",
    key: "refugees",
    mode: "accrued",
    label: "LOC_DEMOGRAPHICS_WARS_COST_LBL_REFUGEES",
    blp: "blp:action_specialists",
    glossary: "LOC_DEMOGRAPHICS_WARS_GLOSSARY_REFUGEES"
  }
];

/**
 * Build a cost-metric icon: a span whose background is a base-game texture via
 * the engine `url("blp:NAME")` scheme (the same our CSS uses elsewhere).
 * @param {string} blp A `blp:` texture name (e.g. "blp:Yield_Production").
 * @returns {HTMLElement} The icon element.
 */
export function buildCostIcon(blp) {
  const el = document.createElement("span");
  el.className = "demographics-wars-tooltip-cost-icon";
  el.style.backgroundImage = 'url("' + blp + '")';
  return el;
}

/**
 * Reduce a participant's metric series to its cost contribution.
 * @param {number[]} series The metric series over the participation window.
 * @param {"drawdown" | "net" | "losses"} mode Single largest dip, signed net
 *   change, or cumulative sum of all declines.
 * @returns {number | null} The contribution, or null when fewer than two points.
 */
function reduceCostSeries(series, mode) {
  if (series.length < 2) return null;
  if (mode === "net") return series[series.length - 1] - series[0];
  if (mode === "losses") return sumDeclines(series);
  return maxDrawdown(series);
}

/**
 * Increase of a cumulative (monotonic) event counter over the war window:
 * last - first. Returns null (rendered "-") when the metric isn't present in
 * at least two window samples.
 * @param {Snapshot[]} win The samples inside the participation window.
 * @param {Pid | string} pid The participant pid.
 * @param {string} metricId The cumulative metric id (e.g. "razedCum").
 * @returns {number | null} The accrued increase (>= 0), or null when no data.
 */
function accruedFigure(win, pid, metricId) {
  const cum = participantMetricSeries(win, pid, metricId);
  if (cum.length < 2) return null;
  return cum[cum.length - 1] - cum[0];
}

/**
 * Military strength lost for one participant over its war window: the increase
 * in the cumulative `milLostCum` casualty counter, falling back to the
 * standing-army decline proxy ({@link sumDeclines} of milpower) for samples
 * without casualty tracking.
 * @param {Snapshot[]} win The samples inside the participation window.
 * @param {Pid | string} pid The participant pid.
 * @returns {number | null} Strength lost (>= 0), or null when no data.
 */
function militaryLossFigure(win, pid) {
  const accrued = accruedFigure(win, pid, "milLostCum");
  if (accrued !== null) return accrued;
  return reduceCostSeries(participantMetricSeries(win, pid, "milpower"), "losses");
}

/**
 * Reduce one cost metric to its figure for a participant over its war window,
 * dispatching on the metric's mode: `milpower` is special-cased, `accrued`/`spent`
 * read a counter's increase, everything else flows through {@link reduceCostSeries}.
 * @param {Snapshot[]} win The samples inside the participation window.
 * @param {Pid | string} pid The participant pid.
 * @param {{ id: string, mode: string, series?: string }} m The cost-metric descriptor.
 * @returns {number | null} The figure, or null when no data.
 */
function participantMetricFigure(win, pid, m) {
  if (m.id === "milpower") return militaryLossFigure(win, pid);
  const seriesId = m.series || m.id;
  // "level": the standing value at the end of the window (last finite sample).
  if (m.mode === "level") return lastFinite(participantMetricSeries(win, pid, seriesId));
  // "accrued" (loss counter) and "spent" (neutral spending) both read a
  // cumulative counter's increase over the window; they differ only in display.
  if (m.mode === "accrued" || m.mode === "spent") return accruedFigure(win, pid, m.id);
  return reduceCostSeries(
    participantMetricSeries(win, pid, seriesId),
    /** @type {"drawdown" | "net" | "losses"} */ (m.mode)
  );
}

/**
 * The last finite value of a series (its "level"), or null when empty.
 * @param {number[]} series The metric series.
 * @returns {number | null} The final value, or null.
 */
function lastFinite(series) {
  return series.length ? series[series.length - 1] : null;
}

/**
 * Build a minor (city-state) player's metric series across a window, reading the
 * snapshot's separate `minors` map (city-states aren't in `players`).
 * @param {Snapshot[]} windowSamples Samples inside the window.
 * @param {Pid | string} pid The city-state pid.
 * @param {string} metricId Metric key ("milpower" / "milLostCum").
 * @returns {number[]} The values (samples lacking the value skipped).
 */
function minorMetricSeries(windowSamples, pid, metricId) {
  const series = [];
  for (const s of windowSamples) {
    const v = /** @type {*} */ (s)?.minors?.[pid]?.metrics?.[metricId];
    if (typeof v === "number" && isFinite(v)) series.push(v);
  }
  return series;
}

/**
 * One participant's standing Military Power at war's end (the "level" figure),
 * reading `players` for majors and the `minors` map for city-states.
 * @param {Snapshot[]} win The window samples.
 * @param {Pid | string} pid The participant pid.
 * @param {boolean} isCS Whether the participant is a city-state.
 * @returns {number | null} The standing power, or null when no data.
 */
export function participantMilPower(win, pid, isCS) {
  const series = isCS
    ? minorMetricSeries(win, pid, "milpower")
    : participantMetricSeries(win, pid, "milpower");
  return lastFinite(series);
}

/**
 * One participant's Military Power lost over the window: true casualties
 * (`milLostCum` increase). Majors fall back to the standing-army decline proxy
 * for pre-tracking wars; city-states read the `minors` casualty series.
 * @param {Snapshot[]} win The window samples.
 * @param {Pid | string} pid The participant pid.
 * @param {boolean} isCS Whether the participant is a city-state.
 * @returns {number | null} Strength lost (>= 0), or null when no data.
 */
export function participantMilPowerLost(win, pid, isCS) {
  if (!isCS) return militaryLossFigure(win, pid);
  const cum = minorMetricSeries(win, pid, "milLostCum");
  return cum.length < 2 ? null : cum[cum.length - 1] - cum[0];
}

/**
 * The samples falling inside a war's [start, end] turn window.
 * @param {Snapshot[]} samples The full sample stream.
 * @param {number} warStart The war's start turn.
 * @param {number} warEnd The war's end turn (or latest).
 * @returns {Snapshot[]} The in-window samples.
 */
export function warWindow(samples, warStart, warEnd) {
  return (samples || []).filter(
    (s) => typeof s?.turn === "number" && s.turn >= warStart && s.turn <= warEnd
  );
}

/**
 * Compute one participant's per-metric war cost over its participation window
 * ([joinTurn, leaveTurn || war end]).
 * @param {Snapshot[]} samples The sample stream.
 * @param {*} participant The roster participant entry.
 * @param {number} warStart The war's start turn.
 * @param {number} warEnd The war's end turn (or latest).
 * @returns {Record<string, number | null>} Per-metric figure keyed by m.key.
 */
export function participantCost(samples, participant, warStart, warEnd) {
  const jt = typeof participant?.joinTurn === "number" ? participant.joinTurn : warStart;
  const lt = typeof participant?.leaveTurn === "number" ? participant.leaveTurn : warEnd;
  const win = samples.filter((s) => typeof s?.turn === "number" && s.turn >= jt && s.turn <= lt);
  /** @type {Record<string, number | null>} */
  const acc = {};
  for (const m of COST_METRICS) {
    acc[m.key] = participantMetricFigure(win, participant.pid, m);
  }
  acc.unitsLostScaled = scaledCasualtyFigure(win, acc.unitsLost, warEnd);
  return acc;
}

/**
 * The scaled "soldiers killed" figure beside a raw units-lost count, evaluated at the war's end era
 * (the last window sample's turn, or the war end). null when no units were lost.
 * @param {Snapshot[]} win The participant's window samples.
 * @param {number|null} rawUnits The raw units-lost figure.
 * @param {number} warEnd The war's end turn (fallback era).
 * @returns {number|null} The scaled figure, or null.
 */
function scaledCasualtyFigure(win, rawUnits, warEnd) {
  if (typeof rawUnits !== "number" || rawUnits <= 0) return null;
  const endTurn = Number((win.length ? win[win.length - 1]?.turn : warEnd)) || 0;
  return scaleCasualtiesAt(rawUnits, endTurn);
}

/**
 * Format one cost figure by display mode. `"net"` is signed ("+N" gain / "−N"
 * loss / "0"); `"spent"` is neutral throughput (plain magnitude, no sign);
 * everything else is a loss ("−N" / "0"). null → "-".
 * @param {number|null} raw The raw figure.
 * @param {string} mode The metric's mode (see COST_METRICS).
 * @returns {{ text: string, cls: string }} Display text + sign-class suffix.
 */
export function formatCostFigure(raw, mode) {
  if (raw == null) return { text: "—", cls: "is-none" }; // null/undefined → "—"
  const r = Math.round(raw);
  if (mode === "net") {
    if (r === 0) return { text: "0", cls: "is-none" };
    if (r > 0) return { text: "+" + formatMagnitude(r), cls: "is-gain" };
    return { text: "−" + formatMagnitude(Math.abs(r)), cls: "is-loss" };
  }
  if (mode === "spent" || mode === "level") {
    // Neutral magnitude, no sign, not colored as a loss: "spent" is deliberate
    // war investment; "level" is a standing value (current Military Power).
    return r > 0 ? { text: formatMagnitude(r), cls: "is-spent" } : { text: "0", cls: "is-none" };
  }
  if (r <= 0) return { text: "0", cls: "is-none" };
  return { text: "−" + formatMagnitude(r), cls: "is-loss" };
}
