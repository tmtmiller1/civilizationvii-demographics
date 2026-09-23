// view-settlements-showcase.js
//
// Showcase (Top-25) rendering for the Settlements view.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import { div, fmt, fmtPop, iconEl } from "/demographics/ui/core/ui-helpers.js";
import { orderedNames } from "/demographics/ui/core/player-label.js";
import { SETTLEMENT_OUTPUTS } from "/demographics/ui/screen-demographics/settlements/settlements-data.js";

/**
 * @typedef {{
 *   topN: number,
 *   safePlaySound: (id: string) => void,
 *   displayOf: (st: *, s: *) => *,
 *   buildLaurelMedal: (place: number) => HTMLElement,
 *   buildOwnerAvatar: (owner: *) => HTMLElement,
 *   buildOutputStrip: (s: *) => HTMLElement,
 *   buildTypeBadge: (isTown: boolean) => HTMLElement,
 *   buildCameraButtons: (s: *, st: *) => (HTMLElement|null),
 *   buildSectionTitle: (key: string) => HTMLElement,
 *   buildListHeader: (nameKey?: string) => HTMLElement,
 *   buildEmpty: () => HTMLElement,
 *   buildTrendGlyph: (trend: *) => HTMLElement,
 *   archive?: Array<{ age: string, label: string, year: string, top: Array<*> }>
 * }} ShowcaseDeps
 */

/**
 * Live handles to the showcase's persistent chrome. The age pills, the two filigree section
 * titles and the ranked list's header are built ONCE; an age switch refills the podium and the
 * list rows and nothing else. Rebuilding them is what made the flourishes and the laurel medals
 * blink — a fresh element's `blp:` background resolves a frame or more after it is inserted.
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
 * @param {{ nameKey?: string, year?: string }} w The wonder.
 * @returns {string} The tooltip text.
 */
function wonderTooltip(w) {
  const name = t(w.nameKey || "");
  return w.year ? name + " · " + t("LOC_DEMOGRAPHICS_SETTLEMENTS_WONDER_BUILT", w.year) : name;
}

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
    if (w.nameKey) ic.setAttribute("data-tooltip-content", wonderTooltip(w));
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
  // An archived (end-of-age) record has no live population window to trend.
  if (!s.archived) popWrap.appendChild(deps.buildTrendGlyph(s.trend));
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
  // Three-line ownership hierarchy: Settlement (primary) / Civilization /
  // Leader (smallest). Each line shows only when present so masked/unowned
  // rows aren't left blank.
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
 * Build the showcase row's name line: name, City/Town, Capital, Holy City, and
 * the camera buttons.
 * @param {*} s The settlement.
 * @param {*} st The render state.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @returns {HTMLElement} The name row.
 */
