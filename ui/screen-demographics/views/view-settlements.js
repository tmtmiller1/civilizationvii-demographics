// view-settlements.js
//
// "World Rankings" hub. Three 2nd-order major tabs (native fxs-tab-bar):
//   civilizations - the per-civ World Factbook matrix (ViewFactbook; from sampled
//                   history).
//   showcase      - an artistic Top-25 settlements board (podium + ranked list) by
//                   composite score, with clickable city dossiers.
//   table         - a dense, sortable settlements table with an All/Cities/Towns
//                   filter and a "category leaders" strip.
//
// (The Town Advisor lives in its own top-level tab now; the data tables here are a
// LIVE snapshot from settlements-data.js. "Settlement" is the primary unit: the
// city<->town status flips across ages, so the combined list is the headline and
// City/Town is just a filter on current status.)

import { t } from "/demographics/ui/demographics-i18n.js";
import { safePlaySound } from "/demographics/ui/demographics-audio.js";
import { div, fmt, fmtPop, iconEl } from "/demographics/ui/ui-helpers.js";
import {
  SETTLEMENT_OUTPUTS,
  buildSettlementBoard,
  valueOf
} from "/demographics/ui/screen-demographics/settlements-data.js";
import {
  startInstant,
  launchCinematic
} from "/demographics/ui/screen-demographics/city-camera-controller.js";
import * as ViewFactbook from "/demographics/ui/screen-demographics/views/view-factbook.js";

const TOP_N = 25;

/**
 * Mutable render state for the Settlements view.
 * @typedef {Object} SettleState
 * @property {*} settings Persisted-setting surface (getSetting/setSetting).
 * @property {*} [history] Sampled history (for the Civilizations/factbook sub-tab).
 * @property {*} board The scored + ranked settlement board.
 * @property {HTMLElement} content The swappable content host.
 * @property {string} subTab Active sub-view ("showcase" | "table").
 * @property {string} filter Active table filter ("all" | "cities" | "towns").
 * @property {string} sortKey Active table sort key ("composite" | output id).
 * @property {*} [detail] The settlement whose detail dossier is open, or null.
 * @property {boolean} showUnmetNames When false (default), settlements owned by
 *   civs the local player has not met are shown with their identity (name +
 *   owner) obscured, while their stats still populate the rankings.
 */

/**
 * Read a persisted setting, defensively.
 * @param {*} settings The settings surface.
 * @param {string} key The setting key.
 * @param {*} fallback The default.
 * @returns {*} The stored value or the default.
 */
function getSetting(settings, key, fallback) {
  try {
    if (settings && typeof settings.getSetting === "function") return settings.getSetting(key, fallback);
  } catch (_) {
    // getSetting can throw; fall back.
  }
  return fallback;
}

/**
 * Persist a setting, defensively.
 * @param {*} settings The settings surface.
 * @param {string} key The setting key.
 * @param {*} value The value to store.
 */
function setSetting(settings, key, value) {
  try {
    if (settings && typeof settings.setSetting === "function") settings.setSetting(key, value);
  } catch (_) {
    // setSetting can throw; ignore (non-persisted is acceptable).
  }
}

/**
 * Whether a settlement's identity should be obscured: the "hide unmet players"
 * option (showUnmetNames === false, the default) is active AND the owner is a
 * civ the local player has not met. Defensive: only mask when `met === false`
 * (mirrors the factbook), never on an unknown/undefined met state.
 * @param {SettleState} st The render state.
 * @param {*} s The settlement.
 * @returns {boolean} True when the settlement should be masked.
 */
function isMasked(st, s) {
  return !st.showUnmetNames && !!s && !!s.owner && s.owner.met === false;
}

/**
 * A masked owner identity: generic "Unmet" names, no portrait type, no banner
 * colors (so the civ's color can't be read off the accent).
 * @param {*} owner The real owner identity.
 * @returns {*} The masked owner.
 */
function maskOwner(owner) {
  return {
    pid: owner ? owner.pid : -1,
    leaderName: t("LOC_DEMOGRAPHICS_FACTBOOK_UNMET_LEADER"),
    civName: t("LOC_DEMOGRAPHICS_UNMET_CIV"),
    leaderType: undefined,
    primary: undefined,
    secondary: undefined,
    readable: undefined,
    isMajor: false,
    met: false
  };
}

/**
 * A display clone of a settlement with its identity (name + owner) obscured,
 * keeping every quantitative field (score, yields, population, founded, trend,
 * wonders, ranks) intact. `masked` is stamped so builders can suppress the
 * "View on map" affordance (revealing an unmet city's location is a spoiler).
 * @param {*} s The settlement.
 * @returns {*} The masked settlement.
 */
function maskSettlement(s) {
  return Object.assign({}, s, {
    name: t("LOC_DEMOGRAPHICS_SETTLEMENTS_UNMET_NAME"),
    owner: maskOwner(s.owner),
    masked: true
  });
}

/**
 * Resolve the display settlement for a render: the masked clone when the
 * "hide unmet players" option applies, otherwise the settlement unchanged.
 * @param {SettleState} st The render state.
 * @param {*} s The settlement.
 * @returns {*} The settlement to render.
 */
function displayOf(st, s) {
  return isMasked(st, s) ? maskSettlement(s) : s;
}

/**
 * Stop an event from bubbling (so a "View on map" click inside a card does not
 * also open the card's detail dossier).
 * @param {*} e The event.
 */
function stopEvent(e) {
  try {
    if (e && typeof e.stopPropagation === "function") e.stopPropagation();
  } catch (_) {
    // stopPropagation can be absent on synthetic events; ignore.
  }
}

