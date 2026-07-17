// demographics-metrics.js
//
// Metric registry. Each entry:
//   { id, label, category, accessor(ctx)→number|undefined,
//     scale?(raw, scaleCtx, ctx)→number, format(n)→string, tooltip? }
//
// LOCALIZATION — READ BEFORE ADDING/EDITING A METRIC. The `label`/`title` strings
// below are DEV-FACING FALLBACKS, not what players see. Every metric's on-screen
// name resolves LOC-first from `LOC_DEMOGRAPHICS_METRIC_<ID>` (uppercased id), with
// an optional fuller chart title at `LOC_DEMOGRAPHICS_METRIC_<ID>_TITLE`, via
// localizedMetricName() below / history-tabs.js. So:
//   • Adding a metric → also add `LOC_DEMOGRAPHICS_METRIC_<ID>` (+ `_TOOLTIP`) to
//     text/en_us/ModText.xml AND all 10 locales (see text/README.md). Without it the
//     UI falls back to the raw English `label`, untranslated.
//   • Renaming a metric → edit the LOC key's <Text>, NOT the `label` here (editing
//     `label` alone changes nothing a player sees).
//
// Accessors take a pre-resolved `ctx` built by the sampler (see
// demographics-sampler.js#buildPlayerCtx). Every ctx field can be
// undefined and the accessors have to tolerate that without throwing.
// Return `undefined` and the sampler drops the metric for that player
// on that turn; if a metric returns undefined for every player across
// every recorded sample, the screen auto-hides its tab
// (see screen-demographics.js).
//
// A few metrics apply a deterministic transform to make the raw game
// number feel more real-world - GDP in dollars, population in millions,
// land in km². These are purely cosmetic; they never affect game state.
// Per-metric formulas are documented inline below.
//
// Every accessor is cited to vanilla Civ7 source in demographics-sampler.js.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { EXTRA_METRICS } from "/demographics/ui/metrics/demographics-metrics-extra.js";
import {
  formatArea,
  formatBigNumber,
  formatCount,
  formatCurrency,
  formatPercent,
  formatSignedRate
} from "/demographics/ui/metrics/metrics-format.js";
import {
  civicsAccessor,
  crisisStageAccessor,
  dlog,
  formatApproval,
  formatCrisisStage,
  formatRoundedCount,
  gdpAccessor,
  landAccessor,
  scaleGDP,
  scaleLandArea,
  scalePopulation,
  scoreAccessor,
  settlementCapPctAccessor,
  safeNum
} from "/demographics/ui/metrics/demographics-metrics-helpers.js";

// The per-player sampler context passed to every accessor/scale function.
// It is the untyped engine boundary: every field can be undefined and is
// read defensively, so it is kept loose on purpose.
/**
 * @typedef {Object<string, any>} MetricCtx
 */

