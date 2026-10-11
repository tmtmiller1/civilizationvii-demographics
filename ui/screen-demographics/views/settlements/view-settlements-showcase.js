// view-settlements-showcase.js
//
// Showcase (Top-25) rendering for the Settlements view.

import { localYear, t } from "/demographics/ui/core/demographics-i18n.js";
import { div, formatRounded, formatPopulation, iconEl } from "/demographics/ui/core/ui-helpers.js";
import { orderedNames } from "/demographics/ui/core/player-label.js";
import { SETTLEMENT_OUTPUTS } from "/demographics/ui/screen-demographics/settlements/settlements-data.js";

/**
 * @typedef {{
 *   topN: number,
 *   safePlaySound: (id: string) => void,
 *   displayOf: (state: *, settlement: *) => *,
 *   buildLaurelMedal: (place: number) => HTMLElement,
 *   buildOwnerAvatar: (owner: *) => HTMLElement,
 *   buildOutputStrip: (settlement: *) => HTMLElement,
 *   buildTypeBadge: (isTown: boolean) => HTMLElement,
 *   buildCameraButtons: (settlement: *, state: *) => (HTMLElement|null),
 *   buildSectionTitle: (key: string) => HTMLElement,
 *   buildListHeader: (nameKey?: string) => HTMLElement,
 *   buildEmpty: () => HTMLElement,
 *   buildTrendGlyph: (trend: *) => HTMLElement,
 *   archive?: Array<{ age: string, label: string, year: string, top: Array<*> }>
 * }} ShowcaseDeps
 */

/**
 * Live handles to the showcase's persistent chrome. The age pills, the two filigree section
 * titles and the ranked list's header are built once; an age switch refills the podium and the
 * list rows and nothing else. Rebuilding them is what made the flourishes and the laurel medals
 * blink: a fresh element's `blp:` background resolves a frame or more after it is inserted.
 * @typedef {{
 *   chips: Map<string, HTMLElement>,
 *   split: HTMLElement|null,
 *   podium: HTMLElement|null,
 *   list: HTMLElement|null,
 *   listRows: HTMLElement[],
 *   note: HTMLElement|null,
 *   refresh: () => void
 * }} ShowcaseUi
 */

/**
 * The wonder icon's tooltip: its name, plus the completion year when one was observed.
 * @param {{ nameKey?: string, year?: string }} wonder
 * @returns {string}
 */
function wonderTooltip(wonder) {
  const name = t(wonder.nameKey || "");
  if (!wonder.year) return name;
  return name + " · " + t("LOC_DEMOGRAPHICS_SETTLEMENTS_WONDER_BUILT", localYear(wonder.year));
}

/**
 * Build the horizontal wonder-icon row beneath a city name.
 * @param {*} settlement
 * @returns {HTMLElement|null}
 */
function buildWonderRow(settlement) {
  const wonders = Array.isArray(settlement.wonders) ? settlement.wonders : [];
  const row = div("demographics-settle-wonders");
  for (const wonder of wonders) {
    if (!wonder || !wonder.icon) continue;
    const icon = iconEl(wonder.icon, "demographics-settle-wonder-icon");
    if (wonder.nameKey) icon.setAttribute("data-tooltip-content", wonderTooltip(wonder));
    row.appendChild(icon);
  }
  return row.firstChild ? row : null;
}

/**
 * The founded-year text, distinguishing exact from approximate foundings.
 * @param {*} settlement
 * @returns {string} The founded text (or "").
 */
function foundedText(settlement) {
  const founded = settlement.founded;
  if (!founded || !founded.year) return "";
  return t(
    founded.exact
      ? "LOC_DEMOGRAPHICS_SETTLEMENTS_FOUNDED"
      : "LOC_DEMOGRAPHICS_SETTLEMENTS_FOUNDED_APPROX",
    localYear(founded.year)
  );
}

/**
 * Build the city meta line.
 * @param {*} settlement
 * @param {ShowcaseDeps} deps
 * @returns {HTMLElement}
 */
function buildCityMeta(settlement, deps) {
  const meta = div("demographics-settle-citymeta");
  const popWrap = div("demographics-settle-citypop");
  popWrap.appendChild(iconEl("blp:Yield_Population", "demographics-settle-yield-icon"));
  popWrap.appendChild(div("demographics-settle-citypop-val", formatPopulation(settlement.populationEstimate)));
  // An archived (end-of-age) record has no live population window to trend.
  if (!settlement.archived) popWrap.appendChild(deps.buildTrendGlyph(settlement.trend));
  meta.appendChild(popWrap);
  const founded = foundedText(settlement);
  if (founded) meta.appendChild(div("demographics-settle-founded", founded));
  return meta;
}