/**
 * Build one camera action button (shared pin + label + active/disabled wiring).
 * A masked (unmet-owner) settlement renders greyed-out and inert with a tooltip
 * (moving the camera there would reveal an unmet city's location).
 * @param {boolean} active Whether the button is live.
 * @param {string} labelKey The label LOC key.
 * @param {() => void} onClick The activation handler.
 * @param {string} [disabledTipKey] Tooltip LOC key when disabled (defaults to the unmet reason).
 * @returns {HTMLElement} The button.
 */
function cameraButton(active, labelKey, onClick, disabledTipKey) {
  const btn = div("demographics-settle-mapbtn" + (active ? " demographics-settle-clickable" : " is-disabled"));
  btn.appendChild(div("demographics-settle-mapbtn-pin"));
  btn.appendChild(div("demographics-settle-mapbtn-label", t(labelKey)));
  if (active) {
    btn.addEventListener("click", (e) => {
      stopEvent(e);
      onClick();
    });
  } else {
    btn.setAttribute("data-tooltip-content", t(disabledTipKey || "LOC_DEMOGRAPHICS_SETTLEMENTS_MAP_UNMET_TOOLTIP"));
    btn.addEventListener("click", stopEvent);
  }
  return btn;
}

/**
 * Whether the camera (fly-to / fly-by) is forbidden for a settlement: its owner
 * is a civ the local player has not met, OR the settlement's city center hasn't
 * been discovered yet (it's still in fog). Independent of the "hide unmet names"
 * option.
 * @param {*} s The settlement.
 * @returns {boolean} True when the camera must stay disabled.
 */
function cameraForbidden(s) {
  return !!(s.owner && s.owner.met === false) || s.explored === false;
}

/**
 * The tooltip LOC key explaining WHY the camera is disabled for a settlement.
 * @param {*} s The settlement.
 * @returns {string} The tooltip LOC key.
 */
function cameraDisabledTip(s) {
  if (s.owner && s.owner.met === false) return "LOC_DEMOGRAPHICS_SETTLEMENTS_MAP_UNMET_TOOLTIP";
  return "LOC_DEMOGRAPHICS_SETTLEMENTS_MAP_UNEXPLORED_TOOLTIP";
}

/**
 * The "View on map" button — an instant snap to the city (Stage 3). Greyed-out
 * for an unmet civ; null when there is no readable location to view.
 * @param {*} s The settlement.
 * @returns {HTMLElement|null} The button, or null.
 */
function buildMapButton(s) {
  if (!cameraForbidden(s) && !s.location) return null;
  return cameraButton(!cameraForbidden(s) && !!s.location, "LOC_DEMOGRAPHICS_SETTLEMENTS_VIEW_ON_MAP",
    () => startInstant(s), cameraDisabledTip(s));
}

/**
 * The dedicated "Cinematic" button (default on; hidden when the cinematic option
 * is turned off). Greyed-out for an unmet civ. Enriches the city's wonders with
 * their build years from history first, so the tour can caption each wonder.
 * @param {*} s The settlement.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement|null} The button, or null.
 */
function buildCinematicButton(s, st) {
  if (getSetting(st.settings, "topCities.cinematicEnabled", true) !== true) return null;
  if (!cameraForbidden(s) && !s.location) return null;
  return cameraButton(!cameraForbidden(s) && !!s.location, "LOC_DEMOGRAPHICS_SETTLEMENTS_CINEMATIC_VIEW",
    () => launchCinematic(enrichWonders(s, st.history)), cameraDisabledTip(s));
}

/**
 * Build the camera action row: "View on map" + (default) "Cinematic". Null when
 * neither button applies.
 * @param {*} s The settlement.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement|null} The button row, or null.
 */
function buildCameraButtons(s, st) {
  const row = div("demographics-settle-mapbtns");
  const map = buildMapButton(s);
  if (map) row.appendChild(map);
  const cine = buildCinematicButton(s, st);
  if (cine) row.appendChild(cine);
  return row.firstChild ? row : null;
}

/**
 * Build a map of wonder ConstructibleType → earliest game-year it appears for an
 * owner in the sampled history (its approximate build year).
 * @param {*} history The sampled history.
 * @param {number} pid The owner player id.
 * @returns {Map<string, string>} type → year.
 */
function wonderBuildYears(history, pid) {
  const out = new Map();
  const samples = history && Array.isArray(history.samples) ? history.samples : [];
  const key = String(pid);
  for (const smp of samples) foldSampleWonderYears(out, smp, key);
  return out;
}

/**
 * Fold one sample's wonder types into the earliest-year map.
 * @param {Map<string, string>} out type → earliest year (mutated).
 * @param {*} smp The sample.
 * @param {string} key The owner pid key.
 */
function foldSampleWonderYears(out, smp, key) {
  const ps = smp && smp.players ? smp.players[key] : null;
  const types = ps && Array.isArray(ps.wonderTypes) ? ps.wonderTypes : null;
  if (!types || !smp.gameYear) return;
  for (const ty of types) if (!out.has(ty)) out.set(ty, smp.gameYear);
}

/**
 * Annotate a settlement's wonders with their build years (from history) so the
 * cinematic can caption each wonder. Mutates + returns the settlement.
 * @param {*} s The settlement.
 * @param {*} history The sampled history.
 * @returns {*} The settlement.
 */
function enrichWonders(s, history) {
  const years = wonderBuildYears(history, s.owner && s.owner.pid);
  for (const w of Array.isArray(s.wonders) ? s.wonders : []) {
    if (w && w.type && !w.year && years.has(w.type)) w.year = years.get(w.type);
  }
  return s;
}

/**
 * Build the owner avatar: a civ-colored disc holding the leader portrait, or an
 * initial-letter placeholder when no LEADER_* type resolves.
 * @param {*} owner The settlement owner identity.
 * @returns {HTMLElement} The avatar element.
 */
