// demographics-metrics-extra.js
//
// Extended metric registry: per-civ metrics added in the v2.5.0 expansion. Kept
// out of demographics-metrics.js purely to respect the 500-line file cap as the
// catalog grows; these entries obey the exact same MetricDef contract and are
// spread into the canonical METRICS array by that module. Every accessor
// tolerates undefined ctx fields and returns undefined (never throws).
//
// Localization works exactly as in demographics-metrics.js: the `label`/`title`
// here are DEV-FACING FALLBACKS — the displayed name comes LOC-first from
// `LOC_DEMOGRAPHICS_METRIC_<ID>`. Add that key (+ `_TOOLTIP`) to every locale when
// you add a metric; rename via the LOC key, not the `label`. See that file's
// header and text/README.md.

import { formatPercent } from "/demographics/ui/metrics/metrics-format.js";
import { formatRoundedCount, safeNum } from "/demographics/ui/metrics/demographics-metrics-helpers.js";

/**
 * The per-player sampler context passed to every accessor. Untyped engine
 * boundary: every field can be undefined and is read defensively.
 * @typedef {Object<string, any>} MetricCtx
 */

// Typed as MetricDef[] (the global catalog contract, which carries an index
// signature) so spreading these into METRICS keeps property reads like
// `.worldRankingsAllCivsHidden` valid; every entry here supplies `label`, so
// unlike the hidden-triumph entries it satisfies MetricDef cleanly.
/** @type {MetricDef[]} */
export const EXTRA_METRICS = [
  {
    // Great works currently slotted across the civ's buildings/wonders.
    // Accessor: player.Stats.getTotalGreatWorksSlotted() (base-standard).
    id: "great_works",
    label: "Great Works",
    title: "Great Works Slotted",
    category: "culture",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_GREAT_WORKS_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Slotted great-works count.
     */
    accessor: (ctx) => safeNum(ctx.greatWorks),
    format: formatRoundedCount,
    unit: "works"
  },
  {
    // Promoted settlements (cities). Sampled as ctx.citiesCount.
    id: "cities",
    label: "Cities",
    title: "Cities (promoted settlements)",
    category: "people",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_CITIES_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} City count.
     */
    accessor: (ctx) => safeNum(ctx.citiesCount),
    format: formatRoundedCount,
    unit: "cities"
  },
  {
    // Towns (un-promoted settlements). Sampled as ctx.townsCount.
    id: "towns",
    label: "Towns",
    title: "Towns",
    category: "people",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_TOWNS_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Town count.
     */
    accessor: (ctx) => safeNum(ctx.townsCount),
    format: formatRoundedCount,
    unit: "towns"
  },
  {
    // Raw settlement cap (the ceiling the % metric divides by).
    id: "settlement_cap",
    label: "Settlement Cap",
    title: "Settlement Cap",
    category: "age",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_SETTLEMENT_CAP_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Settlement cap.
     */
    accessor: (ctx) => safeNum(ctx.settlementCap),
    format: formatRoundedCount,
    unit: "cap"
  },
  {
    // Cumulative settlements taken by force.
    // Accessor: player.Stats.getNumConqueredSettlements(...) (base-standard).
    id: "settlements_conquered",
    label: "Settlements Conquered",
    title: "Settlements Conquered",
    category: "power",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_SETTLEMENTS_CONQUERED_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Conquered-settlement count.
     */
    accessor: (ctx) => safeNum(ctx.conqueredCum),
    format: formatRoundedCount,
    unit: "settlements"
  },
  {
    // Conquest share: conquered / total settlements × 100 (same-player ratio).
    id: "conquest_pct",
    label: "Conquest %",
    title: "Share of Settlements Taken by Force",
    category: "power",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_CONQUEST_PCT_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Percent of settlements conquered.
     */
    accessor: (ctx) => {
      const num = safeNum(ctx.conqueredCum);
      const den = safeNum(ctx.settlementsCount);
      if (typeof num !== "number" || !den) return undefined;
      return Math.round((num / den) * 1000) / 10;
    },
    format: formatPercent,
    unit: "%"
  },
  {
    // Tourism total (Culture-Victory-Points). Sourced from Game.Summary
    // (city-scope "Tourism" dataset, summed per player); empty until generated.
    id: "tourism",
    label: "Tourism",
    title: "Tourism",
    category: "culture",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_TOURISM_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Tourism total.
     */
    accessor: (ctx) => safeNum(ctx.tourism),
    format: formatRoundedCount,
    unit: "tourism"
  },
  {
    // Great people earned (cumulative). Sourced from Game.Summary
    // (player-scope delta dataset "GreatPeopleEarned"); empty until one is earned.
    id: "great_people",
    label: "Great People",
    title: "Great People Earned",
    category: "culture",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_GREAT_PEOPLE_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Great people earned.
     */
    accessor: (ctx) => safeNum(ctx.greatPeople),
    format: formatRoundedCount,
    unit: "people"
  },
  {
    // Enemy units killed (cumulative). Game.Summary player-scope delta "UnitsKilled".
    id: "units_killed",
    label: "Units Killed",
    title: "Units Killed",
    category: "power",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_UNITS_KILLED_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Enemy units killed.
     */
    accessor: (ctx) => safeNum(ctx.unitsKilled),
    format: formatRoundedCount,
    unit: "kills"
  },
  {
    // Own units lost (cumulative). Game.Summary player-scope delta "UnitsLost".
    id: "units_lost",
    label: "Units Lost",
    title: "Units Lost",
    category: "power",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_UNITS_LOST_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Own units lost.
     */
    accessor: (ctx) => safeNum(ctx.unitsLost),
    format: formatRoundedCount,
    unit: "losses"
  },
  {
    // Faith stockpile/total. Game.Summary player-scope level dataset "Faith".
    id: "faith",
    label: "Faith",
    title: "Faith",
    category: "culture",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_FAITH_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Faith total.
     */
    accessor: (ctx) => safeNum(ctx.faith),
    format: formatRoundedCount,
    unit: "faith"
  },
  {
    // Combats fought (cumulative). Game.Summary player-scope delta "Combats".
    id: "combats",
    label: "Battles",
    title: "Battles Fought",
    category: "power",
    worldRankingsAllCivsHidden: true,
    tooltip: "LOC_DEMOGRAPHICS_METRIC_COMBATS_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Combats fought.
     */
    accessor: (ctx) => safeNum(ctx.combats),
    format: formatRoundedCount,
    unit: "battles"
  },
  {
    // Wars declared BY this civ (cumulative). Game.Summary delta "WarsDeclared".
    id: "wars_declared",
    label: "Wars Declared",
    title: "Wars Declared",
    category: "diplomacy",
    worldRankingsAllCivsHidden: true,
    tooltip: "LOC_DEMOGRAPHICS_METRIC_WARS_DECLARED_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Wars declared.
     */
    accessor: (ctx) => safeNum(ctx.warsDeclared),
    format: formatRoundedCount,
    unit: "wars"
  },
  {
    // Wars declared AGAINST this civ (cumulative). Game.Summary delta "WarsReceived".
    id: "wars_received",
    label: "Wars Received",
    title: "Wars Received",
    category: "diplomacy",
    worldRankingsAllCivsHidden: true,
    tooltip: "LOC_DEMOGRAPHICS_METRIC_WARS_RECEIVED_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Wars received.
     */
    accessor: (ctx) => safeNum(ctx.warsReceived),
    format: formatRoundedCount,
    unit: "wars"
  },
  {
    // Natural wonders discovered (cumulative). Game.Summary delta "NaturalWondersDiscovered".
    id: "natural_wonders",
    label: "Natural Wonders",
    title: "Natural Wonders Discovered",
    category: "knowledge",
    worldRankingsAllCivsHidden: true,
    tooltip: "LOC_DEMOGRAPHICS_METRIC_NATURAL_WONDERS_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Natural wonders discovered.
     */
    accessor: (ctx) => safeNum(ctx.naturalWonders),
    format: formatRoundedCount,
    unit: "wonders"
  }
];
