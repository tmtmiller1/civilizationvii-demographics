// history-pages.js
//
// The Historical Data page catalogue and the metric-renderability predicates.
//
// This is a LEAF module: it imports nothing from view-history.js, which breaks
// an import cycle with history-tabs.js. view-history.js re-exports both names.

import { SYNTHETIC_METRICS } from "/demographics/ui/screen-demographics/views/history/history-synthetic-metrics.js";
import { getMetric } from "/demographics/ui/metrics/demographics-metrics.js";

/**
 * One Historical Data page. `metrics` pages list metric ids; a RENDER page instead
 * carries a `render` function, injected by view-history.js via setPageRenderer().
 * Companion mods also push pages here at runtime, so hub/tier/metrics are optional.
 * @typedef {Object} HistoryPage
 * @property {string} id Page id.
 * @property {string} label Localization tag for the tab label.
 * @property {string} [hub] Owning hub id (e.g. "statistics", "geopolitics").
 * @property {string} [tier] Disclosure tier ("basic" | "standard" | ...).
 * @property {string[]} [metrics] Metric ids shown on the page.
 * @property {(host: HTMLElement, ctx: *) => void} [render] Custom renderer for a RENDER
 *   page. EXCLUSIVE with `metrics`.
 */

/** @type {HistoryPage[]} */
export const PAGES = [
  // ── GLOBAL STATISTICS hub ───────────────────────────────────────────────
  {
    // All per-turn output rates in one place (stock/flow split from Economy):
    // Food · Production · Gold · Science · Culture · Happiness · Influence.
    id: "yields",
    label: "LOC_DEMOGRAPHICS_PAGE_YIELDS",
    hub: "statistics",
    tier: "basic",
    metrics: ["gpt", "production", "crops", "science_yield", "culture_yield", "influence", "hpt"]
  },
  {
    // Economy & Resources: wealth stocks (GDP, Treasury, Trade) then the strategic
    // resource-allocation charts (page-level stacked mix + per-class comparisons).
    // Keeps id "economy" so the default landing page stays valid.
    id: "economy",
    label: "LOC_DEMOGRAPHICS_PAGE_ECONOMY_RESOURCES",
    hub: "statistics",
    tier: "basic",
    metrics: ["gdp", "gold", "trade", "resources_total", "resources_stack", "resources_bonus",
      "resources_empire", "resources_city", "resources_factory", "resources_treasure"]
  },
  {
    // Society & culture: social standing, culture-collection, the wonder group, and the
    // Legacy Path triumph radar (legacy_radar).
    id: "society",
    label: "LOC_DEMOGRAPHICS_PAGE_SOCIETY",
    hub: "statistics",
    tier: "basic",
    metrics: ["faith", "tourism", "great_people", "great_works", "techs", "civics",
      "wonders", "wonders_board", "wonder_races", "natural_wonders", "legacy_radar"]
  },
  {
    // Religion: spread + by-population over time (line charts) + current standings.
    id: "religion",
    label: "LOC_DEMOGRAPHICS_PAGE_RELIGION",
    hub: "statistics",
    tier: "standard",
    // Antiquity shows the pantheons chosen; Exploration/Modern show the founded-religion
    // standings/spread/by-population charts. The age gate (history-tabs.js) hides whichever
    // set doesn't apply, so only one "Religion" pill is ever visible for the current age.
    metrics: ["religion_pantheons", "religion_pantheon_yields", "religion_standings",
      "religion_spread", "religion_by_pop"]
  },
  {
    // Empire footprint: settlement counts/cap, land area, the size histogram, and the
    // by-type construction boards (buildings/districts).
    id: "settlements_land",
    label: "LOC_DEMOGRAPHICS_PAGE_SETTLEMENTS_LAND",
    hub: "statistics",
    tier: "basic",
    metrics: ["land", "land_share_area", "settlements", "settlements_atlas", "settlement_cap_pct",
      "settlement_cap", "cities", "towns", "districts_type", "buildings_type"]
  },

  // ── MIGRATION hub ───────────────────────────────────────────────────────
  {
    // Population is the Migration hub's headline + anchor. Standalone Demographics shows
    // only this; a companion mod injects the rest of the hub after it.
    id: "population",
    label: "LOC_DEMOGRAPHICS_PAGE_POPULATION",
    hub: "migration",
    tier: "basic",
    metrics: ["population"]
  },

  // ── GEOPOLITICS hub ─────────────────────────────────────────────────────
  {
    // "Global Relations": a RENDER page. First in the hub + the default page loaded when
    // Geopolitics is selected.
    id: "relations",
    label: "LOC_DEMOGRAPHICS_PAGE_RELATIONS",
    hub: "geopolitics",
    tier: "basic"
    // `render` is injected by view-history.js via setPageRenderer() below —
    // binding it here would make this leaf import view-history.js and recreate
    // the very cycle this module exists to break.
  },
  {
    id: "agreements", label: "LOC_DEMOGRAPHICS_PAGE_AGREEMENTS",
    hub: "geopolitics", tier: "standard", metrics: ["approval", "deals"]
  },
  {
    // The current age's crisis, broken into stages with a per-civ cost section.
    id: "crises",
    label: "LOC_DEMOGRAPHICS_PAGE_CRISES",
    hub: "geopolitics",
    tier: "standard",
    metrics: ["crisis_stages", "crisis_graphs"]
  },
  {
    // "Soft Power" dashboard: Score, the Score rank-race, the Fingerprint scatters
    // (civ_scatter/scatter_*), and the Archetype radar. Placed after Crises. tier
    // omitted ⇒ standard.
    id: "power",
    label: "LOC_DEMOGRAPHICS_PAGE_POWER",
    hub: "geopolitics",
    metrics: ["score", "power_race", "civ_scatter", "scatter_wealth_culture", "scatter_soft_power",
      "power_radar"]
  },
  {
    // "Military Power": strength, kills/losses, combats, wars, conquest, by-type breakdowns.
    id: "military",
    label: "LOC_DEMOGRAPHICS_PAGE_MILITARY",
    hub: "geopolitics",
    tier: "basic",
    // War Timeline (wars_gantt) + War Impact (war_graphs).
    metrics: ["milpower", "units_killed", "units_lost", "combats", "wars_declared", "wars_received",
      "settlements_conquered", "conquest_pct", "wars_gantt", "war_graphs",
      "units_trained_type", "units_killed_type", "units_lost_type"]
  }
];

/**
 * Whether `id` names a synthetic metric routed to a custom renderer.
 * @param {string} id Metric id.
 * @returns {boolean} True if synthetic.
 */
export function isSynthetic(id) {
  return Object.prototype.hasOwnProperty.call(SYNTHETIC_METRICS, id);
}

/**
 * Whether `id` is renderable - a synthetic metric or a real METRICS entry.
 * @param {string} id Metric id.
 * @returns {boolean} True if renderable.
 */
export function metricExists(id) {
  if (isSynthetic(id)) return true;
  const metric = getMetric(id);
  return !!metric && metric.id === id;
}

/**
 * Attach a render function to a page entry. The Geopolitics "relations" page is a
 * RENDER page whose renderer lives in view-history.js; view-history injects it at
 * module load so this module can stay a leaf.
 * @param {string} pageId The page id to bind.
 * @param {(host: HTMLElement, ctx: *) => void} render The render function.
 * @returns {boolean} True when a matching page was found and bound.
 */
export function setPageRenderer(pageId, render) {
  for (const page of PAGES) {
    if (page && page.id === pageId) {
      page.render = render;
      return true;
    }
  }
  return false;
}