function buildOwnerAvatar(owner) {
  const wrap = div("demographics-settle-avatar");
  if (owner.readable || owner.primary) wrap.style.backgroundColor = owner.readable || owner.primary;
  if (owner.secondary) wrap.style.borderColor = owner.secondary;
  if (owner.leaderType) {
    const portrait = document.createElement("fxs-icon");
    portrait.setAttribute("data-icon-id", owner.leaderType);
    portrait.setAttribute("data-icon-context", "LEADER");
    portrait.className = "demographics-settle-portrait";
    wrap.appendChild(portrait);
  } else {
    const initial = (owner.leaderName || owner.civName || "?").trim().charAt(0).toUpperCase() || "?";
    wrap.appendChild(div("demographics-settle-avatar-initial", initial));
  }
  return wrap;
}

/**
 * Build the owner cell: avatar + leader/civ name.
 * @param {*} owner The settlement owner identity.
 * @returns {HTMLElement} The owner cell.
 */
function buildOwnerCell(owner) {
  const cell = div("demographics-settle-owner");
  cell.appendChild(buildOwnerAvatar(owner));
  const names = div("demographics-settle-owner-names");
  names.appendChild(div("demographics-settle-owner-leader", owner.leaderName || "—"));
  if (owner.civName) names.appendChild(div("demographics-settle-owner-civ", owner.civName));
  cell.appendChild(names);
  return cell;
}

/**
 * Build the City/Town status badge.
 * @param {boolean} isTown Whether the settlement is currently a town.
 * @returns {HTMLElement} The badge element.
 */
function buildTypeBadge(isTown) {
  const key = isTown ? "LOC_DEMOGRAPHICS_SETTLEMENTS_TOWN" : "LOC_DEMOGRAPHICS_SETTLEMENTS_CITY";
  const badge = div(
    "demographics-settle-badge " + (isTown ? "demographics-settle-badge-town" : "demographics-settle-badge-city"),
    t(key)
  );
  return badge;
}

// ── Showcase (artistic Top-25 overall) ──────────────────────────────────────

/**
 * A CSS-drawn population-trend glyph (up/down/flat) — no unicode (avoids tofu).
 * @param {*} trend The settlement trend ({dir}) or null.
 * @returns {HTMLElement} The glyph element.
 */
function buildTrendGlyph(trend) {
  const dir = trend && typeof trend.dir === "number" ? trend.dir : 0;
  const cls = dir > 0 ? "up" : dir < 0 ? "down" : "flat";
  const g = div("demographics-settle-trend demographics-settle-trend-" + cls);
  return g;
}

/**
 * Build the horizontal wonder-icon row beneath a city name, with the game's
 * native hover tooltip per wonder. Returns null when the city has no wonders.
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
 * The founded-year text, distinguishing exact (event-sourced) from approximate
 * (first-seen) foundings.
 * @param {*} s The settlement.
 * @returns {string} The founded text (or "").
 */
function foundedText(s) {
  const f = s.founded;
  if (!f || !f.year) return "";
  return t(
    f.exact ? "LOC_DEMOGRAPHICS_SETTLEMENTS_FOUNDED" : "LOC_DEMOGRAPHICS_SETTLEMENTS_FOUNDED_APPROX",
    f.year
  );
}

/**
 * Build the city meta line: world-estimate population + trend glyph + founded year.
 * @param {*} s The settlement.
 * @returns {HTMLElement} The meta line.
 */
function buildCityMeta(s) {
  const meta = div("demographics-settle-citymeta");
  const popWrap = div("demographics-settle-citypop");
  popWrap.appendChild(iconEl("blp:Yield_Population", "demographics-settle-yield-icon"));
  popWrap.appendChild(div("demographics-settle-citypop-val", fmtPop(s.populationEstimate)));
  popWrap.appendChild(buildTrendGlyph(s.trend));
  meta.appendChild(popWrap);
  const ft = foundedText(s);
  if (ft) meta.appendChild(div("demographics-settle-founded", ft));
  return meta;
}

/**
 * Make a card/row open the city detail panel on click.
 * @param {HTMLElement} el The element.
 * @param {SettleState} st The render state.
 * @param {*} s The settlement.
 */
function makeCityClickable(el, st, s) {
  el.classList.add("demographics-settle-clickable");
  el.addEventListener("click", () => {
    st.detail = s;
    safePlaySound("data-audio-activate");
    rerenderContent(st);
  });
}

/**
 * Build one podium card for a top-3 settlement (clickable → detail).
 * @param {*} s The settlement.
 * @param {number} place 1-based podium place.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement} The card element.
 */
function buildPodiumCard(s, place, st) {
  s = displayOf(st, s);
  const card = div("demographics-settle-podium-card demographics-settle-rank-" + place);
  if (s.owner.readable || s.owner.primary) card.style.borderColor = s.owner.readable || s.owner.primary;
  card.appendChild(buildLaurelMedal(place));
  card.appendChild(buildOwnerAvatar(s.owner));
  card.appendChild(div("demographics-settle-podium-name", s.name));
  const wr = buildWonderRow(s);
  if (wr) card.appendChild(wr);
  card.appendChild(div("demographics-settle-podium-owner", s.owner.leaderName || s.owner.civName || ""));
  card.appendChild(buildCityMeta(s));
  const scoreRow = div("demographics-settle-podium-scorerow");
  scoreRow.appendChild(div("demographics-settle-podium-score", fmt(s.composite)));
  scoreRow.appendChild(buildTypeBadge(s.isTown));
  card.appendChild(scoreRow);
  card.appendChild(buildOutputStrip(s));
  const cams = buildCameraButtons(s, st);
  if (cams) card.appendChild(cams);
  makeCityClickable(card, st, s);
  return card;
}