export const METRICS = [
  // ---- canonical / "raw" ---------------------------------------------
  {
    id: "score",
    label: "Score",
    title: "Civilization Score",
    category: "power",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_SCORE_TOOLTIP",
    accessor: scoreAccessor,
    format: formatRoundedCount,
    unit: "points"
  },
  {
    id: "gold",
    label: "Treasury",
    title: "Treasury",
    category: "economy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_GOLD_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Treasury gold.
     */
    accessor: (ctx) => safeNum(ctx.gold),
    format: formatRoundedCount,
    unit: "gold",
    // yield-icons.xml - blp:Yield_Gold (64px).
    unitIcon: "blp:Yield_Gold"
  },
  {
    // Gold income per turn (net) - yield-based companion to Treasury.
    id: "gpt",
    label: "GPT",
    title: "Gold Per Turn",
    category: "economy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_GPT_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Net gold per turn.
     */
    accessor: (ctx) => safeNum(ctx.yieldGold),
    format: formatSignedRate,
    unit: "gold / turn",
    unitIcon: "blp:Yield_Gold"
  },
  {
    id: "settlements",
    label: "Settlements",
    title: "Settlements (cities + towns)",
    category: "people",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_SETTLEMENTS_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Settlement count.
     */
    accessor: (ctx) => safeNum(ctx.settlementsCount),
    format: formatRoundedCount,
    unit: "cities"
  },
  {
    id: "techs",
    label: "Techs",
    title: "Technologies Researched",
    category: "science",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_TECHS_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Researched-tech count.
     */
    accessor: (ctx) => safeNum(ctx.techsCount),
    format: formatRoundedCount,
    unit: "techs"
  },
  {
    id: "civics",
    label: "Civics",
    title: "Civics Unlocked",
    category: "culture",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_CIVICS_TOOLTIP",
    // Turn-1 fix: when the Culture progression tree handle isn't yet
    // populated, sampler stores ctx.civicsCount as undefined. Returning
    // undefined here would cause the chart to skip the entire civ's
    // series (chart.js requires isFinite). Default to 0 so the
    // turn-1 sample plots at y=0 with a legend entry, rather than
    // showing no line/label at all.
    accessor: civicsAccessor,
    format: formatRoundedCount,
    unit: "civics"
  },

  // ---- V5 pseudo-realistic -------------------------------------------
  {
    // GDP = weighted-sum(yields) × turnsElapsed × 1e6 → $billions
    // Weights: gold=1.0, production=1.0, food=0.5, influence=1.5,
    // culture=1.2, science=1.2 (see GDP_WEIGHTS).
    id: "gdp",
    label: "GDP",
    title: "Gross Domestic Product",
    category: "economy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_GDP_TOOLTIP",
    accessor: gdpAccessor,
    scale: scaleGDP,
    format: formatCurrency,
    // format() already prepends "$" (e.g. "$1.23B"); keep unit short
    // so the axis label doesn't double-render the dollar sign.
    unit: "$"
  },
  {
    // Crop yield = net FOOD per turn (display as +/-).
    id: "crops",
    label: "Crop Yield",
    title: "Crop Yield (food per turn)",
    category: "economy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_CROPS_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Net food per turn.
     */
    accessor: (ctx) => safeNum(ctx.yieldFood),
    format: formatSignedRate,
    unit: "food / turn",
    // Civ7 yield-icon BLP path, registered in
    //   Resources/Base/modules/base-standard/data/icons/yield-icons.xml
    unitIcon: "blp:Yield_Food"
  },
  {
    // Net PRODUCTION per turn (display as +/-).
    // yield-icons.xml - blp:Yield_Production.
    id: "production",
    label: "PPT",
    title: "Production Per Turn",
    category: "economy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_PRODUCTION_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Net production per turn.
     */
    accessor: (ctx) => safeNum(ctx.yieldProduction),
    format: formatSignedRate,
    unit: "production / turn",
    unitIcon: "blp:Yield_Production"
  },
  {
    // Net SCIENCE per turn (display as +/-).
    // yield-icons.xml - blp:Yield_Science.
    id: "science_yield",
    label: "Science",
    title: "Science Per Turn",
    category: "knowledge",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_SCIENCE_YIELD_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Net science per turn.
     */
    accessor: (ctx) => safeNum(ctx.yieldScience),
    format: formatSignedRate,
    unit: "science / turn",
    unitIcon: "blp:Yield_Science"
  },
  {
    // Net CULTURE per turn (display as +/-).
    // yield-icons.xml - blp:Yield_Culture.
    id: "culture_yield",
    label: "Culture",
    title: "Culture Per Turn",
    category: "knowledge",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_CULTURE_YIELD_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Net culture per turn.
     */
    accessor: (ctx) => safeNum(ctx.yieldCulture),
    format: formatSignedRate,
    unit: "culture / turn",
    unitIcon: "blp:Yield_Culture"
  },
  {
    // Diplomatic Approval - international reputation aggregate.
    // Sum of weighted relationship scores across all met major civs
    // (Allied +5, Helpful +3, Friendly +2, Neutral 0, Unfriendly -2,
    // Hostile -3, At War -5) PLUS 0.3 × (suzerain bonus from city-states).
    // Sampled in demographics-sampler.js → ctx.diplomaticApproval.
    id: "approval",
    label: "Diplomatic Approval",
    title: "Diplomatic Approval (international reputation)",
    category: "diplomacy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_APPROVAL_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Diplomatic approval aggregate.
     */
    accessor: (ctx) => safeNum(ctx.diplomaticApproval),
    format: formatApproval,
    unit: "reputation"
  },
  {
    // Scaled population: raw^1.11 × 90000 × 1.009^turn (monotonic turn).
    id: "population",
    label: "Population",
    title: "Population (scaled millions)",
    category: "people",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_POPULATION_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Raw total population.
     */
    accessor: (ctx) => safeNum(ctx.totalPopulation),
    scale: scalePopulation,
    format: formatBigNumber,
    unit: "people"
  },
  {
    // Raw Civ population points, the SAME sampled total as `population`, but WITHOUT the
    // people-scaling, so the Migration hub's "Civ numbers" view shows the exact Civ figures (and
    // the Y axis rescales). The Population group pill maps Scaled → `population`, Civ → this. Title
    // matches so the toggle only changes the curve/axis, not the heading.
    id: "population_civ",
    label: "Population",
    title: "Population Over Time",
    category: "people",
    // The All Civilizations matrix already shows "Population" (the scaled `population`
    // metric) and swaps to THIS raw-Civ twin via its Scaled/Civ toggle, so it must not
    // also render as its own duplicate "Population" row there.
    worldRankingsAllCivsHidden: true,
    accessor: (/** @type {MetricCtx} */ ctx) => safeNum(ctx.totalPopulation),
    format: formatBigNumber,
    unit: "points"
  },

  // ---- V7-specific creative ------------------------------------------
  {
    // Influence net per turn (= YIELD_DIPLOMACY).
    id: "influence",
    label: "IPT",
    title: "Influence Per Turn",
    category: "diplomacy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_INFLUENCE_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Net influence per turn.
     */
    accessor: (ctx) => safeNum(ctx.yieldDiplomacy),
    format: formatSignedRate,
    // yield-icons.xml maps YIELD_DIPLOMACY to blp:yield_influence.
    unit: "influence / turn",
    unitIcon: "blp:yield_influence"
  },
  {
    // Active diplomatic actions involving the player.
    id: "hpt",
    label: "HPT",
    title: "Happiness Per Turn",
    category: "people",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_HPT_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Net happiness per turn.
     */
    accessor: (ctx) => safeNum(ctx.yieldHappiness),
    format: formatSignedRate,
    unit: "happiness / turn"
  },
  {
    id: "deals",
    label: "Ongoing Deals",
    title: "Active Diplomatic Deals",
    category: "diplomacy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_DEALS_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Ongoing deal count.
     */
    accessor: (ctx) => safeNum(ctx.ongoingDealsCount),
    format: formatCount,
    unit: "deals"
  },
  {
    // Player-wide trade route count.
    id: "trade",
    label: "Trade Routes",
    title: "Active Trade Routes",
    category: "economy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_TRADE_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Active trade-route count.
     */
    accessor: (ctx) => safeNum(ctx.tradeRoutesCount),
    format: formatCount,
    unit: "routes"
  },
  {
    // Military Power - summed combat strength across military units.
    // Computed in sampler (no clean vanilla player-level accessor); see
    // demographics-sampler.js computeMilitaryPower() - citations there.
    id: "milpower",
    label: "Military Power",
    title: "Military Power (combined unit strength)",
    category: "power",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_MILPOWER_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Combined military power.
     */
    accessor: (ctx) => safeNum(ctx.militaryPower),
    format: formatRoundedCount,
    unit: "strength"
  },
  {
    // Wonders - total wonders constructed by the player, all ages.
    // Accessor: player.Stats.getNumWonders(false, false)
    //   - base-standard/ui/advice/advice-support.js
    id: "wonders",
    label: "Wonders",
    title: "Wonders Constructed",
    category: "power",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_WONDERS_TOOLTIP",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Wonder count.
     */
    accessor: (ctx) => safeNum(ctx.wondersCount),
    format: formatRoundedCount,
    unit: "wonders"
  },
  // ── Civ7 Test of Time triumph counts ───────────────────────────────
  // Per-civ count of triggered triumphs, bucketed by Legacies.LegacySubtype.
  // Sampler reads via Players.get(pid).Legacies.isTriggered(legacyType) for
  // every row in GameInfo.Legacies. These six fields are persisted in
  // every sample's metrics so the stacked-area "Triumphs Over Time" view
  // and the radar can reconstruct history. They DON'T have their own
  // line-chart tabs - a single-integer step counter over hundreds of
  // turns is poor info density. The dedicated triumph views (Race,
  // Completion, Stack) live as synthetic metrics in view-history.js.
  {
    id: "triumphs_cultural",
    category: "age",
    worldRankingsAllCivsHidden: true,
    hidden: true,
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Cultural triumph count.
     */
    accessor: (ctx) => safeNum(ctx.triumphsCultural)
  },
  {
    id: "triumphs_diplomatic",
    category: "age",
    worldRankingsAllCivsHidden: true,
    hidden: true,
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Diplomatic triumph count.
     */
    accessor: (ctx) => safeNum(ctx.triumphsDiplomatic)
  },
  {
    id: "triumphs_economic",
    category: "age",
    worldRankingsAllCivsHidden: true,
    hidden: true,
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Economic triumph count.
     */
    accessor: (ctx) => safeNum(ctx.triumphsEconomic)
  },
  {
    id: "triumphs_scientific",
    category: "age",
    worldRankingsAllCivsHidden: true,
    hidden: true,
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Scientific triumph count.
     */
    accessor: (ctx) => safeNum(ctx.triumphsScientific)
  },
  {
    id: "triumphs_militaristic",
    category: "age",
    worldRankingsAllCivsHidden: true,
    hidden: true,
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Militaristic triumph count.
     */
    accessor: (ctx) => safeNum(ctx.triumphsMilitaristic)
  },
  {
    id: "triumphs_expansionist",
    category: "age",
    worldRankingsAllCivsHidden: true,
    hidden: true,
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Expansionist triumph count.
     */
    accessor: (ctx) => safeNum(ctx.triumphsExpansionist)
  },
  // Settlement cap utilization: settlements / cap × 100.
  // citation: base-standard/ui/diplo-ribbon/panel-yield-banner.js
  {
    id: "settlement_cap_pct",
    label: "Cap Utilization",
    title: "Settlement Cap Utilization",
    category: "age",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_SETTLEMENT_CAP_PCT_TOOLTIP",
    accessor: settlementCapPctAccessor,
    format: formatPercent,
    unit: "%"
  },
  // Crisis stage 0-3 (game-wide). Plotted as a step function.
  // citation: base-standard/ui/policies/model-government.js
  {
    id: "crisis_stage",
    label: "Crisis Stage",
    title: "Crisis Stage , 1 = Begins · 2 = Intensifies · 3 = Culminates · 4 = Ends",
    category: "age",
    global: true,
    worldRankingsAllCivsHidden: true,
    // Discrete integer metric - Chart.js auto-generates fractional ticks
    // (0, 0.5, 1, …) over our 0–4 range and the formatter rounds them,
    // so labels appear 9 times instead of 5. This flag tells the chart
    // to suppress non-integer tick labels.
    integerOnly: true,
    tooltip: "LOC_DEMOGRAPHICS_METRIC_CRISIS_STAGE_TOOLTIP",
    // Game.CrisisManager.getCurrentCrisisStage(0) returns:
    //   -1 = pre-crisis (no crisis triggered yet)
    //    0 = first active stage ("Crisis Begins")
    //    1 = second active stage ("Crisis Intensifies")
    //    2 = third active stage ("Crisis Culminates")
    //    3 = post-final stage ("Crisis Ends")
    // Cite: model-government.js - `nextCrisisStage = max(0, crisisStage+1)`
    // looks at the NEXT marker index, confirming engine values are 0-based.
    // Display-side we want the user-facing label "Stage 1" when the engine
    // says 0 (the first active stage). Shift every value up by 1 so the
    // Y axis range becomes 0..4 and engine=-1 plots cleanly as Y=0.
    accessor: crisisStageAccessor,
    format: formatCrisisStage,
    unit: "stage"
  },
  // ── Resources page metrics ─────────────────────────────────────────
  // citation: base-standard/ui/resource-allocation/model-resource-allocation.js
  {
    id: "resources_total",
    label: "Resources",
    title: "Total Assigned Resources",
    category: "resources",
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Total assigned resources.
     */
    accessor: (ctx) => safeNum(ctx.resourcesTotal),
    format: formatRoundedCount,
    unit: "resources"
  },
  {
    id: "resources_bonus",
    label: "Bonus",
    title: "Bonus Resources Assigned",
    category: "resources",
    worldRankingsAllCivsHidden: true,
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Bonus resources assigned.
     */
    accessor: (ctx) => safeNum(ctx.resourcesBonus),
    format: formatRoundedCount,
    unit: "bonus"
  },
  {
    id: "resources_empire",
    label: "Empire",
    title: "Empire Resources Assigned",
    category: "resources",
    worldRankingsAllCivsHidden: true,
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Empire resources assigned.
     */
    accessor: (ctx) => safeNum(ctx.resourcesEmpire),
    format: formatRoundedCount,
    unit: "empire"
  },
  {
    id: "resources_city",
    label: "City",
    title: "City Resources Assigned",
    category: "resources",
    worldRankingsAllCivsHidden: true,
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} City resources assigned.
     */
    accessor: (ctx) => safeNum(ctx.resourcesCity),
    format: formatRoundedCount,
    unit: "city"
  },
  {
    id: "resources_factory",
    label: "Factory",
    title: "Factory Resources (Modern age)",
    category: "resources",
    worldRankingsAllCivsHidden: true,
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Factory resources assigned.
     */
    accessor: (ctx) => safeNum(ctx.resourcesFactory),
    format: formatRoundedCount,
    unit: "factory"
  },
  {
    id: "resources_treasure",
    label: "Treasure",
    title: "Treasure Resources (Exploration / Distant Lands)",
    category: "resources",
    worldRankingsAllCivsHidden: true,
    /**
     * @param {MetricCtx} ctx Per-player accessor context.
     * @returns {number | undefined} Treasure resources assigned.
     */
    accessor: (ctx) => safeNum(ctx.resourcesTreasure),
    format: formatRoundedCount,
    unit: "treasure"
  },
  {
    // Land area: total owned tiles × 7000 km² per hex.
    id: "land",
    label: "Land Area",
    title: "Territorial Land Area",
    category: "people",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_LAND_TOOLTIP",
    // Turn-1 fix: when the player has no cities yet, sumOwnedTiles
    // (sampler) returns undefined. Default to 0 so a settler-only civ
    // still appears at y=0 km² on turn 1 with a legend entry.
    accessor: landAccessor,
    scale: scaleLandArea,
    format: formatArea,
    // format() already appends "km²" to every value; keep unit short
    // so the axis title doesn't double-render the suffix.
    unit: "km²"
  },
  // source-mod-integration additions live in a sibling module to respect the
  // 500-line file cap; they obey the same MetricDef contract.
  ...EXTRA_METRICS
];

