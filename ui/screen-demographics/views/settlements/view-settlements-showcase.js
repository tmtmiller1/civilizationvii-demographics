// view-settlements-showcase.js
//
// Showcase (Top-25) rendering for the Settlements view.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { div, fmt, fmtPop, iconEl } from "/demographics/ui/core/ui-helpers.js";
import { orderedNames } from "/demographics/ui/core/player-label.js";

/**
 * @typedef {{
 *   topN: number,
 *   safePlaySound: (id: string) => void,
 *   rerenderContent: (st: *) => void,
 *   displayOf: (st: *, s: *) => *,
 *   buildLaurelMedal: (place: number) => HTMLElement,
 *   buildOwnerAvatar: (owner: *) => HTMLElement,
 *   buildOutputStrip: (s: *) => HTMLElement,
 *   buildTypeBadge: (isTown: boolean) => HTMLElement,
 *   buildCameraButtons: (s: *, st: *) => (HTMLElement|null),
 *   buildSectionTitle: (key: string) => HTMLElement,
 *   buildListHeader: (nameKey?: string) => HTMLElement,
 *   buildEmpty: () => HTMLElement,
 *   buildTrendGlyph: (trend: *) => HTMLElement
 * }} ShowcaseDeps
 */

/**
 * Build the horizontal wonder-icon row beneath a city name.
 * @param {*} s The settlement.
 * @returns {HTMLElement|null} The row, or null.
 */
function buildWonderRow(s) {
  const wonders = Array.isArray(s.wonders) ? s.wonders : [];
  const row = div("demographics-settle-wonders");
  for (const w of wonders) {
    if (!w || !w.icon) continue;
    const ic = iconEl(w.icon, "demographics-settle-wonder-icon");
    if (w.nameKey) ic.setAttribute("data-tooltip-content", w.nameKey);
    row.appendChild(ic);
  }
  return row.firstChild ? row : null;
}

/**
 * The founded-year text, distinguishing exact from approximate foundings.
 * @param {*} s The settlement.
 * @returns {string} The founded text (or "").
 */
function foundedText(s) {
  const f = s.founded;
  if (!f || !f.year) return "";
  return t(
    f.exact
      ? "LOC_DEMOGRAPHICS_SETTLEMENTS_FOUNDED"
      : "LOC_DEMOGRAPHICS_SETTLEMENTS_FOUNDED_APPROX",
    f.year
  );
}

/**
 * Build the city meta line.
 * @param {*} s The settlement.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The meta line.
 */
function buildCityMeta(s, deps) {
  const meta = div("demographics-settle-citymeta");
  const popWrap = div("demographics-settle-citypop");
  popWrap.appendChild(iconEl("blp:Yield_Population", "demographics-settle-yield-icon"));
  popWrap.appendChild(div("demographics-settle-citypop-val", fmtPop(s.populationEstimate)));
  popWrap.appendChild(deps.buildTrendGlyph(s.trend));
  meta.appendChild(popWrap);
  const ft = foundedText(s);
  if (ft) meta.appendChild(div("demographics-settle-founded", ft));
  return meta;
}

/**
 * Build a civ-colored composite score bar.
 * @param {*} s The settlement.
 * @returns {HTMLElement} The bar element.
 */
function buildScoreBar(s) {
  const bar = div("demographics-settle-bar");
  const fill = div("demographics-settle-bar-fill");
  fill.style.width = Math.max(0, Math.min(100, s.composite)) + "%";
  fill.style.backgroundColor =
    s.owner.readable || s.owner.primary || "rgba(243, 195, 76, 0.85)";
  bar.appendChild(fill);
  return bar;
}

/**
 * Build a podium card's body column (name / owner / meta + map & cinematic buttons).
 * @param {*} s The settlement.
 * @param {*} st The render state.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The body element.
 */
function buildPodiumBody(s, st, deps) {
  const body = div("demographics-settle-podium-body");
  body.appendChild(div("demographics-settle-podium-name", s.name));
  // Three-line ownership hierarchy (player feedback): Settlement (primary) /
  // Civilization (medium) / Leader (smallest, lightest), so the owning civ of a
  // lesser-known settlement is visible while the settlement stays the focus.
  // Show each line only when present so masked/unowned rows aren't left blank.
  const [podPrimary, podSecondary] = orderedNames(s.owner.leaderName, s.owner.civName);
  if (podPrimary) {
    body.appendChild(div("demographics-settle-podium-civ", podPrimary));
  }
  if (podSecondary) {
    body.appendChild(div("demographics-settle-podium-owner", podSecondary));
  }
  body.appendChild(buildCityMeta(s, deps));
  const cams = deps.buildCameraButtons(s, st);
  if (cams) body.appendChild(cams);
  return body;
}

/**
 * Build one podium card for a top-3 settlement.
 * @param {*} s The settlement.
 * @param {number} place 1-based podium place.
 * @param {*} st The render state.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The card element.
 */