/**
 * Build a civ-colored composite score bar.
 * @param {*} settlement
 * @returns {HTMLElement}
 */
function buildScoreBar(settlement) {
  const bar = div("demographics-settle-bar");
  const fill = div("demographics-settle-bar-fill");
  fill.style.width = Math.max(0, Math.min(100, settlement.composite)) + "%";
  fill.style.backgroundColor =
    settlement.owner.readable || settlement.owner.primary || "rgba(243, 195, 76, 0.85)";
  bar.appendChild(fill);
  return bar;
}

/**
 * Build a podium card's body column (name / owner / meta + map & cinematic buttons).
 * @param {*} settlement
 * @param {*} state
 * @param {ShowcaseDeps} deps
 * @returns {HTMLElement}
 */
function buildPodiumBody(settlement, state, deps) {
  const body = div("demographics-settle-podium-body");
  body.appendChild(div("demographics-settle-podium-name", settlement.name));
  // Three-line ownership hierarchy: Settlement (primary) / Civilization /
  // Leader (smallest). Each line shows only when present so masked/unowned
  // rows aren't left blank.
  const [podPrimary, podSecondary] = orderedNames(settlement.owner.leaderName, settlement.owner.civName);
  if (podPrimary) {
    body.appendChild(div("demographics-settle-podium-civ", podPrimary));
  }
  if (podSecondary) {
    body.appendChild(div("demographics-settle-podium-owner", podSecondary));
  }
  body.appendChild(buildCityMeta(settlement, deps));
  const cams = deps.buildCameraButtons(settlement, state);
  if (cams) body.appendChild(cams);
  return body;
}

/**
 * Build one podium card for a top-3 settlement.
 * @param {*} settlement
 * @param {number} place
 * @param {*} state
 * @param {ShowcaseDeps} deps
 * @returns {HTMLElement}
 */
function buildPodiumCard(settlement, place, state, deps) {
  settlement = deps.displayOf(state, settlement);
  const card = div("demographics-settle-podium-card demographics-settle-rank-" + place);
  if (settlement.owner.readable || settlement.owner.primary) {
    card.style.borderColor = settlement.owner.readable || settlement.owner.primary;
  }
  // Horizontal card: [medal + avatar] · [name / owner / meta] · [score + type].
  const left = div("demographics-settle-podium-left");
  left.appendChild(deps.buildLaurelMedal(place));
  left.appendChild(deps.buildOwnerAvatar(settlement.owner));
  card.appendChild(left);

  card.appendChild(buildPodiumBody(settlement, state, deps));

  const scoreCol = div("demographics-settle-podium-scorecol");
  scoreCol.appendChild(div("demographics-settle-podium-score", formatRounded(settlement.composite)));
  scoreCol.appendChild(deps.buildTypeBadge(settlement.isTown));
  card.appendChild(scoreCol);

  return card;
}

/**
 * Build the showcase row's name line: name, City/Town, Capital, Holy City, and
 * the camera buttons.
 * @param {*} settlement
 * @param {*} state
 * @param {ShowcaseDeps} deps
 * @returns {HTMLElement}
 */
function buildShowcaseNameRow(settlement, state, deps) {
  const nameRow = div("demographics-settle-list-namerow");
  nameRow.appendChild(div("demographics-settle-list-name", settlement.name));
  nameRow.appendChild(deps.buildTypeBadge(settlement.isTown));
  if (settlement.isCapital) {
    nameRow.appendChild(
      div(
        "demographics-settle-badge demographics-settle-badge-city",
        t("LOC_DEMOGRAPHICS_SETTLEMENTS_CAPITAL")
      )
    );
  }
  const holy = buildHolyBadge(settlement);
  if (holy) nameRow.appendChild(holy);
  const cams = deps.buildCameraButtons(settlement, state);
  if (cams) nameRow.appendChild(cams);
  return nameRow;
}

/**
 * Build the showcase row's middle column.
 * @param {*} settlement
 * @param {*} state
 * @param {ShowcaseDeps} deps
 * @returns {HTMLElement}
 */