/**
 * Look up a metric definition by id, falling back to the first metric.
 * @param {string} id Metric id.
 * @returns {MetricDef} The matching metric, or `METRICS[0]`.
 */
export function getMetric(id) {
  // The catalog's inferred element type is looser than MetricDef (the hidden
  // triumph entries omit `label`); cast at this boundary.
  return /** @type {MetricDef} */ (METRICS.find((m) => m.id === id) || METRICS[0]);
}

/**
 * The localized display name for a metric, resolved from its
 * `LOC_DEMOGRAPHICS_METRIC_<ID>` key — the same key the history tabs and chart
 * axis derive (see history-tabs.js `localizedMetricName`, chart-line-config.js
 * `yAxisTitle`). The metric table's English `label`/`title` are the fallback
 * used only when the key is unresolved (t() returns the key unchanged on a
 * miss). Use this anywhere a metric name is shown to the user so it translates
 * instead of rendering the raw English `label`.
 * @param {*} metric A metric descriptor (needs `id`; `label`/`title` are fallback).
 * @returns {string} The localized metric name, or "" for a nullish metric.
 */
export function localizedMetricName(metric) {
  if (!metric) return "";
  const key = "LOC_DEMOGRAPHICS_METRIC_" + String(metric.id).toUpperCase();
  const localized = t(key);
  if (localized && localized !== key) return localized;
  return metric.label || metric.title || String(metric.id || "");
}

