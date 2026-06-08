// chart-wars-glossary.js
//
// The Conflicts "Guide" sub-tab: a scrollable, plain-language reference for the
// eight war-cost figures and how each is computed. Driven by COST_METRICS, so it
// always matches the tooltip's rows, icons, and order; each row's prose comes
// from the metric's `glossary` LOC key. A lead-in and a sign/legend note bookend
// the rows.

import { COST_METRICS, buildCostIcon } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-cost.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";

/**
 * Build one glossary row: the metric's cost icon, its localized title, and its
 * plain-language explanation.
 * @param {{ label: string, blp: string, glossary: string }} m A cost metric.
 * @returns {HTMLElement} The row element.
 */
function buildGlossaryRow(m) {
  const row = document.createElement("div");
  row.className = "demographics-wars-glossary-row";
  if (m.blp) row.appendChild(buildCostIcon(m.blp));

  const text = document.createElement("div");
  text.className = "demographics-wars-glossary-text";
  const term = document.createElement("div");
  term.className = "demographics-wars-glossary-term";
  term.textContent = t(m.label);
  text.appendChild(term);
  const body = document.createElement("div");
  body.className = "demographics-wars-glossary-body";
  body.textContent = t(m.glossary);
  text.appendChild(body);

  row.appendChild(text);
  return row;
}

/**
 * Render the Conflicts "Guide" sub-tab into `host`.
 * @param {HTMLElement} host The chart host element (cleared and repopulated).
 * @returns {null} Always null (no chart handle).
 */
export function renderWarsGlossary(host) {
  if (!host) return null;
  clearHost(host);
  host.appendChild(buildGlossaryPanel());
  return null;
}

/**
 * Remove all children from `host`.
 * @param {HTMLElement} host The container to clear.
 */
function clearHost(host) {
  while (host.firstChild) host.removeChild(host.firstChild);
}

/**
 * Build the full glossary panel contents.
 * @returns {HTMLElement} The panel element.
 */
function buildGlossaryPanel() {
  const panel = document.createElement("div");
  panel.className = "demographics-wars-glossary";
  panel.appendChild(buildIntro());
  panel.appendChild(buildGlossaryGrid());
  panel.appendChild(buildNote());
  return panel;
}

/**
 * Build the glossary intro blurb.
 * @returns {HTMLElement} Intro element.
 */
function buildIntro() {
  const intro = document.createElement("div");
  intro.className = "demographics-wars-glossary-intro";
  intro.textContent = t("LOC_DEMOGRAPHICS_WARS_GLOSSARY_INTRO");
  return intro;
}

/**
 * Build the grid of glossary rows.
 * @returns {HTMLElement} Grid element.
 */
function buildGlossaryGrid() {
  const grid = document.createElement("div");
  grid.className = "demographics-wars-glossary-grid";
  for (const m of COST_METRICS) grid.appendChild(buildGlossaryRow(m));
  return grid;
}

/**
 * Build the glossary closing note.
 * @returns {HTMLElement} Note element.
 */
function buildNote() {
  const note = document.createElement("div");
  note.className = "demographics-wars-glossary-note";
  note.textContent = t("LOC_DEMOGRAPHICS_WARS_GLOSSARY_NOTE");
  return note;
}
