// view-settlements-civranking.js
//
// Civilization-ranking sub-view rendering for the Settlements view.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { buildNameLine, div, formatRounded, formatPopulation, iconEl } from "/demographics/ui/core/ui-helpers.js";
import { orderedNames } from "/demographics/ui/core/player-label.js";
import { SETTLEMENT_OUTPUTS } from "/demographics/ui/screen-demographics/settlements/settlements-data.js";
import {
  buildRankCell,
  rankedRowClass
} from "/demographics/ui/screen-demographics/views/settlements/view-settlements-showcase.js";
import { finiteOrZero } from "/demographics/ui/screen-demographics/screen/guarded-reads.js";

/**
 * @typedef {{
 *   buildEmpty: () => HTMLElement,
 *   buildSectionTitle: (key: string) => HTMLElement,
 *   buildListHeader: (nameKey?: string) => HTMLElement,
 *   buildOwnerAvatar: (owner: *) => HTMLElement,
 *   buildOutputStrip: (settlement: *) => HTMLElement,
 *   buildLaurelMedal: (place: number) => HTMLElement,
 *   buildCameraButtons: (settlement: *, state: *) => (HTMLElement|null),
 *   maskOwner: (owner: *) => *
 * }} CivRankingDeps
 */

/**
 * @param {Record<string, *>} map
 * @param {*} settlement
 */
function aggregateCiv(map, settlement) {
  if (!settlement.owner || !settlement.owner.isMajor) return;
  const pid = typeof settlement.owner.pid === "number" ? settlement.owner.pid : -1;
  const civ = map[pid] || (map[pid] = newCivAgg(pid, settlement.owner));
  civ.count += 1;
  civ.populationEstimate += finiteOrZero(settlement.populationEstimate);
  if (settlement.isCapital && !civ.capital) civ.capital = settlement;
  for (const col of SETTLEMENT_OUTPUTS) {
    civ.outputs[col.id] = (civ.outputs[col.id] || 0) + finiteOrZero(settlement.outputs[col.id]);
  }
}

/**
 * @param {number} pid
 * @param {*} owner
 */
function newCivAgg(pid, owner) {
  return {
    pid,
    owner,
    name: orderedNames(owner.leaderName, owner.civName)[0] || "—",
    score: 0,
    count: 0,
    populationEstimate: 0,
    outputs: {},
    ranks: {},
    capital: null
  };
}

/**
 * A civ's total output: the sum of its settlements' economic yields (food,
 * production, gold, science, culture). Population/happiness and wonder count
 * are excluded.
 * @param {Record<string, number>} outputs The civ's summed outputs.
 * @returns {number}
 */
function civTotalOutput(outputs) {
  let total = 0;
  for (const col of SETTLEMENT_OUTPUTS) {
    if (col.composite && col.yieldType) total += finiteOrZero(outputs[col.id]);
  }
  return total;
}

/** @param {*[]} settlements */
function buildCivBoard(settlements) {
  /** @type {Record<string, *>} */
  const map = {};
  for (const settlement of settlements) aggregateCiv(map, settlement);
  const civs = Object.keys(map).map((key) => map[key]);
  for (const civ of civs) civ.score = civTotalOutput(civ.outputs);
  civs.sort((a, b) => b.score - a.score);
  const max = civs.length ? civs[0].score : 0;
  for (let i = 0; i < civs.length; i++) {
    civs[i].rank = i + 1;
    civs[i].scorePct = max > 0 ? (civs[i].score / max) * 100 : 0;
  }
  markOutputLeaders(civs);
  return civs;
}

/**
 * Mark each civ's world-leading outputs (`ranks[output] = 1` on the civ with the
 * highest total), the same shape the Top 25 rows read for their leader icons.
 * @param {*[]} civs The civ aggregates (mutated: `ranks`).
 */
function markOutputLeaders(civs) {
  for (const col of SETTLEMENT_OUTPUTS) {
    let best = null;
    for (const civ of civs) {
      if (!best || finiteOrZero(civ.outputs[col.id]) > finiteOrZero(best.outputs[col.id])) best = civ;
    }
    if (best) best.ranks[col.id] = 1;
  }
}

/**
 * @param {*} state
 * @param {*} civ
 * @param {CivRankingDeps} deps
 */
function civDisplay(state, civ, deps) {
  if (state.showUnmetNames || !civ.owner || civ.owner.met !== false) return civ;
  return Object.assign({}, civ, {
    name: t("LOC_DEMOGRAPHICS_UNMET_CIV"),
    owner: deps.maskOwner(civ.owner),
    masked: true
  });
}

/** @param {*} civ */
function buildCivScoreBar(civ) {
  const bar = div("demographics-settle-bar");
  const fill = div("demographics-settle-bar-fill");
  fill.style.width = Math.max(0, Math.min(100, civ.scorePct)) + "%";
  fill.style.backgroundColor =
    civ.owner.readable || civ.owner.primary || "rgba(243, 195, 76, 0.85)";
  bar.appendChild(fill);
  return bar;
}

/** @param {*} civ */
function buildCivMeta(civ) {
  const meta = div("demographics-settle-citymeta");
  const pop = div("demographics-settle-citypop");
  pop.appendChild(iconEl("blp:Yield_Population", "demographics-settle-yield-icon"));
  pop.appendChild(div("demographics-settle-citypop-val", formatPopulation(civ.populationEstimate)));
  meta.appendChild(pop);
  const cities = div("demographics-settle-citypop");
  cities.appendChild(iconEl("blp:Yield_Cities", "demographics-settle-yield-icon"));
  cities.appendChild(div("demographics-settle-citypop-val", String(civ.count)));
  meta.appendChild(cities);
  return meta;
}