// ── Companion-mod extension API (inert unless another mod calls it) ────────
// Lets a separate mod (e.g. "emigration") contribute a metric that flows through
// the normal sample → store → line-chart pipeline. Pushed metrics are picked up
// live by the sampler (computeMetrics iterates METRICS each turn); page
// placements are applied by view-history at render time. Nothing here runs unless
// an external mod invokes the API, so the base mod's behavior is unchanged.

/**
 * Pending external page placements: {pageId, metricId}. view-history merges
 * these into PAGES at render (kept here so the API lives in one boot-loaded
 * module regardless of when the screen's view modules evaluate).
 * @type {{pageId:string, metricId:string, afterMetricId:(string|null)}[]}
 */
export const EXTERNAL_PAGE_METRICS = [];

/**
 * Register an external metric into the live registry (ignored if its id is
 * already present). Surfacing it as a graph also needs registerMetricToPage.
 * @param {*} spec A metric spec ({id,label,title,category,accessor,format,...}).
 * @returns {boolean} Whether it was added.
 */
export function registerMetric(spec) {
  if (!spec || typeof spec.id !== "string") return false;
  if (METRICS.find((m) => m.id === spec.id)) return false;
  METRICS.push(spec);
  return true;
}

/**
 * Request that a metric id appear on a page's tab row.
 * @param {string} pageId A PAGES id (e.g. "power").
 * @param {string} metricId A metric id registered via registerMetric.
 * @param {string} [afterMetricId] Place the tab immediately after this metric id on
 *   the page (e.g. "population"); appended at the end when omitted or not found.
 * @returns {boolean} Whether the placement was recorded.
 */