function buildShowcaseMid(settlement, state, deps) {
  const mid = div("demographics-settle-list-mid");
  mid.appendChild(buildShowcaseNameRow(settlement, state, deps));
  // Owning civilization beneath the settlement name: the
  // ranked list mixes many civs' settlements, and the avatar disc alone doesn't
  // say which civ a lesser-known settlement belongs to.
  const [listPrimary] = orderedNames(settlement.owner.leaderName, settlement.owner.civName);
  if (listPrimary) {
    mid.appendChild(div("demographics-settle-list-civ", listPrimary));
  }
  const wonderRow = buildWonderRow(settlement);
  if (wonderRow) mid.appendChild(wonderRow);
  mid.appendChild(buildCityMeta(settlement, deps));
  // Per-yield breakdown inline, then the composite score bar.
  mid.appendChild(deps.buildOutputStrip(settlement));
  mid.appendChild(buildScoreBar(settlement));
  return mid;
}

/**
 * The holy-city badge (religion icon + "Holy City"), or null. A masked
 * (unmet-owner) settlement keeps the badge but not the religion, which would
 * name the unmet civ's faith.
 * @param {*} settlement
 * @returns {HTMLElement|null}
 */
function buildHolyBadge(settlement) {
  if (!settlement.holy) return null;
  const badge = div("demographics-settle-badge demographics-settle-badge-holy");
  const holy = settlement.holy;
  if (holy.icon && !settlement.masked) badge.appendChild(iconEl(holy.icon, "demographics-settle-holy-icon"));
  badge.appendChild(div("demographics-settle-holy-label", t("LOC_DEMOGRAPHICS_SETTLEMENTS_HOLY_CITY")));
  if (holy.religionName && !settlement.masked) {
    const tooltip = t("LOC_DEMOGRAPHICS_SETTLEMENTS_HOLY_CITY_TOOLTIP", holy.religionName);
    badge.setAttribute("data-tooltip-content", tooltip);
  }
  return badge;
}

/**
 * The small icons of every output this settlement leads the WORLD in (rank 1
 * across all settlements, not just the rows shown), or null when it leads none.
 * @param {*} settlement
 * @returns {HTMLElement|null} The icon strip, or null.
 */
function buildLeaderIcons(settlement) {
  const strip = div("demographics-settle-lead-icons");
  for (const col of SETTLEMENT_OUTPUTS) {
    if (settlement.ranks[col.id] !== 1 || !((settlement.outputs && settlement.outputs[col.id]) > 0)) continue;
    const icon = iconEl(col.icon, "demographics-settle-lead-icon");
    icon.setAttribute("data-tooltip-content", t("LOC_DEMOGRAPHICS_SETTLEMENTS_WORLD_LEADER_TOOLTIP", t(col.label)));
    strip.appendChild(icon);
  }
  return strip.firstChild ? strip : null;
}

/**
 * The rank cell shared by the Top 25 and Civilization Ranking rows: the place
 * number with the world-leader icons beneath it.
 * @param {number} place The 1-based place.
 * @param {*} settlement The settlement or civ aggregate (reads `ranks` + `outputs`).
 * @returns {HTMLElement}
 */
export function buildRankCell(place, settlement) {
  const rank = div("demographics-settle-list-rankcol");
  rank.appendChild(div("demographics-settle-list-rank", String(place)));
  const leads = buildLeaderIcons(settlement);
  if (leads) rank.appendChild(leads);
  return rank;
}

/**
 * Whether a settlement belongs to the local player (never true for a masked one).
 * @param {*} settlement
 * @returns {boolean}
 */
export function isOwnSettlement(settlement) {
  if (!settlement || settlement.masked || !settlement.owner || typeof GameContext === "undefined") return false;
  return settlement.owner.pid === GameContext.localPlayerID;
}

/**
 * The row classes shared by the showcase list and the table: a gold/silver/bronze
 * tint for places 1-3 and a gold outline on the local player's own settlements.
 * @param {string} base The base class list.
 * @param {*} settlement
 * @param {number} place The 1-based place in the list.
 * @returns {string}
 */
export function rankedRowClass(base, settlement, place) {
  let classes = base;
  if (place >= 1 && place <= 3) classes += " demographics-settle-medalrow-" + place;
  if (isOwnSettlement(settlement)) classes += " is-own";
  return classes;
}