/**
 * Engine laurel-wreath icons for the podium places (gold / silver / bronze).
 * @type {Record<number, string>}
 */
const LAUREL_ICONS = {
  1: "blp:popup_gold_laurels",
  2: "blp:popup_silver_laurels",
  3: "blp:popup_bronze_laurels"
};

/**
 * Build a podium medal: the place number framed by a gold/silver/bronze
 * laurel-wreath (repurposing the engine's victory-popup laurels).
 * @param {number} place The 1-based podium place.
 * @returns {HTMLElement} The medal element.
 */
function buildLaurelMedal(place) {
  const medal = div("demographics-settle-medal demographics-settle-medal-" + place);
  medal.style.backgroundImage = "url('" + (LAUREL_ICONS[place] || "blp:popup_laurels") + "')";
  medal.appendChild(div("demographics-settle-medal-num", String(place)));
  return medal;
}

/**
 * Build a compact icon+value strip of every output for a settlement.
 * @param {*} s The settlement.
 * @returns {HTMLElement} The strip element.
 */
function buildOutputStrip(s) {
  const strip = div("demographics-settle-outputs");
  for (const col of SETTLEMENT_OUTPUTS) {
    const item = div("demographics-settle-output");
    item.appendChild(iconEl(col.icon, "demographics-settle-yield-icon"));
    item.appendChild(div("demographics-settle-output-val", fmt(s.outputs[col.id])));
    strip.appendChild(item);
  }
  return strip;
}

/**
 * Build one ranked-list row of the showcase (clickable → detail), with the
 * wonder-icon row beneath the name + the population/founded meta line.
 * @param {*} s The settlement.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement} The row element.
 */
function buildShowcaseRow(s, st) {
  s = displayOf(st, s);
  const row = div("demographics-settle-list-row");
  if (s.owner.readable || s.owner.primary) row.style.setProperty("border-left-color", s.owner.readable || s.owner.primary);
  row.appendChild(div("demographics-settle-list-rank", String(s.ranks.composite)));
  row.appendChild(buildOwnerAvatar(s.owner));
  const mid = div("demographics-settle-list-mid");
  const nameRow = div("demographics-settle-list-namerow");
  nameRow.appendChild(div("demographics-settle-list-name", s.name));
  nameRow.appendChild(buildTypeBadge(s.isTown));
  const cams = buildCameraButtons(s, st);
  if (cams) nameRow.appendChild(cams);
  mid.appendChild(nameRow);
  const wr = buildWonderRow(s);
  if (wr) mid.appendChild(wr);
  mid.appendChild(buildCityMeta(s));
  mid.appendChild(buildScoreBar(s));
  row.appendChild(mid);
  row.appendChild(div("demographics-settle-list-score", fmt(s.composite)));
  makeCityClickable(row, st, s);
  return row;
}

/**
 * Build a civ-colored composite score bar (fill width = composite%).
 * @param {*} s The settlement.
 * @returns {HTMLElement} The bar element.
 */
function buildScoreBar(s) {
  const bar = div("demographics-settle-bar");
  const fill = div("demographics-settle-bar-fill");
  fill.style.width = Math.max(0, Math.min(100, s.composite)) + "%";
  // Always colour the fill: the owner's banner colour when known, else a neutral
  // gold — so an unknown/unmet civ's settlement still shows its score bar.
  fill.style.backgroundColor = s.owner.readable || s.owner.primary || "rgba(243, 195, 76, 0.85)";
  bar.appendChild(fill);
  return bar;
}

/**
 * Build the top-3 podium (visual order 2-1-3, with 1st raised via CSS).
 * @param {*[]} top The composite-sorted top settlements.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement} The podium element.
 */
function buildPodium(top, st) {
  const podium = div("demographics-settle-podium");
  const order = [top[1], top[0], top[2]];
  const places = [2, 1, 3];
  for (let i = 0; i < order.length; i++) {
    if (order[i]) podium.appendChild(buildPodiumCard(order[i], places[i], st));
  }
  return podium;
}

/**
 * Build the showcase list's column-label header row.
 * @param {string} [nameKey] LOC key for the name column (defaults to "Settlement").
 * @returns {HTMLElement} The header row.
 */
function buildListHeader(nameKey) {
  const head = div("demographics-settle-list-head");
  head.appendChild(div("demographics-settle-head-rank", t("LOC_DEMOGRAPHICS_SETTLEMENTS_COL_RANK")));
  head.appendChild(div("demographics-settle-head-spacer"));
  head.appendChild(div("demographics-settle-head-name", t(nameKey || "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_NAME")));
  head.appendChild(div("demographics-settle-head-score", t("LOC_DEMOGRAPHICS_SETTLEMENTS_COL_SCORE")));
  return head;
}

/**
 * Render the artistic Top-25 showcase: the top-3 podium, then the full ranked
 * list (1-25, so the top 3 also appear in the graphed list), with a red "Top 10"
 * divider between ranks 10 and 11.
 * @param {SettleState} st The render state.
 */
