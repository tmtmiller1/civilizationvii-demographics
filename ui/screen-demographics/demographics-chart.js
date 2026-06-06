// demographics-chart.js
//
// Barrel module + on-demand loader for the chart renderers. Re-exports the
// SAME public API external importers (view-history.js, via the screen's
// `chartMod`) already use, so callers are unchanged.
//
// The two heavy Conflicts charts (chart-wars-gantt ~1.1k lines, chart-war-graphs
// ~1.3k lines) are NOT statically imported here: importing this barrel would
// otherwise parse them at screen-open even for the many sessions that never open
// the Conflicts page. Instead they are loaded by ensureChartForMetric() when a
// wars-page metric becomes active, then attached to the live `renderWarsGantt` /
// `collectWarCivOptions` / `renderWarGraphs` bindings below. ES-module live
// bindings are reflected through an importer's namespace, so the screen's held
// `chartMod` reference sees them appear without re-importing. Until they load the
// bindings are `undefined`; every caller already guards with
// `typeof chartMod.X === "function"`, and the screen ensures the import resolves
// BEFORE rendering a wars metric, so the guard is never observed as a gap.
//
//   chart-line.js          - the main time-series line chart (renderChart)
//   chart-legacy-radar.js  - the Legacy Path radar (renderLegacyRadar)
//   chart-resources.js     - the resources stacked-area chart
//   chart-wars-gantt.js    - the conflicts Gantt timeline (LAZY)
//   chart-war-graphs.js    - the per-war graphs (LAZY)

export {
  collectCivHistory,
  displayName
} from "/demographics/ui/screen-demographics/chart-shared.js";
export { setXAxisMode, getXAxisMode } from "/demographics/ui/screen-demographics/chart-shared.js";
export { renderChart } from "/demographics/ui/screen-demographics/chart-line.js";
export { renderLegacyRadar } from "/demographics/ui/screen-demographics/chart-legacy-radar.js";
export {
  collectResourceCivOptions,
  renderResourcesStack
} from "/demographics/ui/screen-demographics/chart-resources.js";
export { renderWarsGlossary } from "/demographics/ui/screen-demographics/chart-wars-glossary.js";
export { renderCrisisStages } from "/demographics/ui/screen-demographics/chart-crisis-stages.js";
export { renderCrisisGraphs } from "/demographics/ui/screen-demographics/chart-crisis-graphs.js";

// Heavy Conflicts charts - lazily imported (see header). Live `export let`
// bindings start undefined and are filled in by ensureChartForMetric().
/** @type {((host: HTMLElement, options: *) => void) | undefined} */
export let renderWarsGantt;
/** @type {((history: *) => Array<*>) | undefined} */
export let collectWarCivOptions;
/** @type {((host: HTMLElement, opts: *) => void) | undefined} */
export let renderWarGraphs;

/** Metrics that live on the Conflicts page and need the heavy wars charts. */
const WARS_PAGE_METRICS = new Set(["wars_gantt", "war_graphs", "wars_glossary"]);

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
      import("/demographics/ui/screen-demographics/chart-wars-gantt.js"),
      import("/demographics/ui/screen-demographics/chart-war-graphs.js")
    ]).then(([gantt, graphs]) => {
      renderWarsGantt = gantt.renderWarsGantt;
      collectWarCivOptions = gantt.collectWarCivOptions;
      renderWarGraphs = graphs.renderWarGraphs;
    });
  }
  return _warsChartsPromise;
}