function buildPodiumCard(s, place, st, deps) {
  s = deps.displayOf(st, s);
  const card = div("demographics-settle-podium-card demographics-settle-rank-" + place);
  if (s.owner.readable || s.owner.primary) {
    card.style.borderColor = s.owner.readable || s.owner.primary;
  }
  // Horizontal card: [medal + avatar] · [name / owner / meta] · [score + type].
  const left = div("demographics-settle-podium-left");
  left.appendChild(deps.buildLaurelMedal(place));
  left.appendChild(deps.buildOwnerAvatar(s.owner));
  card.appendChild(left);

  card.appendChild(buildPodiumBody(s, st, deps));

  const scoreCol = div("demographics-settle-podium-scorecol");
  scoreCol.appendChild(div("demographics-settle-podium-score", fmt(s.composite)));
  scoreCol.appendChild(deps.buildTypeBadge(s.isTown));
  card.appendChild(scoreCol);

  return card;
}

/**
 * Build the showcase row's middle column.
 * @param {*} s The settlement.
 * @param {*} st The render state.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The middle-column element.
 */
function buildShowcaseMid(s, st, deps) {
  const mid = div("demographics-settle-list-mid");
  const nameRow = div("demographics-settle-list-namerow");
  nameRow.appendChild(div("demographics-settle-list-name", s.name));
  nameRow.appendChild(deps.buildTypeBadge(s.isTown));
  if (s.isCapital) {
    nameRow.appendChild(
      div(
        "demographics-settle-badge demographics-settle-badge-city",
        t("LOC_DEMOGRAPHICS_SETTLEMENTS_CAPITAL")
      )
    );
  }
  const cams = deps.buildCameraButtons(s, st);
  if (cams) nameRow.appendChild(cams);
  mid.appendChild(nameRow);
  // Owning civilization beneath the settlement name (player feedback): the
  // ranked list mixes many civs' settlements, and the avatar disc alone doesn't
  // say which civ a lesser-known settlement belongs to.
  const [listPrimary] = orderedNames(s.owner.leaderName, s.owner.civName);
  if (listPrimary) {
    mid.appendChild(div("demographics-settle-list-civ", listPrimary));
  }
  const wr = buildWonderRow(s);
  if (wr) mid.appendChild(wr);
  mid.appendChild(buildCityMeta(s, deps));
  // Per-yield breakdown inline (folds in the old detail dossier so it isn't a
  // separate view), then the composite score bar.
  mid.appendChild(deps.buildOutputStrip(s));
  mid.appendChild(buildScoreBar(s));
  return mid;
}

/**
 * Build one ranked-list row of the showcase.
 * @param {*} s The settlement.
 * @param {*} st The render state.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The row element.
 */
function buildShowcaseRow(s, st, deps) {
  s = deps.displayOf(st, s);
  const row = div("demographics-settle-list-row");
  if (s.owner.readable || s.owner.primary) {
    row.style.setProperty("border-left-color", s.owner.readable || s.owner.primary);
  }
  row.appendChild(div("demographics-settle-list-rank", String(s.ranks.composite)));
  row.appendChild(deps.buildOwnerAvatar(s.owner));
  row.appendChild(buildShowcaseMid(s, st, deps));
  row.appendChild(div("demographics-settle-list-score", fmt(s.composite)));
  return row;
}

/**
 * Build the top-3 podium (visual order 2-1-3).
 * @param {*[]} top The composite-sorted top settlements.
 * @param {*} st The render state.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @param {boolean} [vertical] Stack gold→bronze top-to-bottom (left-column layout).
 * @returns {HTMLElement} The podium element.
 */
function buildPodium(top, st, deps, vertical) {
  const podium = div("demographics-settle-podium");
  // Horizontal podium centers the winner (2-1-3); the vertical (left-column)
  // layout reads top-to-bottom, so emit gold → silver → bronze instead.
  const order = vertical ? [top[0], top[1], top[2]] : [top[1], top[0], top[2]];
  const places = vertical ? [1, 2, 3] : [2, 1, 3];
  for (let i = 0; i < order.length; i++) {
    if (order[i]) podium.appendChild(buildPodiumCard(order[i], places[i], st, deps));
  }
  return podium;
}

/**
 * Render the artistic Top-25 showcase.
 * @param {*} st The render state.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 */
export function renderShowcasePanel(st, deps) {
  const top = st.board.settlements.slice(0, deps.topN);
  if (!top.length) {
    st.content.appendChild(deps.buildEmpty());
    return;
  }
  // Two-column layout: the podium (left) beside the full ranked list (right) so
  // the wide window's space is used instead of stacking everything vertically.
  const split = div("demographics-settle-split");
  const left = div("demographics-settle-split-left");
  left.appendChild(deps.buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_PODIUM_TITLE"));
  left.appendChild(buildPodium(top, st, deps, true));
  split.appendChild(left);

  const right = div("demographics-settle-split-right");
  right.appendChild(deps.buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_RANKING_TITLE"));
  right.appendChild(buildShowcaseList(top, st, deps));
  split.appendChild(right);

  st.content.appendChild(split);
}

/**
 * Build the full ranked showcase list (header + rows + the "top 10" divider).
 * @param {*[]} top The composite-sorted top settlements.
 * @param {*} st The render state.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The list element.
 */
function buildShowcaseList(top, st, deps) {
  const list = div("demographics-settle-list");
  list.appendChild(deps.buildListHeader());
  for (let i = 0; i < top.length; i++) {
    list.appendChild(buildShowcaseRow(top[i], st, deps));
    if (i === 9 && top.length > 10) {
      list.appendChild(div("demographics-settle-top10", t("LOC_DEMOGRAPHICS_SETTLEMENTS_TOP10")));
    }
  }
  return list;
}
