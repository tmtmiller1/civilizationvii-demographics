// demographics-chart.js
//
// Barrel module. The chart renderers were split into focused sibling modules
// during modularization; this file re-exports the SAME public API so external
// importers (view-history.js) keep working unchanged.
//
//   chart-shared.js        — shared helpers (collectCivHistory, displayName,
//                            x-axis mode, palette/series/color helpers)
//   chart-line.js          — the main time-series line chart (renderChart)
//   chart-legacy-radar.js  — the Legacy Path radar (renderLegacyRadar)
//   chart-resources.js     — the resources stacked-area chart
//   chart-wars-gantt.js    — the conflicts Gantt timeline
//   chart-triumphs.js      — the triumph race / completion / stack views

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
export {
  collectWarCivOptions,
  renderWarsGantt
} from "/demographics/ui/screen-demographics/chart-wars-gantt.js";
export {
  renderTriumphRace,
  renderTriumphCompletion,
  collectTriumphCivOptions,
  renderTriumphStack
} from "/demographics/ui/screen-demographics/chart-triumphs.js";