export function registerMetricToPage(pageId, metricId, afterMetricId) {
  if (typeof pageId !== "string" || typeof metricId !== "string") return false;
  if (EXTERNAL_PAGE_METRICS.some((e) => e.pageId === pageId && e.metricId === metricId)) {
    return false;
  }
  EXTERNAL_PAGE_METRICS.push({
    pageId,
    metricId,
    afterMetricId: typeof afterMetricId === "string" ? afterMetricId : null
  });
  return true;
}

/**
 * Pending external dashboard PANELS. Unlike registerMetricToPage (which adds a line-chart tab to
 * an existing page), a panel is a whole companion-owned page whose body the companion renders
 * itself , the screen just hands it a container. Consumed by view-history at render time. A panel
 * may declare `tabs` to contribute several native Demographics sub-tabs (one synthetic metric
 * each) instead of a single tab; `render` then receives the selected sub-tab id as its third
 * argument. A panel may set `topLevel: true` to be shown as its own top-level view tab (right of
 * Historical Data) instead of a page inside Historical Data.
 * @type {{id:string, pageLabel?:string, tabLabel?:string, title?:string, render:Function,
 *   topLevel?:boolean,
 *   tabs?:{id:string, label?:string, title?:string, hidePolicyBanner?:boolean}[]}[]}
 */