/**
 * Build one ranked-list row of the showcase.
 * @param {*} settlement
 * @param {*} state
 * @param {ShowcaseDeps} deps
 * @returns {HTMLElement}
 */
function buildShowcaseRow(settlement, state, deps) {
  settlement = deps.displayOf(state, settlement);
  const row = div(rankedRowClass("demographics-settle-list-row", settlement, settlement.ranks.composite));
  if (settlement.owner.readable || settlement.owner.primary) {
    row.style.setProperty("border-left-color", settlement.owner.readable || settlement.owner.primary);
  }
  row.appendChild(buildRankCell(settlement.ranks.composite, settlement));
  row.appendChild(deps.buildOwnerAvatar(settlement.owner));
  row.appendChild(buildShowcaseMid(settlement, state, deps));
  row.appendChild(div("demographics-settle-list-score", formatRounded(settlement.composite)));
  return row;
}

/**
 * Fill (or refill) the top-3 podium in place. The podium element itself is kept across an age
 * switch; only its cards are swapped.
 * @param {HTMLElement} podium The podium element to fill.
 * @param {*[]} top The composite-sorted top settlements.
 * @param {*} state
 * @param {ShowcaseDeps} deps
 * @param {boolean} [vertical] Stack gold→bronze top-to-bottom (left-column layout).
 */
function fillPodium(podium, top, state, deps, vertical) {
  while (podium.firstChild) podium.removeChild(podium.firstChild);
  // Horizontal podium centers the winner (2-1-3); the vertical (left-column)
  // layout reads top-to-bottom, so emit gold → silver → bronze instead.
  const order = vertical ? [top[0], top[1], top[2]] : [top[1], top[0], top[2]];
  const places = vertical ? [1, 2, 3] : [2, 1, 3];
  for (let i = 0; i < order.length; i++) {
    if (order[i]) podium.appendChild(buildPodiumCard(order[i], places[i], state, deps));
  }
}

/**
 * The archived ages the age pills offer.
 * @param {ShowcaseDeps} deps
 * @returns {Array<{ age: string, label: string, year: string, top: Array<*> }>}
 */
function showcaseAges(deps) {
  return Array.isArray(deps.archive) ? deps.archive : [];
}

/**
 * The settlements the showcase ranks: the live board, or the archived end-of-age board picked in
 * the age pills.
 * @param {*} state
 * @param {ShowcaseDeps} deps
 * @returns {Array<*>} The ranked settlements.
 */
function showcaseSource(state, deps) {
  const pick = showcaseAges(deps).find((entry) => entry.age === state.showcaseAge);
  return pick ? pick.top : state.board.settlements;
}

/**
 * Re-apply the picked age: chip state, the archive note, and the podium + list contents. The
 * pills, both filigree section titles and the list header stay exactly where they are.
 * @param {*} state
 * @param {ShowcaseDeps} deps
 * @param {ShowcaseUi} ui The showcase's chrome handles.
 */
function refreshShowcase(state, deps, ui) {
  const ages = showcaseAges(deps);
  const active = ages.some((entry) => entry.age === state.showcaseAge) ? state.showcaseAge : "now";
  for (const [id, chip] of ui.chips) {
    if (id === active) chip.classList.add("is-active");
    else chip.classList.remove("is-active");
  }
  // The note carries no engine art, so replacing it costs nothing and keeps it absent (rather
  // than an empty box adding a row gap) while the live board is shown.
  if (ui.note && ui.note.parentNode) ui.note.parentNode.removeChild(ui.note);
  ui.note = null;
  const pick = ages.find((entry) => entry.age === active);
  if (pick && ui.split && ui.split.parentNode) {
    ui.note = div(
      "demographics-settle-age-note",
      t("LOC_DEMOGRAPHICS_SETTLEMENTS_AGE_END_NOTE", pick.year ? localYear(pick.year) : pick.label)
    );
    ui.split.parentNode.insertBefore(ui.note, ui.split);
  }
  const top = showcaseSource(state, deps).slice(0, deps.topN);
  fillPodium(/** @type {HTMLElement} */ (ui.podium), top, state, deps, true);
  fillShowcaseList(ui, top, state, deps);
}

/**
 * Render the artistic Top-25 showcase. The chrome is built once here; an age pill click goes
 * through {@link refreshShowcase} rather than a panel rebuild.
 * @param {*} state
 * @param {ShowcaseDeps} deps
 */
