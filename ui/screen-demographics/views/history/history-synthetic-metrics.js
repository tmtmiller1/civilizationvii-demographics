// history-synthetic-metrics.js
//
// Registry of SYNTHETIC metrics: ids that route to a custom chart renderer
// (radar, stacked area, wars/crises) instead of the line-chart pipeline. Kept
// in its own module so view-history.js stays under the 500-line file cap.
//
// The object is intentionally MUTABLE and shared by reference: view-history's
// mergeMetricGroups / companion-panel merge add entries to it at render time.
// Importers must mutate this same object, never replace it.

/**
 * Metadata for a synthetic metric that routes to a custom chart renderer.
 * @typedef {Object} SyntheticMeta
 * @property {string} label Short tab label.
 * @property {string} title Chart title text (a LOC key, localized at render).
 * @property {string} [subtitle] Optional parenthetical subtitle line (LOC key).
 */

/** @type {Record<string, SyntheticMeta>} */
export const SYNTHETIC_METRICS = {
  legacy_radar: {
    label: "Radar",
    title: "LOC_DEMOGRAPHICS_SYNTH_RADAR_TITLE"
  },
  resources_stack: {
    label: "Stacked",
    title: "LOC_DEMOGRAPHICS_SYNTH_RESOURCES_TITLE"
  },
  wars_gantt: {
    label: "Wars",
    title: "LOC_DEMOGRAPHICS_SYNTH_WARS_TITLE"
  },
  war_graphs: {
    label: "War Graphs",
    title: "LOC_DEMOGRAPHICS_SYNTH_WAR_GRAPHS_TITLE"
  },
  crisis_stages: {
    label: "Crises",
    title: "LOC_DEMOGRAPHICS_SYNTH_CRISIS_TITLE"
  },
  crisis_graphs: {
    label: "Graphs",
    title: "LOC_DEMOGRAPHICS_SYNTH_CRISIS_GRAPHS_TITLE"
  },
  wonders_board: {
    label: "Wonders Board",
    title: "LOC_DEMOGRAPHICS_SYNTH_WONDERS_BOARD_TITLE"
  },
  wonder_races: {
    label: "Wonder Races",
    title: "LOC_DEMOGRAPHICS_SYNTH_WONDER_RACES_TITLE"
  },
  units_trained_type: {
    label: "Units Trained",
    title: "LOC_DEMOGRAPHICS_SYNTH_UNITS_TRAINED_TYPE_TITLE"
  },
  units_killed_type: {
    label: "Kills by Unit",
    title: "LOC_DEMOGRAPHICS_SYNTH_UNITS_KILLED_TYPE_TITLE"
  },
  units_lost_type: {
    label: "Losses by Unit",
    title: "LOC_DEMOGRAPHICS_SYNTH_UNITS_LOST_TYPE_TITLE"
  },
  buildings_type: {
    label: "Buildings",
    title: "LOC_DEMOGRAPHICS_SYNTH_BUILDINGS_TYPE_TITLE"
  },
  districts_type: {
    label: "Districts",
    title: "LOC_DEMOGRAPHICS_SYNTH_DISTRICTS_TYPE_TITLE"
  },
  religion_spread: {
    label: "Spread",
    title: "LOC_DEMOGRAPHICS_SYNTH_RELIGION_SPREAD_TITLE"
  },
  religion_by_pop: {
    label: "By Population",
    title: "LOC_DEMOGRAPHICS_SYNTH_RELIGION_BY_POP_TITLE"
  },
  religion_standings: {
    label: "Standings",
    title: "LOC_DEMOGRAPHICS_SYNTH_RELIGION_STANDINGS_TITLE"
  },
  religion_pantheons: {
    label: "Religion",
    title: "LOC_DEMOGRAPHICS_SYNTH_RELIGION_PANTHEONS_TITLE"
  },
  religion_pantheon_yields: {
    label: "Pantheon Yields",
    title: "LOC_DEMOGRAPHICS_SYNTH_RELIGION_PANTHEON_YIELDS_TITLE",
    subtitle: "LOC_DEMOGRAPHICS_SYNTH_RELIGION_PANTHEON_YIELDS_SUBTITLE"
  },
  settlements_atlas: {
    label: "Settlement Sizes",
    title: "LOC_DEMOGRAPHICS_SYNTH_SETTLEMENTS_ATLAS_TITLE"
  },
  power_race: {
    label: "Power Race",
    title: "LOC_DEMOGRAPHICS_SYNTH_POWER_RACE_TITLE"
  },
  pop_share_area: {
    label: "Population Share",
    title: "LOC_DEMOGRAPHICS_SYNTH_POP_SHARE_AREA_TITLE"
  },
  land_share_area: {
    label: "Land Area Share",
    title: "LOC_DEMOGRAPHICS_SYNTH_LAND_SHARE_AREA_TITLE"
  },
  civ_scatter: {
    label: "Fingerprint",
    title: "LOC_DEMOGRAPHICS_SYNTH_CIV_SCATTER_TITLE"
  },
  scatter_wealth_culture: {
    label: "Wealth & Culture",
    title: "LOC_DEMOGRAPHICS_SYNTH_SCATTER_WEALTH_CULTURE_TITLE"
  },
  scatter_soft_power: {
    label: "Soft Power",
    title: "LOC_DEMOGRAPHICS_SYNTH_SCATTER_SOFT_POWER_TITLE"
  },
  power_radar: {
    label: "Archetype",
    title: "LOC_DEMOGRAPHICS_SYNTH_POWER_RADAR_TITLE"
  }
};