/**
 * Build a civ podium card's body column, line for line the Top 25 podium
 * card's: civ name, "Capital: <city>", leader, population + settlement count,
 * and the capital's map + cinematic buttons (disabled for an unmet civ).
 * @param {*} civ The (display) civ aggregate.
 * @param {*} state
 * @param {CivRankingDeps} deps
 * @returns {HTMLElement}
 */
function buildCivPodiumBody(civ, state, deps) {
  const body = div("demographics-settle-podium-body");
  body.appendChild(buildNameLine("demographics-settle-podium-name", civ.name));
  if (civ.capital) {
    const capName = civ.masked ? t("LOC_DEMOGRAPHICS_SETTLEMENTS_UNMET_NAME") : civ.capital.name;
    const capLine = t("LOC_DEMOGRAPHICS_SETTLEMENTS_CAPITAL_OF", capName);
    body.appendChild(buildNameLine("demographics-settle-podium-civ", capLine));
  }
  body.appendChild(
    buildNameLine("demographics-settle-podium-owner", orderedNames(civ.owner.leaderName, civ.owner.civName)[1])
  );
  body.appendChild(buildCivMeta(civ));
  const cams = civ.capital ? deps.buildCameraButtons(civ.capital, state) : null;
  if (cams) body.appendChild(cams);
  return body;
}

/**
 * @param {*} civ
 * @param {number} place
 * @param {*} state
 * @param {CivRankingDeps} deps
 */
function buildCivPodiumCard(civ, place, state, deps) {
  civ = civDisplay(state, civ, deps);
  const card = div("demographics-settle-podium-card demographics-settle-rank-" + place);
  if (civ.owner.readable || civ.owner.primary) {
    card.style.borderColor = civ.owner.readable || civ.owner.primary;
  }
  // Horizontal card: [medal + avatar] · [name / owner / meta] · [score].
  const left = div("demographics-settle-podium-left");
  left.appendChild(deps.buildLaurelMedal(place));
  left.appendChild(deps.buildOwnerAvatar(civ.owner));
  card.appendChild(left);

  card.appendChild(buildCivPodiumBody(civ, state, deps));

  const scoreCol = div("demographics-settle-podium-scorecol");
  scoreCol.appendChild(div("demographics-settle-podium-score", formatRounded(civ.score)));
  card.appendChild(scoreCol);
  return card;
}

/**
 * @param {*} civ
 * @param {*} state
 * @param {CivRankingDeps} deps
 */
function buildCivRow(civ, state, deps) {
  civ = civDisplay(state, civ, deps);
  const row = div(rankedRowClass("demographics-settle-list-row", civ, civ.rank));
  if (civ.owner.readable || civ.owner.primary) {
    row.style.setProperty("border-left-color", civ.owner.readable || civ.owner.primary);
  }
  row.appendChild(buildRankCell(civ.rank, civ));
  row.appendChild(deps.buildOwnerAvatar(civ.owner));
  const mid = div("demographics-settle-list-mid");
  const nameRow = div("demographics-settle-list-namerow");
  nameRow.appendChild(buildNameLine("demographics-settle-list-name", civ.name));
  mid.appendChild(nameRow);
  mid.appendChild(buildCivMeta(civ));
  mid.appendChild(buildCivScoreBar(civ));
  row.appendChild(mid);
  row.appendChild(div("demographics-settle-list-score", formatRounded(civ.score)));
  return row;
}

/**
 * @param {*[]} top
 * @param {*} state
 * @param {CivRankingDeps} deps
 * @param {boolean} [vertical]
 */
function buildCivPodium(top, state, deps, vertical) {
  const podium = div("demographics-settle-podium");
  // Horizontal podium centers the winner (2-1-3); the vertical (left-column)
  // layout reads top-to-bottom, so emit gold → silver → bronze instead.
  const order = vertical ? [top[0], top[1], top[2]] : [top[1], top[0], top[2]];
  const places = vertical ? [1, 2, 3] : [2, 1, 3];
  for (let i = 0; i < order.length; i++) {
    if (order[i]) {
      podium.appendChild(buildCivPodiumCard(order[i], places[i], state, deps));
    }
  }
  return podium;
}

/**
 * Render the Civilization Ranking sub-view.
 * @param {*} state
 * @param {CivRankingDeps} deps
 */
export function renderCivRankingPanel(state, deps) {
  const civs = buildCivBoard(state.board.settlements);
  if (!civs.length) {
    state.content.appendChild(deps.buildEmpty());
    return;
  }
  // Two-column layout: podium + score note (left) beside the full ranked list
  // (right) so the wide window's horizontal space is used.
  const split = div("demographics-settle-split");
  const left = div("demographics-settle-split-left");
  left.appendChild(deps.buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_CIV_PODIUM_TITLE"));
  left.appendChild(div("demographics-settle-note", t("LOC_DEMOGRAPHICS_SETTLEMENTS_CIV_SCORE_NOTE")));
  left.appendChild(buildCivPodium(civs.slice(0, 3), state, deps, true));
  split.appendChild(left);

  const right = div("demographics-settle-split-right");
  right.appendChild(deps.buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_CIV_RANKING_TITLE"));
  const list = div("demographics-settle-list");
  list.appendChild(deps.buildListHeader("LOC_DEMOGRAPHICS_SETTLEMENTS_COL_CIV"));
  for (const civ of civs) list.appendChild(buildCivRow(civ, state, deps));
  right.appendChild(list);
  split.appendChild(right);

  state.content.appendChild(split);
}