function renderShowcase(st) {
  const top = st.board.settlements.slice(0, TOP_N);
  if (!top.length) {
    st.content.appendChild(buildEmpty());
    return;
  }
  st.content.appendChild(buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_PODIUM_TITLE"));
  st.content.appendChild(buildPodium(top, st));
  st.content.appendChild(buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_RANKING_TITLE"));
  const list = div("demographics-settle-list");
  list.appendChild(buildListHeader());
  for (let i = 0; i < top.length; i++) {
    list.appendChild(buildShowcaseRow(top[i], st));
    if (i === 9 && top.length > 10) {
      list.appendChild(div("demographics-settle-top10", t("LOC_DEMOGRAPHICS_SETTLEMENTS_TOP10")));
    }
  }
  st.content.appendChild(list);
}

// ── Civilization ranking (showcase-style: cumulative score per civ) ──────────

/**
 * Fold one settlement into its owner civ's cumulative aggregate (major civs
 * only). Sums composite score, settlement count, population, and every output.
 * @param {Record<string, *>} map pid → civ aggregate (mutated).
 * @param {*} s The settlement.
 */
function aggregateCiv(map, s) {
  if (!s.owner || !s.owner.isMajor) return;
  const pid = typeof s.owner.pid === "number" ? s.owner.pid : -1;
  const c = map[pid] || (map[pid] = newCivAgg(pid, s.owner));
  c.count += 1;
  c.populationEstimate += num(s.populationEstimate);
  for (const col of SETTLEMENT_OUTPUTS) c.outputs[col.id] = (c.outputs[col.id] || 0) + num(s.outputs[col.id]);
}

/**
 * A fresh civ aggregate record.
 * @param {number} pid Owner id.
 * @param {*} owner Owner identity.
 * @returns {*} The empty aggregate.
 */
function newCivAgg(pid, owner) {
  return { pid, owner, name: owner.civName || owner.leaderName || "—", score: 0, count: 0, populationEstimate: 0, outputs: {} };
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
 * production, gold, science, culture). Population/happiness (a size and a state)
 * and the wonder count are excluded — this is raw production, not a composite.
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
 * Build the civilization ranking: each major civ ranked by total output across
 * all its settlements, with a 1-based rank and a normalized score% (vs the top
 * civ) for the bar.
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
 * Obscure an unmet civ's identity when "hide unmet players" is on (mirrors the
 * settlement masking).
 * @param {SettleState} st The render state.
 * @param {*} c The civ aggregate.
 * @returns {*} The civ to render (masked clone when applicable).
 */
function civDisplay(st, c) {
  if (st.showUnmetNames || !c.owner || c.owner.met !== false) return c;
  return Object.assign({}, c, { name: t("LOC_DEMOGRAPHICS_UNMET_CIV"), owner: maskOwner(c.owner), masked: true });
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
  fill.style.backgroundColor = c.owner.readable || c.owner.primary || "rgba(243, 195, 76, 0.85)";
  bar.appendChild(fill);
  return bar;
}

/**
 * Build a civ meta line: total (world-estimate) population + settlement count.
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
 * @param {SettleState} st The render state.
 * @returns {HTMLElement} The card element.
 */
function buildCivPodiumCard(c, place, st) {
  c = civDisplay(st, c);
  const card = div("demographics-settle-podium-card demographics-settle-rank-" + place);
  if (c.owner.readable || c.owner.primary) card.style.borderColor = c.owner.readable || c.owner.primary;
  card.appendChild(buildLaurelMedal(place));
  card.appendChild(buildOwnerAvatar(c.owner));
  card.appendChild(div("demographics-settle-podium-name", c.name));
  card.appendChild(div("demographics-settle-podium-owner", c.owner.leaderName || ""));
  card.appendChild(buildCivMeta(c));
  const scoreRow = div("demographics-settle-podium-scorerow");
  scoreRow.appendChild(div("demographics-settle-podium-score", fmt(c.score)));
  card.appendChild(scoreRow);
  card.appendChild(buildOutputStrip(c));
  return card;
}

/**
 * Build one civ ranked-list row.
 * @param {*} c The civ aggregate.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement} The row element.
 */
function buildCivRow(c, st) {
  c = civDisplay(st, c);
  const row = div("demographics-settle-list-row");
  if (c.owner.readable || c.owner.primary) row.style.setProperty("border-left-color", c.owner.readable || c.owner.primary);
  row.appendChild(div("demographics-settle-list-rank", String(c.rank)));
  row.appendChild(buildOwnerAvatar(c.owner));
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
 * @param {SettleState} st The render state.
 * @returns {HTMLElement} The podium element.
 */
function buildCivPodium(top, st) {
  const podium = div("demographics-settle-podium");
  const order = [top[1], top[0], top[2]];
  const places = [2, 1, 3];
  for (let i = 0; i < order.length; i++) {
    if (order[i]) podium.appendChild(buildCivPodiumCard(order[i], places[i], st));
  }
  return podium;
}

/**
 * Render the Civilization Ranking sub-view: a podium + ranked list of major
 * civs by cumulative settlement score (mirrors the Top-25 settlements showcase).
 * @param {SettleState} st The render state.
 */
function renderCivRanking(st) {
  const civs = buildCivBoard(st.board.settlements);
  if (!civs.length) {
    st.content.appendChild(buildEmpty());
    return;
  }
  st.content.appendChild(buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_CIV_PODIUM_TITLE"));
  st.content.appendChild(div("demographics-settle-note", t("LOC_DEMOGRAPHICS_SETTLEMENTS_CIV_SCORE_NOTE")));
  st.content.appendChild(buildCivPodium(civs.slice(0, 3), st));
  st.content.appendChild(buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_CIV_RANKING_TITLE"));
  const list = div("demographics-settle-list");
  list.appendChild(buildListHeader("LOC_DEMOGRAPHICS_SETTLEMENTS_COL_CIV"));
  for (const c of civs) list.appendChild(buildCivRow(c, st));
  st.content.appendChild(list);
}

// ── Detail table (filter + sortable + category leaders) ──────────────────────

/**
 * The table filters, in display order.
 * @type {Array<{ id: string, label: string, test: (s: *) => boolean }>}
 */
const FILTERS = [
  { id: "all", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_FILTER_ALL", test: () => true },
  { id: "cities", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_FILTER_CITIES", test: (s) => !s.isTown },
  { id: "towns", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_FILTER_TOWNS", test: (s) => s.isTown }
];

/**
 * Build the All/Cities/Towns filter chip row.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement} The chip row.
 */
function buildFilterRow(st) {
  const row = div("demographics-settle-filters");
  for (const f of FILTERS) {
    const chip = div(
      "demographics-chart-time-filter-pill" + (st.filter === f.id ? " is-active" : "")
    );
    chip.textContent = t(f.label);
    chip.addEventListener("click", () => {
      if (st.filter === f.id) return;
      st.filter = f.id;
      setSetting(st.settings, "settlementsFilter", f.id);
      safePlaySound("data-audio-activate");
      rerenderContent(st);
    });
    row.appendChild(chip);
  }
  return row;
}

/**
 * Build the "category leaders" strip: the rank-1 settlement for each output.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement} The strip element.
 */
function buildLeadersStrip(st) {
  const strip = div("demographics-settle-leaders");
  for (const col of SETTLEMENT_OUTPUTS) {
    const leader = st.board.leaders[col.id];
    if (!leader) continue;
    strip.appendChild(buildLeaderCard(col, displayOf(st, leader)));
  }
  return strip;
}

/**
 * Build one "category leader" card: a labelled "Best {metric}" eyebrow with the
 * metric icon, then the winning settlement's name, value, and owner.
 * @param {{ id: string, icon: string, label: string }} col The output column.
 * @param {*} L The (display) leader settlement.
 * @returns {HTMLElement} The leader card.
 */
function buildLeaderCard(col, L) {
  const card = div("demographics-settle-leader-card");
  const head = div("demographics-settle-leader-head");
  head.appendChild(iconEl(col.icon, "demographics-settle-leader-icon"));
  head.appendChild(div("demographics-settle-leader-cat", t("LOC_DEMOGRAPHICS_SETTLEMENTS_BEST_IN", t(col.label))));
  card.appendChild(head);
  card.appendChild(div("demographics-settle-leader-name", L.name));
  card.appendChild(
    div("demographics-settle-leader-val", fmt(valueOf(L, col.id)) + " · " + (L.owner.leaderName || ""))
  );
  return card;
}

/**
 * Build a stylized section title with flanking filigree (mimics the elaborate
 * Civ VII menu headers).
 * @param {string} key The title LOC key.
 * @returns {HTMLElement} The section-title element.
 */
function buildSectionTitle(key) {
  const wrap = div("demographics-settle-section-title");
  wrap.appendChild(iconEl("blp:header_filigree", "demographics-settle-section-fil"));
  wrap.appendChild(div("demographics-settle-section-title-text font-title", t(key)));
  wrap.appendChild(iconEl("blp:header_filigree", "demographics-settle-section-fil demographics-settle-section-fil-r"));
  return wrap;
}

/**
 * The fixed (non-output) leading columns of the table.
 * @type {Array<{ id: string, label: string }>}
 */
const FIXED_COLS = [
  { id: "rank", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_RANK" },
  { id: "owner", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_OWNER" },
  { id: "name", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_NAME" },
  { id: "type", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_TYPE" },
  { id: "composite", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_COL_SCORE" }
];

/**
 * Build a sortable header cell that re-ranks the table by `key` on click.
 * @param {SettleState} st The render state.
 * @param {string} key The sort key.
 * @param {HTMLElement} inner The header content (text or icon).
 * @returns {HTMLElement} The header cell.
 */
function buildSortHeader(st, key, inner) {
  const cell = div(
    "demographics-settle-th demographics-settle-col-" +
      key +
      (st.sortKey === key ? " is-sorted" : "")
  );
  cell.appendChild(inner);
  cell.addEventListener("click", () => {
    if (st.sortKey === key) return;
    st.sortKey = key;
    setSetting(st.settings, "settlementsSortKey", key);
    safePlaySound("data-audio-activate");
    rerenderContent(st);
  });
  return cell;
}

/**
 * Build the table header row.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement} The header row.
 */
function buildHeaderRow(st) {
  const row = div("demographics-settle-row demographics-settle-header");
  for (const c of FIXED_COLS) {
    if (c.id === "composite") {
      row.appendChild(buildSortHeader(st, "composite", div("demographics-settle-th-label", t(c.label))));
    } else {
      const cell = div("demographics-settle-th demographics-settle-col-" + c.id);
      cell.appendChild(div("demographics-settle-th-label", t(c.label)));
      row.appendChild(cell);
    }
  }
  for (const col of SETTLEMENT_OUTPUTS) {
    const inner = div("demographics-settle-th-inner");
    inner.appendChild(iconEl(col.icon, "demographics-settle-yield-icon"));
    inner.appendChild(div("demographics-settle-th-label", t(col.label)));
    row.appendChild(buildSortHeader(st, col.id, inner));
  }
  return row;
}

/**
 * Build one settlement data row for the table.
 * @param {*} s The settlement.
 * @param {number} rank The 1-based rank within the current sort.
 * @param {string} sortKey The active sort key (for cell highlight).
 * @returns {HTMLElement} The row.
 */
function buildTableRow(s, rank, sortKey) {
  const row = div("demographics-settle-row demographics-settle-datarow");
  if (s.owner.readable || s.owner.primary) row.style.setProperty("border-left-color", s.owner.readable || s.owner.primary);
  row.appendChild(div("demographics-settle-td demographics-settle-col-rank", String(rank)));
  const ownerTd = div("demographics-settle-td demographics-settle-col-owner");
  ownerTd.appendChild(buildOwnerCell(s.owner));
  row.appendChild(ownerTd);
  row.appendChild(div("demographics-settle-td demographics-settle-col-name", s.name));
  const typeTd = div("demographics-settle-td demographics-settle-col-type");
  typeTd.appendChild(buildTypeBadge(s.isTown));
  row.appendChild(typeTd);
  row.appendChild(
    div(
      "demographics-settle-td demographics-settle-col-composite demographics-settle-scorecell" +
        (sortKey === "composite" ? " is-sorted" : ""),
      fmt(s.composite)
    )
  );
  for (const col of SETTLEMENT_OUTPUTS) {
    row.appendChild(
      div(
        "demographics-settle-td demographics-settle-col-" + col.id + (sortKey === col.id ? " is-sorted" : ""),
        fmt(s.outputs[col.id])
      )
    );
  }
  return row;
}

/**
 * Render the detail table (filter + leaders strip + sortable rows).
 * @param {SettleState} st The render state.
 */
function renderTable(st) {
  st.content.appendChild(buildFilterRow(st));
  if (!st.board.settlements.length) {
    st.content.appendChild(buildEmpty());
    return;
  }
  st.content.appendChild(buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_LEADERS_TITLE"));
  st.content.appendChild(buildLeadersStrip(st));
  st.content.appendChild(buildSectionTitle("LOC_DEMOGRAPHICS_SETTLEMENTS_TABLE_TITLE"));
  const filter = FILTERS.find((f) => f.id === st.filter) || FILTERS[0];
  const rows = st.board.settlements
    .filter(filter.test)
    .slice()
    .sort((/** @type {*} */ a, /** @type {*} */ b) => valueOf(b, st.sortKey) - valueOf(a, st.sortKey))
    .slice(0, TOP_N);
  const table = div("demographics-settle-table");
  table.appendChild(buildHeaderRow(st));
  for (let i = 0; i < rows.length; i++) table.appendChild(buildTableRow(displayOf(st, rows[i]), i + 1, st.sortKey));
  st.content.appendChild(table);
}

// ── Shell ────────────────────────────────────────────────────────────────────

/**
 * Build the empty-state placeholder.
 * @returns {HTMLElement} The placeholder.
 */
function buildEmpty() {
  return div("demographics-settle-empty", t("LOC_DEMOGRAPHICS_SETTLEMENTS_EMPTY"));
}

/**
 * The sub-view tabs.
 * @type {Array<{ id: string, label: string }>}
 */
const SUBTABS = [
  { id: "civranking", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_CIVRANK" },
  { id: "civilizations", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_CIVS" },
  { id: "showcase", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_SHOWCASE" },
  { id: "table", label: "LOC_DEMOGRAPHICS_SETTLEMENTS_TAB_TABLE" }
];

/**
 * Build the sub-view selector as a native fxs-tab-bar — a 2nd-order major tab
 * bar styled like the Historical Data page tabs (rather than minor pills), so
 * Top 25 / All Settlements / Town Advisor read as co-equal major tabs.
 * @param {SettleState} st The render state.
 * @returns {HTMLElement} The tab-bar host.
 */
function buildSubTabs(st) {
  const host = div("demographics-settle-tabhost demographics-page-tab-host w-full");
  const bar = document.createElement("fxs-tab-bar");
  bar.classList.add("demographics-page-tabs", "w-full", "font-title", "text-sm");
  bar.setAttribute("data-audio-group-ref", "audio-screen-unlocks");
  bar.setAttribute("tab-item-class", "font-title text-base");
  bar.setAttribute("tab-items", JSON.stringify(SUBTABS.map((s) => ({ id: s.id, label: s.label }))));
  const idx = Math.max(0, SUBTABS.findIndex((s) => s.id === st.subTab));
  bar.setAttribute("selected-tab-index", String(idx));
  bar.addEventListener("tab-selected", (event) => {
    const id = /** @type {*} */ (event)?.detail?.selectedItem?.id;
    if (!id || (id === st.subTab && !st.detail)) return;
    st.subTab = id;
    st.detail = null; // leaving any open city dossier when switching sub-tabs
    setSetting(st.settings, "settlementsSubTab", id);
    rerenderContent(st);
  });
  host.appendChild(bar);
  return host;
}

// ── City detail dossier (click a card) ───────────────────────────────────────

/**
 * Build a labelled stat chip (optionally with a trailing glyph).
 * @param {string} label The label.
 * @param {string} value The value text.
 * @param {HTMLElement} [glyph] Optional trailing element (e.g. trend).
 * @returns {HTMLElement} The chip.
 */
function buildStatChip(label, value, glyph) {
  const chip = div("demographics-settle-statchip");
  chip.appendChild(div("demographics-settle-statchip-label", label));
  const v = div("demographics-settle-statchip-value", value);
  if (glyph) v.appendChild(glyph);
  chip.appendChild(v);
  return chip;
}

/**
 * The founded value for the dossier ("~year" when approximate, else year, else
 * unknown).
 * @param {*} s The settlement.
 * @returns {string} The founded value.
 */
function foundedValue(s) {
  const f = s.founded;
  if (!f || !f.year) return t("LOC_DEMOGRAPHICS_SETTLEMENTS_FOUNDED_UNKNOWN");
  return f.exact ? f.year : "~" + f.year;
}

/**
 * Build the dossier header: owner avatar + name + badges + rank/score.
 * @param {*} s The settlement.
 * @returns {HTMLElement} The header.
 */
function buildDetailHeader(s) {
  const header = div("demographics-settle-detail-header");
  if (s.owner.readable || s.owner.primary) header.style.borderColor = s.owner.readable || s.owner.primary;
  header.appendChild(buildOwnerAvatar(s.owner));
  const ht = div("demographics-settle-detail-htext");
  ht.appendChild(div("demographics-settle-detail-name", s.name));
  ht.appendChild(div("demographics-settle-detail-sub", s.owner.leaderName || s.owner.civName || ""));
  const badges = div("demographics-settle-detail-badges");
  badges.appendChild(buildTypeBadge(s.isTown));
  if (s.isCapital) {
    badges.appendChild(
      div("demographics-settle-badge demographics-settle-badge-city", t("LOC_DEMOGRAPHICS_SETTLEMENTS_CAPITAL"))
    );
  }
  ht.appendChild(badges);
  header.appendChild(ht);
  const rank = div("demographics-settle-detail-rank");
  rank.appendChild(div("demographics-settle-detail-rank-num", "#" + (s.ranks.composite || "—")));
  rank.appendChild(div("demographics-settle-detail-score", fmt(s.composite)));
  header.appendChild(rank);
  return header;
}

/**
 * Build the dossier stat chips (population + trend, founded).
 * @param {*} s The settlement.
 * @returns {HTMLElement} The stats row.
 */
function buildDetailStats(s) {
  const stats = div("demographics-settle-detail-stats");
  stats.appendChild(
    buildStatChip(t("LOC_DEMOGRAPHICS_SETTLEMENTS_COL_POP"), fmtPop(s.populationEstimate), buildTrendGlyph(s.trend))
  );
  stats.appendChild(buildStatChip(t("LOC_DEMOGRAPHICS_SETTLEMENTS_FOUNDED_LABEL"), foundedValue(s)));
  return stats;
}

/**
 * Build the dossier per-yield grid (icon + value, native tooltip).
 * @param {*} s The settlement.
 * @returns {HTMLElement} The yields grid.
 */
function buildDetailYields(s) {
  const yields = div("demographics-settle-detail-yields");
  for (const col of SETTLEMENT_OUTPUTS) {
    const item = div("demographics-settle-detail-yield");
    const ic = iconEl(col.icon, "demographics-settle-yield-icon");
    ic.setAttribute("data-tooltip-content", t(col.label));
    item.appendChild(ic);
    item.appendChild(div("demographics-settle-detail-yield-val", fmt(s.outputs[col.id])));
    yields.appendChild(item);
  }
  return yields;
}

/**
 * Build the dossier wonders gallery (icon + name), or a "no wonders" note.
 * @param {*} s The settlement.
 * @returns {HTMLElement} The wonders section.
 */
function buildDetailWonders(s) {
  const section = div("demographics-settle-detail-wonders");
  section.appendChild(
    div("demographics-settle-detail-section-title", t("LOC_DEMOGRAPHICS_SETTLEMENTS_WONDERS_TITLE"))
  );
  const wonders = Array.isArray(s.wonders) ? s.wonders : [];
  if (!wonders.length) {
    section.appendChild(
      div("demographics-settle-detail-nowonders", t("LOC_DEMOGRAPHICS_SETTLEMENTS_NO_WONDERS"))
    );
    return section;
  }
  const grid = div("demographics-settle-detail-wonder-grid");
  for (const w of wonders) {
    const wc = div("demographics-settle-detail-wonder");
    if (w.icon) wc.appendChild(iconEl(w.icon, "demographics-settle-wonder-icon"));
    wc.appendChild(div("demographics-settle-detail-wonder-name", w.nameKey ? t(w.nameKey) : ""));
    grid.appendChild(wc);
  }
  section.appendChild(grid);
  return section;
}

/**
 * Render the clicked city's detail dossier into the content host.
 * @param {SettleState} st The render state.
 */
function renderDetail(st) {
  const s = st.detail;
  if (!s) {
    renderShowcase(st);
    return;
  }
  const panel = div("demographics-settle-detail");
  const back = div("demographics-settle-back demographics-settle-clickable");
  back.textContent = t("LOC_DEMOGRAPHICS_SETTLEMENTS_BACK");
  back.addEventListener("click", () => {
    st.detail = null;
    safePlaySound("data-audio-activate");
    rerenderContent(st);
  });
  panel.appendChild(back);
  panel.appendChild(buildDetailHeader(s));
  const cams = buildCameraButtons(s, st);
  if (cams) panel.appendChild(cams);
  panel.appendChild(buildDetailStats(s));
  panel.appendChild(buildDetailYields(s));
  panel.appendChild(buildDetailWonders(s));
  st.content.appendChild(panel);
}

/**
 * Clear and re-render the active sub-view into the content host.
 * @param {SettleState} st The render state.
 */
function rerenderContent(st) {
  while (st.content.firstChild) st.content.removeChild(st.content.firstChild);
  // A clicked city opens the detail dossier over the current content.
  if (st.detail) {
    renderDetail(st);
    return;
  }
  // Civilizations = the per-civ World Factbook matrix (built from sampled
  // history); the other two are the live settlement rankings.
  if (st.subTab === "civranking") {
    renderCivRanking(st);
  } else if (st.subTab === "civilizations") {
    ViewFactbook.render(st.content, { history: st.history, settings: st.settings });
  } else if (st.subTab === "table") renderTable(st);
  else renderShowcase(st);
}

/**
 * Render the Settlements view.
 * @param {HTMLElement} host The view host element.
 * @param {*} ctx Render context ({ settings }).
 */
export function render(host, ctx) {
  const settings = ctx?.settings;
  let subTab = getSetting(settings, "settlementsSubTab", "civranking");
  // Coerce a stale/removed sub-tab (e.g. the removed "towns"/"advisor") to the
  // default Civilization Ranking view.
  if (!SUBTABS.some((s) => s.id === subTab)) subTab = "civranking";
  /** @type {SettleState} */
  const st = {
    settings,
    history: ctx?.history,
    board: buildSettlementBoard(),
    content: div("demographics-settle-content"),
    subTab,
    filter: getSetting(settings, "settlementsFilter", "all"),
    sortKey: getSetting(settings, "settlementsSortKey", "composite"),
    showUnmetNames: getSetting(settings, "showUnmetNames", false) === true
  };
  const wrap = div("demographics-settle-view");
  wrap.appendChild(buildSubTabs(st));
  wrap.appendChild(st.content);
  host.appendChild(wrap);
  rerenderContent(st);
}
