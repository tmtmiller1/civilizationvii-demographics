// view-settlements-civranking.js
//
// Civilization-ranking sub-view rendering for the Settlements view.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { div, fmt, fmtPop, iconEl } from "/demographics/ui/core/ui-helpers.js";
import { orderedNames } from "/demographics/ui/core/player-label.js";
import {
  SETTLEMENT_OUTPUTS
} from "/demographics/ui/screen-demographics/settlements/settlements-data.js";

/**
 * @typedef {{
 *   buildEmpty: () => HTMLElement,
 *   buildSectionTitle: (key: string) => HTMLElement,
 *   buildListHeader: (nameKey?: string) => HTMLElement,
 *   buildOwnerAvatar: (owner: *) => HTMLElement,
 *   buildOutputStrip: (s: *) => HTMLElement,
 *   buildLaurelMedal: (place: number) => HTMLElement,
 *   maskOwner: (owner: *) => *
 * }} CivRankingDeps
 */

/**
 * Fold one settlement into its owner civ's cumulative aggregate (major civs
 * only). Sums composite score, settlement count, population, and every output.
 * @param {Record<string, *>} map pid -> civ aggregate (mutated).
 * @param {*} s The settlement.
 */
function aggregateCiv(map, s) {
  if (!s.owner || !s.owner.isMajor) return;
  const pid = typeof s.owner.pid === "number" ? s.owner.pid : -1;
  const c = map[pid] || (map[pid] = newCivAgg(pid, s.owner));
  c.count += 1;
  c.populationEstimate += num(s.populationEstimate);
  for (const col of SETTLEMENT_OUTPUTS) {
    c.outputs[col.id] = (c.outputs[col.id] || 0) + num(s.outputs[col.id]);
  }
}

/**
 * A fresh civ aggregate record.
 * @param {number} pid Owner id.
 * @param {*} owner Owner identity.
 * @returns {*} The empty aggregate.
 */
function newCivAgg(pid, owner) {
  return {
    pid,
    owner,
    name: orderedNames(owner.leaderName, owner.civName)[0] || "—",
    score: 0,
    count: 0,
    populationEstimate: 0,
    outputs: {}
  };
}

/**
 * A finite number, or 0.
 * @param {*} v The value.
 * @returns {number} The number, or 0.
 */