function buildShowcaseNameRow(s, st, deps) {
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
  const holy = buildHolyBadge(s);
  if (holy) nameRow.appendChild(holy);
  const cams = deps.buildCameraButtons(s, st);
  if (cams) nameRow.appendChild(cams);
  return nameRow;
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
  mid.appendChild(buildShowcaseNameRow(s, st, deps));
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
 * The holy-city badge (religion icon + "Holy City"), or null. A masked
 * (unmet-owner) settlement keeps the badge but not the religion, which would
 * name the unmet civ's faith.
 * @param {*} s The settlement.
 * @returns {HTMLElement|null} The badge, or null.
 */
function buildHolyBadge(s) {
  if (!s.holy) return null;
  const badge = div("demographics-settle-badge demographics-settle-badge-holy");
  if (s.holy.icon && !s.masked) badge.appendChild(iconEl(s.holy.icon, "demographics-settle-holy-icon"));
  badge.appendChild(div("demographics-settle-holy-label", t("LOC_DEMOGRAPHICS_SETTLEMENTS_HOLY_CITY")));
  if (s.holy.religionName && !s.masked) {
    badge.setAttribute("data-tooltip-content", t("LOC_DEMOGRAPHICS_SETTLEMENTS_HOLY_CITY_TOOLTIP", s.holy.religionName));
  }
  return badge;
}

/**
 * The small icons of every output this settlement leads the WORLD in (rank 1
 * across all settlements, not just the rows shown), or null when it leads none.
 * @param {*} s The settlement.
 * @returns {HTMLElement|null} The icon strip, or null.
 */
function buildLeaderIcons(s) {
  const strip = div("demographics-settle-lead-icons");
  for (const col of SETTLEMENT_OUTPUTS) {
    if (s.ranks[col.id] !== 1 || !((s.outputs && s.outputs[col.id]) > 0)) continue;
    const ic = iconEl(col.icon, "demographics-settle-lead-icon");
    ic.setAttribute("data-tooltip-content", t("LOC_DEMOGRAPHICS_SETTLEMENTS_WORLD_LEADER_TOOLTIP", t(col.label)));
    strip.appendChild(ic);
  }
  return strip.firstChild ? strip : null;
}

/**
 * The rank cell shared by the Top 25 and Civilization Ranking rows: the place
 * number with the world-leader icons beneath it.
 * @param {number} place The 1-based place.
 * @param {*} s The settlement or civ aggregate (reads `ranks` + `outputs`).
 * @returns {HTMLElement} The rank cell.
 */
export function buildRankCell(place, s) {
  const rank = div("demographics-settle-list-rankcol");
  rank.appendChild(div("demographics-settle-list-rank", String(place)));
  const leads = buildLeaderIcons(s);
  if (leads) rank.appendChild(leads);
  return rank;
}

/**
 * Whether a settlement belongs to the local player (never true for a masked one).
 * @param {*} s The settlement.
 * @returns {boolean} True for the local player's own settlement.
 */
export function isOwnSettlement(s) {
  if (!s || s.masked || !s.owner || typeof GameContext === "undefined") return false;
  return s.owner.pid === GameContext.localPlayerID;
}

/**
 * The row classes shared by the showcase list and the table: a gold/silver/bronze
 * tint for places 1-3 and a gold outline on the local player's own settlements.
 * @param {string} base The base class list.
 * @param {*} s The settlement.
 * @param {number} place The 1-based place in the list.
 * @returns {string} The class list.
 */
export function rankedRowClass(base, s, place) {
  let cls = base;
  if (place >= 1 && place <= 3) cls += " demographics-settle-medalrow-" + place;
  if (isOwnSettlement(s)) cls += " is-own";
  return cls;
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
  const row = div(rankedRowClass("demographics-settle-list-row", s, s.ranks.composite));
  if (s.owner.readable || s.owner.primary) {
    row.style.setProperty("border-left-color", s.owner.readable || s.owner.primary);
  }
  row.appendChild(buildRankCell(s.ranks.composite, s));
  row.appendChild(deps.buildOwnerAvatar(s.owner));
  row.appendChild(buildShowcaseMid(s, st, deps));
  row.appendChild(div("demographics-settle-list-score", fmt(s.composite)));
  return row;
}

/**
 * Fill (or refill) the top-3 podium in place. The podium element itself is kept across an age
 * switch; only its cards are swapped.
 * @param {HTMLElement} podium The podium element to fill.
 * @param {*[]} top The composite-sorted top settlements.
 * @param {*} st The render state.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @param {boolean} [vertical] Stack gold→bronze top-to-bottom (left-column layout).
 */
function fillPodium(podium, top, st, deps, vertical) {
  while (podium.firstChild) podium.removeChild(podium.firstChild);
  // Horizontal podium centers the winner (2-1-3); the vertical (left-column)
  // layout reads top-to-bottom, so emit gold → silver → bronze instead.
  const order = vertical ? [top[0], top[1], top[2]] : [top[1], top[0], top[2]];
  const places = vertical ? [1, 2, 3] : [2, 1, 3];
  for (let i = 0; i < order.length; i++) {
    if (order[i]) podium.appendChild(buildPodiumCard(order[i], places[i], st, deps));
  }
}

/**
 * The archived ages the age pills offer.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @returns {Array<{ age: string, label: string, year: string, top: Array<*> }>} The ages.
 */
function showcaseAges(deps) {
  return Array.isArray(deps.archive) ? deps.archive : [];
}

/**
 * The settlements the showcase ranks: the live board, or the archived end-of-age board picked in
 * the age pills.
 * @param {*} st The render state.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @returns {Array<*>} The ranked settlements.
 */
function showcaseSource(st, deps) {
  const pick = showcaseAges(deps).find((a) => a.age === st.showcaseAge);
  return pick ? pick.top : st.board.settlements;
}

/**
 * Re-apply the picked age: chip state, the archive note, and the podium + list contents. The
 * pills, both filigree section titles and the list header stay exactly where they are.
 * @param {*} st The render state.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @param {ShowcaseUi} ui The showcase's chrome handles.
 */
function refreshShowcase(st, deps, ui) {
  const ages = showcaseAges(deps);
  const active = ages.some((a) => a.age === st.showcaseAge) ? st.showcaseAge : "now";
  for (const [id, chip] of ui.chips) {
    if (id === active) chip.classList.add("is-active");
    else chip.classList.remove("is-active");
  }
  // The note carries no engine art, so replacing it costs nothing and keeps it absent (rather
  // than an empty box adding a row gap) while the live board is shown.
  if (ui.note && ui.note.parentNode) ui.note.parentNode.removeChild(ui.note);
  ui.note = null;
  const pick = ages.find((a) => a.age === active);
  if (pick && ui.split && ui.split.parentNode) {
    ui.note = div(
      "demographics-settle-age-note",
      t("LOC_DEMOGRAPHICS_SETTLEMENTS_AGE_END_NOTE", pick.year || pick.label)
    );
    ui.split.parentNode.insertBefore(ui.note, ui.split);
  }
  const top = showcaseSource(st, deps).slice(0, deps.topN);
  fillPodium(/** @type {HTMLElement} */ (ui.podium), top, st, deps, true);
  fillShowcaseList(ui, top, st, deps);
}

/**
 * Render the artistic Top-25 showcase. The chrome is built once here; an age pill click goes
 * through {@link refreshShowcase} rather than a panel rebuild.
 * @param {*} st The render state.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 */
export function renderShowcasePanel(st, deps) {
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
  ui.refresh = () => refreshShowcase(st, deps, ui);
  if (ages.length) st.content.appendChild(buildAgePills(st, ages, deps, ui));
  // With age pills present the scaffold is always built, even when the LIVE board is empty: the
  // pills can switch to an archived age that does have entries, and that switch fills the podium
  // and list in place rather than re-rendering the panel. Without pills there is nothing to
  // switch to, so an empty board is the whole render.
  if (!ages.length && !showcaseSource(st, deps).length) {
    st.content.appendChild(deps.buildEmpty());
    return;
  }
  st.content.appendChild(buildShowcaseSplit(deps, ui));
  refreshShowcase(st, deps, ui);
}

/**
 * Build the podium/list scaffold once: the two filigree section titles, the (empty) podium host
 * and the ranked list with its column header. Everything here outlives an age switch.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @param {ShowcaseUi} ui The showcase's chrome handles.
 * @returns {HTMLElement} The split element.
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
 * @param {*} st The render state.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 */
function fillShowcaseList(ui, top, st, deps) {
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
    add(buildShowcaseRow(top[i], st, deps));
    if (i === 9 && top.length > 10) {
      add(div("demographics-settle-top10", t("LOC_DEMOGRAPHICS_SETTLEMENTS_TOP10")));
    }
  }
  if (!top.length) add(deps.buildEmpty());
}