export const EXTERNAL_PANELS = [];

/**
 * Separator joining an external panel id to one of its sub-tab ids ("panelId::subId"). A panel
 * that declares `tabs` contributes one Demographics sub-tab (synthetic metric) per tab under this
 * scheme.
 */
export const PANEL_SUBTAB_SEP = "::";

/**
 * Register an external dashboard panel as its own page. `spec.render(container, ctx, subId)` is
 * invoked by the screen to fill the page body (the companion owns all of it). Ignored on a
 * duplicate id. A panel may declare `tabs: [{id, label, title}]` to contribute several native
 * Demographics sub-tabs (one synthetic metric each) instead of a single tab; `render` then
 * receives the selected sub-tab's `id` as its third argument. Without `tabs`, it's a single-tab
 * panel (legacy) and `subId` is undefined.
 * @param {*} spec A panel spec ({id, pageLabel, tabLabel, title, render, tabs?}).
 * @returns {boolean} Whether it was added.
 */
export function registerPanel(spec) {
  if (!spec || typeof spec.id !== "string" || typeof spec.render !== "function") return false;
  if (EXTERNAL_PANELS.some((p) => p.id === spec.id)) return false;
  // Don't let a companion panel id shadow a built-in metric id (the render dispatch would then
  // route that real metric's tab to the panel). Sub-tab ids are namespaced with "::", so they
  // can't collide with a plain built-in id. NOTE: use a STRICT existence check here, not
  // getMetric() - getMetric falls back to METRICS[0] for an unknown id (never returns falsy), so
  // it would reject every panel.
  if (METRICS.some((m) => m.id === spec.id)) return false;
  EXTERNAL_PANELS.push(spec);
  return true;
}