function num(v) {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

/**
 * A civ's total output: the sum of its settlements' economic yields (food,
 * production, gold, science, culture). Population/happiness and wonder count
 * are excluded.
 * @param {Record<string, number>} outputs The civ's summed outputs.
 * @returns {number} The total output.
 */
function civTotalOutput(outputs) {
  let total = 0;
  for (const col of SETTLEMENT_OUTPUTS) {
    if (col.composite && col.yt) total += num(outputs[col.id]);
  }
  return total;
}

/**
 * Build the civilization ranking board.
 * @param {*[]} settlements The scored settlement list.
 * @returns {*[]} The ranked civ aggregates.
 */
function buildCivBoard(settlements) {
  /** @type {Record<string, *>} */
  const map = {};
  for (const s of settlements) aggregateCiv(map, s);
  const civs = Object.keys(map).map((k) => map[k]);
  for (const c of civs) c.score = civTotalOutput(c.outputs);
  civs.sort((a, b) => b.score - a.score);
  const max = civs.length ? civs[0].score : 0;
  for (let i = 0; i < civs.length; i++) {
    civs[i].rank = i + 1;
    civs[i].scorePct = max > 0 ? (civs[i].score / max) * 100 : 0;
  }
  return civs;
}

/**
 * Obscure an unmet civ's identity when "hide unmet players" is on.
 * @param {*} st The render state.
 * @param {*} c The civ aggregate.
 * @param {CivRankingDeps} deps Rendering dependencies.
 * @returns {*} The civ to render (masked clone when applicable).
 */
function civDisplay(st, c, deps) {
  if (st.showUnmetNames || !c.owner || c.owner.met !== false) return c;
  return Object.assign({}, c, {
    name: t("LOC_DEMOGRAPHICS_UNMET_CIV"),
    owner: deps.maskOwner(c.owner),
    masked: true
  });
}

/**
 * Build a civ's score bar (fill = score% of the leader; owner-colored).
 * @param {*} c The civ aggregate.
 * @returns {HTMLElement} The bar element.
 */
function buildCivScoreBar(c) {
  const bar = div("demographics-settle-bar");
  const fill = div("demographics-settle-bar-fill");
  fill.style.width = Math.max(0, Math.min(100, c.scorePct)) + "%";
  fill.style.backgroundColor =
    c.owner.readable || c.owner.primary || "rgba(243, 195, 76, 0.85)";
  bar.appendChild(fill);
  return bar;
}

/**
 * Build a civ meta line: total population + settlement count.
 * @param {*} c The civ aggregate.
 * @returns {HTMLElement} The meta line.
 */
function buildCivMeta(c) {
  const meta = div("demographics-settle-citymeta");
  const pop = div("demographics-settle-citypop");
  pop.appendChild(iconEl("blp:Yield_Population", "demographics-settle-yield-icon"));
  pop.appendChild(div("demographics-settle-citypop-val", fmtPop(c.populationEstimate)));
  meta.appendChild(pop);
  const cities = div("demographics-settle-citypop");
  cities.appendChild(iconEl("blp:Yield_Cities", "demographics-settle-yield-icon"));
  cities.appendChild(div("demographics-settle-citypop-val", String(c.count)));
  meta.appendChild(cities);
  return meta;
}

/**
 * Build one civ podium card (gold/silver/bronze laurel + cumulative score).
 * @param {*} c The civ aggregate.
 * @param {number} place 1-based podium place.
 * @param {*} st The render state.
 * @param {CivRankingDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The card element.
 */
function buildCivPodiumCard(c, place, st, deps) {
  c = civDisplay(st, c, deps);
  const card = div("demographics-settle-podium-card demographics-settle-rank-" + place);
  if (c.owner.readable || c.owner.primary) {
    card.style.borderColor = c.owner.readable || c.owner.primary;
  }
  // Horizontal card: [medal + avatar] · [name / owner / meta] · [score].
  const left = div("demographics-settle-podium-left");
  left.appendChild(deps.buildLaurelMedal(place));
  left.appendChild(deps.buildOwnerAvatar(c.owner));
  card.appendChild(left);

  const body = div("demographics-settle-podium-body");
  body.appendChild(div("demographics-settle-podium-name", c.name));
  body.appendChild(div("demographics-settle-podium-owner", orderedNames(c.owner.leaderName, c.owner.civName)[1]));
  body.appendChild(buildCivMeta(c));
  card.appendChild(body);

  const scoreCol = div("demographics-settle-podium-scorecol");
  scoreCol.appendChild(div("demographics-settle-podium-score", fmt(c.score)));
  card.appendChild(scoreCol);
  return card;
}

/**
 * Build one civ ranked-list row.
 * @param {*} c The civ aggregate.
 * @param {*} st The render state.
 * @param {CivRankingDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The row element.
 */
function buildCivRow(c, st, deps) {
  c = civDisplay(st, c, deps);
  const row = div("demographics-settle-list-row");
  if (c.owner.readable || c.owner.primary) {
    row.style.setProperty("border-left-color", c.owner.readable || c.owner.primary);
  }
  row.appendChild(div("demographics-settle-list-rank", String(c.rank)));
  row.appendChild(deps.buildOwnerAvatar(c.owner));
  const mid = div("demographics-settle-list-mid");
  const nameRow = div("demographics-settle-list-namerow");
  nameRow.appendChild(div("demographics-settle-list-name", c.name));
  mid.appendChild(nameRow);
  mid.appendChild(buildCivMeta(c));
  mid.appendChild(buildCivScoreBar(c));
  row.appendChild(mid);
  row.appendChild(div("demographics-settle-list-score", fmt(c.score)));
  return row;
}

/**
 * Build the civ top-3 podium (visual order 2-1-3).
 * @param {*[]} top The top civ aggregates.
 * @param {*} st The render state.
 * @param {CivRankingDeps} deps Rendering dependencies.
 * @param {boolean} [vertical] Stack gold→bronze top-to-bottom (left-column layout).
 * @returns {HTMLElement} The podium element.
 */
function buildCivPodium(top, st, deps, vertical) {
  const podium = div("demographics-settle-podium");
  // Horizontal podium centers the winner (2-1-3); the vertical (left-column)
  // layout reads top-to-bottom, so emit gold → silver → bronze instead.
  const order = vertical ? [top[0], top[1], top[2]] : [top[1], top[0], top[2]];
  const places = vertical ? [1, 2, 3] : [2, 1, 3];
  for (let i = 0; i < order.length; i++) {
    if (order[i]) {
      podium.appendChild(buildCivPodiumCard(order[i], places[i], st, deps));
    }
  }
  return podium;
}

/**
 * Render the Civilization Ranking sub-view.
 * @param {*} st The render state.
 * @param {CivRankingDeps} deps Rendering dependencies.
 */
export function renderCivRankingPanel(st, deps) {
  const civs = buildCivBoard(st.board.settlements);
  if (!civs.length) {
    st.content.appendChild(deps.buildEmpty());
    return;
  }
  // Two-column layout: podium + score note (left) beside the full ranked list
  // (right) so the wide window's horizontal space is used.
  const split = div("demographics-settle-split");
  const left = div("demographics-settle-split-left");
  left.appendChild(deps.buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_CIV_PODIUM_TITLE"));
  left.appendChild(div("demographics-settle-note", t("LOC_DEMOGRAPHICS_SETTLEMENTS_CIV_SCORE_NOTE")));
  left.appendChild(buildCivPodium(civs.slice(0, 3), st, deps, true));
  split.appendChild(left);

  const right = div("demographics-settle-split-right");
  right.appendChild(deps.buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_CIV_RANKING_TITLE"));
  const list = div("demographics-settle-list");
  list.appendChild(deps.buildListHeader("LOC_DEMOGRAPHICS_SETTLEMENTS_COL_CIV"));
  for (const c of civs) list.appendChild(buildCivRow(c, st, deps));
  right.appendChild(list);
  split.appendChild(right);

  st.content.appendChild(split);
}