/**
 * The "Now / End of <age>" pill row that switches the showcase between the live
 * board and an archived end-of-age board. Session-only, like the table filter.
 * @param {*} st The render state.
 * @param {Array<{ age: string, label: string }>} ages The archived ages, oldest first.
 * @param {ShowcaseDeps} deps Rendering dependencies.
 * @param {ShowcaseUi} ui The showcase's chrome handles.
 * @returns {HTMLElement} The pill row.
 */
function buildAgePills(st, ages, deps, ui) {
  const row = div("demographics-settle-filters demographics-settle-age-pills");
  const items = [{ id: "now", label: t("LOC_DEMOGRAPHICS_SETTLEMENTS_AGE_NOW") }].concat(
    ages.map((a) => ({ id: a.age, label: t("LOC_DEMOGRAPHICS_SETTLEMENTS_AGE_END", a.label) }))
  );
  for (const it of items) {
    const chip = div("demographics-chart-time-filter-pill");
    chip.textContent = it.label;
    chip.addEventListener("click", () => {
      // The live state, not a captured one: the chip outlives the render that built it.
      if (st.showcaseAge === it.id) return;
      st.showcaseAge = it.id;
      deps.safePlaySound("data-audio-activate");
      ui.refresh();
    });
    ui.chips.set(it.id, chip);
    row.appendChild(chip);
  }
  return row;
}