/**
 * External metric GROUPS: a single tab (on a page) that presents related metrics behind toggles,
 * showing one full chart at a time, instead of N separate tabs. Two shapes are supported:
 *  • flat, `metricIds: string[]` (one metric toggle); or
 *  • 2D, `members: [{label, <viewId>: metricId, ...}]` + `views: [{id, label}]` (a metric toggle
 *    AND a view toggle; the shown metric is `members[metricSel][viewSel]`).
 * Consumed by view-history. Member metrics must be registered separately so they're sampled.
 * @type {{pageId:string, id:string, label:string, first?:boolean, metricIds?:string[],
 *   views?:{id:string,label:string}[], members?:*[]}[]}
 */
export const EXTERNAL_METRIC_GROUPS = [];

/**
 * Register a metric group (flat or 2D, see EXTERNAL_METRIC_GROUPS).
 * @param {*} spec The group spec.
 * @returns {boolean} Whether it registered.
 */
export function registerMetricGroup(spec) {
  if (!spec || typeof spec.id !== "string") return false;
  if (!Array.isArray(spec.metricIds) && !Array.isArray(spec.members)) return false;
  if (EXTERNAL_METRIC_GROUPS.some((g) => g.id === spec.id)) return false;
  EXTERNAL_METRIC_GROUPS.push(spec);
  return true;
}

/** Hub ids a companion may inject pages into (Rankings is its own view; not injectable). */
export const HUB_IDS = Object.freeze(["statistics", "migration", "geopolitics"]);

/**
 * Pending hub-page contributions: whole companion-owned PAGES injected into a named hub at a
 * position. Each page is a PageDef ({id, label, tier?, render | metrics}); `after` is an anchor
 * page id within the hub (else appended). Consumed by view-history's mergeHubPages at render time.
 * This is the hub-targeted cousin of registerPanel (which makes a sibling top-level tab); a hub
 * page lives INSIDE a hub's page row.
 * @type {{hubId:string, page:*, after:(string|null)}[]}
 */
export const EXTERNAL_HUB_PAGES = [];

/**
 * True when a companion (the Emigration mod) has registered pages into the Migration hub.
 * Drives the host's Migration-hub visibility + Population placement: with no companion the
 * hub is hidden and Population moves to the Society page; with one, the hub shows (labelled
 * "Emigration") and the companion owns the Population anchor.
 * @returns {boolean} Whether the Migration hub has companion pages.
 */
export function migrationHubHasCompanion() {
  return EXTERNAL_HUB_PAGES.some((e) => e.hubId === "migration");
}

/**
 * Register one or more pages into a named hub (e.g. Emigration's Network/Causes/… into
 * "migration"). Additive; existing registerPanel/registerMetricGroup callers are unaffected.
 * Duplicate page ids and unknown hub ids are ignored.
 * @param {string} hubId One of HUB_IDS.
 * @param {*[]} pages PageDefs to inject (in display order).
 * @param {{after?:string}} [opts] `after` = anchor page id within the hub; else appended.
 * @returns {boolean} Whether at least one page was added.
 */
export function registerHubPages(hubId, pages, opts) {
  if (!HUB_IDS.includes(hubId) || !Array.isArray(pages)) return false;
  const after = opts && typeof opts.after === "string" ? opts.after : null;
  let added = 0;
  for (const page of pages) {
    if (!page || typeof page.id !== "string") continue;
    if (EXTERNAL_HUB_PAGES.some((e) => e.page.id === page.id)) continue;
    EXTERNAL_HUB_PAGES.push({ hubId, page: Object.assign({ hub: hubId }, page), after });
    added++;
  }
  return added > 0;
}

const _api = (/** @type {*} */ (globalThis).DemographicsMetricsAPI ??= {});
_api.registerMetric = registerMetric;
_api.registerMetricToPage = registerMetricToPage;
_api.registerPanel = registerPanel;
_api.registerMetricGroup = registerMetricGroup;
_api.registerHubPages = registerHubPages;
_api.HUB_IDS = HUB_IDS;
// This module is imported lazily (the sampler is dynamic-imported after
// engine.whenReady), so a companion mod may have booted first and queued its
// registrations on `pending`. Drain them now that the real API exists. This
// makes the handshake order-independent: whoever loads second completes it.
if (Array.isArray(_api.pending)) {
  for (const job of _api.pending.splice(0)) {
    try {
      job(_api);
    } catch (_) {
      /* a companion mod's registration must never break ours */
    }
  }
}

dlog("metrics module loaded; registry size=", METRICS.length);
