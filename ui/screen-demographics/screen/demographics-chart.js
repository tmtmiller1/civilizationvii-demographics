// demographics-chart.js
//
// Barrel module + on-demand loader for the chart renderers. The two heavy
// Conflicts charts are not statically imported: ensureChartForMetric() loads
// them when a wars-page metric becomes active and attaches them to the live
// `export let` bindings below, which the screen's held `chartMod` namespace
// reflects without re-importing. Until then those bindings are `undefined` and
// every caller guards with `typeof chartMod.X === "function"`.
//
//   chart-line.js          - the main time-series line chart (renderChart)
//   chart-triumphs-radar.js  - the Legacy Path radar (renderLegacyRadar)
//   chart-resources.js     - the resources stacked-area chart
//   chart-conflicts-timeline.js    - the conflicts Gantt timeline (LAZY)
//   chart-conflicts-graphs.js    - the per-war graphs (LAZY)

export {
  collectCivHistory,
  displayName
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
export { setXAxisMode, getXAxisMode } from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
export { renderChart } from "/demographics/ui/screen-demographics/charts/line/chart-line.js";
export { renderLegacyRadar } from "/demographics/ui/screen-demographics/charts/triumphs/chart-triumphs-radar.js";
export {
  collectResourceCivOptions,
  renderResourcesStack
} from "/demographics/ui/screen-demographics/charts/resources/chart-resources.js";
export { renderCrisisStages } from "/demographics/ui/screen-demographics/charts/crises/chart-crisis-stages.js";
export {
  renderWondersBoard,
  renderWonderRaces,
  renderByTypeBoard,
  renderReligionStandings,
  renderReligionPantheons,
  renderReligionPantheonYields,
  renderSettlementsAtlas
} from "/demographics/ui/screen-demographics/charts/boards/chart-boards.js";
export {
  renderReligionSpread,
  renderReligionByPop
} from "/demographics/ui/screen-demographics/charts/boards/chart-religion-lines.js";
export {
  renderConstructiblesBoard
} from "/demographics/ui/screen-demographics/charts/boards/chart-settlement-boards.js";
export {
  renderQuartersBoard
} from "/demographics/ui/screen-demographics/charts/boards/chart-quarters-board.js";
export {
  renderPowerRace,
  renderPopShareArea,
  renderLandShareArea
} from "/demographics/ui/screen-demographics/charts/boards/chart-trends-chartjs.js";
export {
  renderCivScatter,
  renderPowerRadar
} from "/demographics/ui/screen-demographics/charts/boards/chart-compare-svg.js";
export {
  renderCrisisGraphs,
  collectCrisisScopes,
  resolveCrisisScope
} from "/demographics/ui/screen-demographics/charts/crises/chart-crisis-graphs.js";

// Heavy Conflicts charts - lazily imported (see header). Live `export let`
// bindings start undefined and are filled in by ensureChartForMetric().
/** @type {((host: HTMLElement, options: *) => void) | undefined} */
export let renderConflictsTimeline;
/** @type {((history: *) => Array<*>) | undefined} */
export let collectWarCivOptions;
/** @type {((host: HTMLElement, opts: *) => void) | undefined} */
export let renderConflictsGraphs;

/** Metrics that live on the Conflicts page and need the heavy wars charts. */
const WARS_PAGE_METRICS = new Set(["wars_gantt", "war_graphs"]);

/** @type {Promise<void> | null} Single-flight guard for the wars-chart import. */
let _warsChartsPromise = null;

/**
 * Ensure the heavy Conflicts charts are imported, attaching their renderers to
 * this module's live bindings. Idempotent and single-flight: concurrent calls
 * share one import, and a second call after load resolves immediately. Metrics
 * outside the Conflicts page resolve without importing anything.
 * @param {string} metric The active metric id.
 * @returns {Promise<void>} Resolves once the needed charts are available.
 */
export function ensureChartForMetric(metric) {
  if (!WARS_PAGE_METRICS.has(metric)) return Promise.resolve();
  if (!_warsChartsPromise) {
    _warsChartsPromise = Promise.all([
      import("/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-timeline.js"),
      import("/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-graphs.js")
    ]).then(([gantt, graphs]) => {
      renderConflictsTimeline = gantt.renderConflictsTimeline;
      collectWarCivOptions = gantt.collectWarCivOptions;
      renderConflictsGraphs = graphs.renderConflictsGraphs;
    });
  }
  return _warsChartsPromise;
}