export function renderShowcasePanel(state, deps) {
  const ages = showcaseAges(deps);
  /** @type {ShowcaseUi} */
  const ui = {
    chips: new Map(),
    split: null,
    podium: null,
    list: null,
    listRows: [],
    note: null,
    refresh: () => {}
  };
  ui.refresh = () => refreshShowcase(state, deps, ui);
  if (ages.length) state.content.appendChild(buildAgePills(state, ages, deps, ui));
  // With age pills present the scaffold is always built, even when the LIVE board is empty: the
  // pills can switch to an archived age that does have entries, and that switch fills the podium
  // and list in place rather than re-rendering the panel. Without pills there is nothing to
  // switch to, so an empty board is the whole render.
  if (!ages.length && !showcaseSource(state, deps).length) {
    state.content.appendChild(deps.buildEmpty());
    return;
  }
  state.content.appendChild(buildShowcaseSplit(deps, ui));
  refreshShowcase(state, deps, ui);
}

/**
 * Build the podium/list scaffold once: the two filigree section titles, the (empty) podium host
 * and the ranked list with its column header. Everything here outlives an age switch.
 * @param {ShowcaseDeps} deps
 * @param {ShowcaseUi} ui The showcase's chrome handles.
 * @returns {HTMLElement}
 */
function buildShowcaseSplit(deps, ui) {
  // Two-column layout: the podium (left) beside the full ranked list (right) so
  // the wide window's space is used instead of stacking everything vertically.
  ui.split = div("demographics-settle-split");
  const left = div("demographics-settle-split-left");
  left.appendChild(deps.buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_PODIUM_TITLE"));
  ui.podium = div("demographics-settle-podium");
  left.appendChild(ui.podium);
  ui.split.appendChild(left);

  const right = div("demographics-settle-split-right");
  right.appendChild(deps.buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_RANKING_TITLE"));
  ui.list = div("demographics-settle-list");
  ui.list.appendChild(deps.buildListHeader());
  right.appendChild(ui.list);
  ui.split.appendChild(right);
  return ui.split;
}

/**
 * Fill (or refill) the ranked list's rows in place, keeping its column header (which the age
 * switch does not change) in the DOM.
 * @param {ShowcaseUi} ui The showcase's chrome handles.
 * @param {*[]} top The composite-sorted top settlements.
 * @param {*} state
 * @param {ShowcaseDeps} deps
 */
function fillShowcaseList(ui, top, state, deps) {
  const list = /** @type {HTMLElement} */ (ui.list);
  for (const row of ui.listRows) {
    if (row.parentNode === list) list.removeChild(row);
  }
  ui.listRows.length = 0;
  /** @param {HTMLElement} el The element to append and track. */
  const add = (el) => {
    ui.listRows.push(el);
    list.appendChild(el);
  };
  for (let i = 0; i < top.length; i++) {
    add(buildShowcaseRow(top[i], state, deps));
    if (i === 9 && top.length > 10) {
      add(div("demographics-settle-top10", t("LOC_DEMOGRAPHICS_SETTLEMENTS_TOP10")));
    }
  }
  if (!top.length) add(deps.buildEmpty());
}

/**
 * The "Now / End of <age>" pill row that switches the showcase between the live
 * board and an archived end-of-age board. Session-only, like the table filter.
 * @param {*} state
 * @param {Array<{ age: string, label: string }>} ages The archived ages, oldest first.
 * @param {ShowcaseDeps} deps
 * @param {ShowcaseUi} ui The showcase's chrome handles.
 * @returns {HTMLElement}
 */
function buildAgePills(state, ages, deps, ui) {
  const row = div("demographics-settle-filters demographics-settle-age-pills");
  const items = [{ id: "now", label: t("LOC_DEMOGRAPHICS_SETTLEMENTS_AGE_NOW") }].concat(
    ages.map((entry) => ({ id: entry.age, label: t("LOC_DEMOGRAPHICS_SETTLEMENTS_AGE_END", entry.label) }))
  );
  for (const item of items) {
    const chip = div("demographics-chart-time-filter-pill");
    chip.textContent = item.label;
    chip.addEventListener("click", () => {
      // The live state, not a captured one: the chip outlives the render that built it.
      if (state.showcaseAge === item.id) return;
      state.showcaseAge = item.id;
      deps.safePlaySound("data-audio-activate");
      ui.refresh();
    });
    ui.chips.set(item.id, chip);
    row.appendChild(chip);
  }
  return row;
}
