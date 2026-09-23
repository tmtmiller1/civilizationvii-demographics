// view-hof-games.js
//
// Hall of Fame Rankings (every game, ranked, with its honorific) and the detail page of one game:
// result, lineage, figures, a Triumph and settlement trend, rivals and highlights. A game can be
// removed from the Hall of Fame from the Options panel at the foot of its detail page (open the
// panel, then two clicks, so it is never accidental).

import { el, clear } from "/demographics/ui/history/core/history-dom.js";
import { t, num, typeName, legacyWhyKey, legacyWhatKey } from "/demographics/ui/history/core/history-text.js";
import { deleteRecord } from "/demographics/ui/history/store/history-archive-store.js";
import { ranked, statOf, titleIndex } from "/demographics/ui/history/model/history-hof.js";
import { castFromRecord, eventText } from "/demographics/ui/history/model/history-narrate.js";
import {
  civChip, civIcon, civProgression, emptyState, leaderIcon, outcomeMark, pageHead, pillRow, section, statTile, table,
  textButton
} from "/demographics/ui/history/views/history-widgets.js";

/**
 * A game's civilizations, in order, with their emblems.
 * @param {ArchiveRecord} rec Record.
 * @param {string} [cls] Size variant.
 * @returns {HTMLElement} The progression.
 */
function progressionOf(rec, cls = "") {
  return civProgression(rec.civs, (c) => typeName(c.name, c.civ), cls);
}
import { readableColor } from "/demographics/ui/history/views/history-colors.js";
import { formatBigNumber } from "/demographics/ui/metrics/metrics-format.js";
import { unpackTimeline } from "/demographics/ui/history/model/history-timeline.js";
import { timelineWithMap } from "/demographics/ui/history/views/history-timeline-view.js";
import { unpackMap } from "/demographics/ui/history/model/history-map.js";
import { DemographicsSettings } from "/demographics/ui/core/demographics-settings.js";

/** The Scaled / Civ numbers setting World Rankings uses, shared so both views agree. */
const NUMBER_MODE_KEY = "worldRankingsAllCivsNumberMode";

/**
 * The number mode: "scaled" (Demographics' real-world figures) or "civ" (the game's own counts).
 * @returns {string} Mode.
 */
function numberMode() {
  try {
    return DemographicsSettings.getSetting(NUMBER_MODE_KEY, "scaled") === "civ" ? "civ" : "scaled";
  } catch (_) {
    // Settings unavailable: Demographics' default.
    return "scaled";
  }
}

/**
 * The population figure in the chosen mode. Games recorded before scaled population existed show
 * the civ count.
 * @param {ArchiveRecord} rec Record.
 * @returns {string} Formatted population.
 */
export function populationText(rec) {
  const scaled = statOf(rec, "populationScaled");
  return numberMode() === "scaled" && scaled ? formatBigNumber(scaled) : num(statOf(rec, "population"));
}
import { sparkline } from "/demographics/ui/history/views/history-chart.js";
import { outcomeLabel, outcomeClass, setupLine, dateLabel, titleName } from "/demographics/ui/history/views/history-format.js";
import { viewState } from "/demographics/ui/history/views/history-state.js";

/** @typedef {import("./view-hof.js").HofCtx} HofCtx */

/**
 * Open a game's detail page.
 * @param {string} id Record id.
 * @param {HofCtx} ctx Context.
 */
function openGame(id, ctx) {
  viewState.detail = id;
  viewState.tlCivs = null; // every game opens on your own civilization's story

  ctx.rerender();
}

/**
 * A clickable summary card for one game.
 * @param {ArchiveRecord} rec Record.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement} Card.
 */
export function gameCard(rec, ctx) {
  const card = el("div", { cls: "dgh-game-card is-clickable" }, [
    leaderIcon(rec.leader, "dgh-leader-icon dgh-leader-icon--lg"),
    el("div", { cls: "dgh-game-card-body" }, [
      el("div", { cls: "dgh-game-card-title", text: typeName(rec.leaderName, rec.leader) }),
      progressionOf(rec, "dgh-progression--sm"),
      el("div", { cls: "dgh-game-card-line dgh-result-row" }, [
        outcomeMark(rec.outcome),
        el("div", { cls: "dgh-accent", text: outcomeLabel(rec) + "  ·  " + t("LOC_DEMOGRAPHICS_HIST_N_TURNS", rec.turns) })
      ])
    ])
  ]);
  card.addEventListener("click", () => openGame(rec.id, ctx));
  return card;
}

/**
 * A result cell: the outcome marker and its label.
 * @param {ArchiveRecord} r Record.
 * @returns {HTMLElement} Cell content.
 */
function resultCell(r) {
  return el("div", { cls: "dgh-result-row" }, [
    outcomeMark(r.outcome),
    el("div", { cls: "dgh-result dgh-result--" + outcomeClass(r), text: outcomeLabel(r) })
  ]);
}

/**
 * Rankings table.
 * @param {HTMLElement} host Container.
 * @param {ArchiveRecord[]} records Visible records.
 * @param {ArchiveRecord[]} all Every record (for the honorific scale).
 * @param {HofCtx} ctx Context.
 */
export function renderGames(host, records, all, ctx) {
  clear(host);
  const best = Math.max(0, ...all.map((r) => statOf(r, "triumphs")));
  const list = ranked(records);
  const cols = [
    { label: "#", cls: "dgh-col-xs" }, { label: t("LOC_DEMOGRAPHICS_HIST_COL_TITLE"), cls: "dgh-col-md" }, { label: "", cls: "dgh-col-icon" },
    { label: t("LOC_DEMOGRAPHICS_HIST_COL_LEADER"), cls: "dgh-col-md" }, { label: t("LOC_DEMOGRAPHICS_HIST_COL_CIVILIZATIONS"), cls: "dgh-col-grow" },
    { label: t("LOC_DEMOGRAPHICS_HIST_COL_RESULT"), cls: "dgh-col-result" }, { label: t("LOC_DEMOGRAPHICS_HIST_COL_TURNS"), cls: "dgh-col-num" },
    { label: t("LOC_DEMOGRAPHICS_HIST_COL_TRIUMPHS"), cls: "dgh-col-num" }, { label: t("LOC_DEMOGRAPHICS_HIST_COL_PLAYED"), cls: "dgh-col-sm" },
    { label: t("LOC_DEMOGRAPHICS_HIST_COL_TREND"), cls: "dgh-col-spark" }
  ];
  const rows = list.map((r, i) => [
    num(i + 1), titleName(titleIndex(r, best)), leaderIcon(r.leader, "dgh-leader-icon dgh-leader-icon--sm"),
    typeName(r.leaderName, r.leader), progressionOf(r, "dgh-progression--sm"), resultCell(r),
    num(r.turns), num(statOf(r, "triumphs")), dateLabel(r.updated), sparkline(r.spark?.tri || [], readableColor(r.color, r.color2 || ""))
  ]);
  host.appendChild(el("div", { cls: "dgh-toolbar" }, [
    pageHead(t("LOC_DEMOGRAPHICS_HIST_HOF_RANKINGS"), t("LOC_DEMOGRAPHICS_HIST_RANKING_RULE"))
  ]));
  host.appendChild(el("div", { cls: "dgh-scroll" }, [
    rows.length ? table(cols, rows, { onRow: (i) => openGame(list[i].id, ctx) }) : emptyState(t("LOC_DEMOGRAPHICS_HIST_EMPTY_HOF"))
  ]));
}

/**
 * A rival's fate from its elimination turn (0 alive, -1 gone before recording began).
 * @param {number} elim Elimination turn.
 * @returns {string} Localized fate.
 */
function fateText(elim) {
  if (elim === -1) return t("LOC_DEMOGRAPHICS_HIST_FATE_BEFORE");
  return elim ? t("LOC_DEMOGRAPHICS_HIST_FATE_DESTROYED", elim) : t("LOC_DEMOGRAPHICS_HIST_FATE_SURVIVED");
}

/**
 * Rivals table for a game.
 * @param {ArchiveRecord} rec Record.
 * @returns {HTMLElement} Table.
 */
function rivalsTable(rec) {
  const cast = castFromRecord(rec);
  const cols = [
    { label: "", cls: "dgh-col-icon" }, { label: t("LOC_DEMOGRAPHICS_HIST_COL_LEADER"), cls: "dgh-col-md" },
    { label: t("LOC_DEMOGRAPHICS_HIST_COL_CIVILIZATION"), cls: "dgh-col-grow" }, { label: t("LOC_DEMOGRAPHICS_HIST_COL_TRIUMPHS"), cls: "dgh-col-num" },
    { label: t("LOC_DEMOGRAPHICS_HIST_COL_FATE"), cls: "dgh-col-lg" }
  ];
  const list = (rec.rivals || []).slice().sort((a, b) => b[7] - a[7]);
  const rows = list.map((r) => [
    leaderIcon(r[1], "dgh-leader-icon dgh-leader-icon--sm"), typeName(r[2], r[1]), r[3] ? civChip(typeName(r[4], r[3]), cast.color(r[0]), r[3]) : "—",
    num(r[7]), fateText(r[6])
  ]);
  return table(cols, rows);
}

/**
 * Header block of the detail page.
 * @param {ArchiveRecord} rec Record.
 * @param {number} best Best Triumph count across games.
 * @returns {HTMLElement} Header.
 */
function detailHeader(rec, best) {
  return el("div", { cls: "dgh-detail-head" }, [
    leaderIcon(rec.leader, "dgh-leader-icon dgh-leader-icon--xl"),
    el("div", { cls: "dgh-detail-titles" }, [
      el("div", { cls: "dgh-detail-name", text: typeName(rec.leaderName, rec.leader) }),
      el("div", { cls: "dgh-detail-honor", text: titleName(titleIndex(rec, best)) }),
      progressionOf(rec, "dgh-progression--lg"),
      el("div", { cls: "dgh-detail-line dgh-result-row" }, [
        outcomeMark(rec.outcome),
        el("div", { cls: "dgh-result dgh-result--" + outcomeClass(rec), text: outcomeLabel(rec) })
      ]),
      el("div", { cls: "dgh-detail-line dgh-muted", text: setupLine(rec.setup || {}) + "  ·  " + dateLabel(rec.updated) })
    ])
  ]);
}

/**
 * The header row: the leader and the game on the left, the Scaled / Civ toggle and the figures on
 * the right, on one line.
 * @param {ArchiveRecord} rec Record.
 * @param {number} best Most Triumphs in any game.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement} Row.
 */
function detailTop(rec, best, ctx) {
  return el("div", { cls: "dgh-detail-top" }, [
    detailHeader(rec, best),
    el("div", { cls: "dgh-detail-figures" }, [numberToggle(rec, ctx), detailTiles(rec)])
  ]);
}

/**
 * Figures of one game.
 * @param {ArchiveRecord} rec Record.
 * @returns {HTMLElement} Tiles.
 */
function detailTiles(rec) {
  const s = (/** @type {keyof ArchiveRecord["stats"]} */ key) => num(statOf(rec, key));
  return el("div", { cls: "dgh-tiles" }, [
    statTile(num(rec.turns), t("LOC_DEMOGRAPHICS_HIST_COL_TURNS")), statTile(s("triumphs"), t("LOC_DEMOGRAPHICS_HIST_COL_TRIUMPHS")),
    statTile(s("peakSettlements"), t("LOC_DEMOGRAPHICS_HIST_STAT_PEAK_SETTLEMENTS")), statTile(populationText(rec), t("LOC_DEMOGRAPHICS_HIST_COL_POPULATION")),
    statTile(s("wonders"), t("LOC_DEMOGRAPHICS_HIST_FACT_WONDERS")), statTile(s("captured"), t("LOC_DEMOGRAPHICS_HIST_FACT_CAPTURED")),
    statTile(s("wars"), t("LOC_DEMOGRAPHICS_HIST_FACT_WARS"))
  ]);
}

/**
 * The game's timeline, with the territory map and the rivals above it. A record without a timeline
 * shows the rivals alone.
 * @param {ArchiveRecord} rec Record.
 * @returns {HTMLElement} Section.
 */
function timelineSection(rec) {
  const rivals = el("div", { cls: "dgh-rivals" }, [
    el("div", { cls: "dgh-map-title", text: t("LOC_DEMOGRAPHICS_HIST_RIVALS") }),
    rec.rivals?.length ? rivalsTable(rec) : emptyState(t("LOC_DEMOGRAPHICS_HIST_NO_RIVALS"))
  ]);
  const tl = unpackTimeline(rec.tl);
  if (!tl) return section("", [rivals]);
  return section(t("LOC_DEMOGRAPHICS_HIST_TL_TITLE"), timelineWithMap(tl, unpackMap(rec.map), castFromRecord(rec), rivals, rec.id));
}

/**
 * The Scaled / Civ toggle for the figures, shown when the game has scaled population.
 * @param {ArchiveRecord} rec Record.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement|null} The toggle.
 */
function numberToggle(rec, ctx) {
  if (!statOf(rec, "populationScaled")) return null;
  const items = [
    { key: "scaled", label: t("LOC_DEMOGRAPHICS_HIST_POP_SCALED") },
    { key: "civ", label: t("LOC_DEMOGRAPHICS_HIST_POP_CIV") }
  ];
  return pillRow(items, numberMode(), (m) => {
    try {
      DemographicsSettings.setSetting(NUMBER_MODE_KEY, m);
    } catch (_) {
      // best-effort: the view still redraws with the default
    }
    ctx.rerender();
  }, "filter");
}

/**
 * The game's highlights across the page, grouped by age: date, a tag naming the kind of event, the
 * other civilization's emblem and the sentence.
 * @param {ArchiveRecord} rec Record.
 * @returns {HTMLElement} Section.
 */
function highlightsSection(rec) {
  const title = t("LOC_DEMOGRAPHICS_HIST_HIGHLIGHTS");
  const highlights = Array.isArray(rec.highlights) ? rec.highlights : [];
  const ages = Array.isArray(rec.ages) ? rec.ages : [];
  if (!highlights.length) return section(title, [emptyState(t("LOC_DEMOGRAPHICS_HIST_NO_HIGHLIGHTS"))]);
  const cast = castFromRecord(rec);
  /** @type {Array<HTMLElement>} */
  const body = [];
  let ageIdx = -1;
  for (const e of highlights) {
    const age = ages[e.a] || "";
    if (e.a !== ageIdx) {
      ageIdx = e.a;
      const civ = cast.civType(rec.local, age);
      body.push(el("div", { cls: "dgh-hl-age" }, [
        civ ? civIcon(civ, "dgh-civ-icon dgh-hl-age-icon") : null,
        el("div", { cls: "dgh-hl-age-name", text: typeName("LOC_" + age + "_NAME", age) }),
        el("div", { cls: "dgh-hl-age-civ", text: cast.civName(rec.local, age) })
      ]));
    }
    body.push(highlightRow(e, cast, age, rec.local));
  }
  return section(title, [el("div", { cls: "dgh-hl" }, body)], "dgh-hl-section");
}

/**
 * One highlight.
 * @param {HnrEvent} e Event.
 * @param {import("../model/history-narrate.js").Cast} cast Cast.
 * @param {string} age Age type.
 * @param {number} local Local player id.
 * @returns {HTMLElement} Row.
 */
function highlightRow(e, cast, age, local) {
  const other = e.p === local ? e.q : e.p;
  const otherCiv = other != null && other >= 0 && other !== local ? cast.civType(other, age) : "";
  return el("div", { cls: "dgh-hl-row dgh-event--" + e.k + (e.p === local ? " is-mine" : "") }, [
    el("div", { cls: "dgh-hl-date", text: e.d || t("LOC_DEMOGRAPHICS_HIST_TURN_N", e.t) }),
    el("div", { cls: "dgh-hl-kind dgh-kind--" + e.k, text: t("LOC_DEMOGRAPHICS_HIST_KIND_" + e.k.toUpperCase()) }),
    el("div", { cls: "dgh-hl-emblem" }, [otherCiv ? civIcon(otherCiv, "dgh-civ-icon dgh-hl-icon") : null]),
    el("div", { cls: "dgh-hl-body" }, [el("div", { cls: "dgh-event-text", text: eventText(e, cast, age) }), triumphBlurb(e)]),
    el("div", { cls: "dgh-hl-turn", text: t("LOC_DEMOGRAPHICS_HIST_TURN_N", e.t) })
  ]);
}

/**
 * Under a Triumph, what it was earned for and what it gave, in the game's own words. Both were
 * saved with the archive when the game was played, so they read at the main menu too.
 * @param {HnrEvent} e Event.
 * @returns {HTMLElement|null} The lines, or null for anything but a Triumph.
 */
function triumphBlurb(e) {
  if (e.k !== "triumph" || !e.x) return null;
  const why = t(legacyWhyKey(String(e.x)));
  const what = t(legacyWhatKey(String(e.x)));
  const line = (/** @type {string} */ label, /** @type {string} */ text) => (
    text && !text.startsWith("DGH_")
      ? el("div", { cls: "dgh-hl-blurb" }, [
        el("span", { cls: "dgh-hl-blurb-l", text: t(label) }),
        el("span", { cls: "dgh-hl-blurb-t", text: text })
      ])
      : null
  );
  const rows = [line("LOC_DEMOGRAPHICS_HIST_TRIUMPH_FOR", why), line("LOC_DEMOGRAPHICS_HIST_TRIUMPH_GAVE", what)].filter(Boolean);
  return rows.length ? el("div", { cls: "dgh-hl-blurbs" }, rows) : null;
}

/**
 * The remove button: first click arms it, the second removes the game.
 * @param {ArchiveRecord} rec Record.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement} Button.
 */
function removeButton(rec, ctx) {
  let armed = false;
  const b = textButton("LOC_DEMOGRAPHICS_HIST_REMOVE_GAME", () => {
    if (!armed) {
      armed = true;
      b.textContent = t("LOC_DEMOGRAPHICS_HIST_REMOVE_CONFIRM");
      b.classList.add("is-armed");
      return;
    }
    deleteRecord(rec.id);
    viewState.detail = null;
    ctx.rerender();
  }, "dgh-button--danger");
  return b;
}

/**
 * The game's options, folded away at the foot of the page so removing a game takes a deliberate
 * reach: the Options toggle opens a small panel holding the (two-click) remove button.
 * @param {ArchiveRecord} rec Record.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement} The options block.
 */
function gameOptions(rec, ctx) {
  const panel = el("div", { cls: "dgh-options-panel is-hidden" }, [
    el("div", { cls: "dgh-options-note", text: t("LOC_DEMOGRAPHICS_HIST_REMOVE_NOTE") }),
    removeButton(rec, ctx)
  ]);
  const toggle = textButton("LOC_DEMOGRAPHICS_HIST_GAME_OPTIONS", () => {
    const open = panel.classList.contains("is-hidden");
    if (open) { panel.classList.remove("is-hidden"); toggle.classList.add("is-open"); }
    else { panel.classList.add("is-hidden"); toggle.classList.remove("is-open"); }
  }, "dgh-options-toggle");
  return el("div", { cls: "dgh-options" }, [toggle, panel]);
}

/**
 * Detail page of one game. The Back button goes in first, before anything that reads the record: a
 * page that fails halfway then still has its way out, instead of stranding the player on a blank
 * page whose only exit is closing the screen.
 * @param {HTMLElement} host Container.
 * @param {ArchiveRecord} rec Record.
 * @param {ArchiveRecord[]} all Every record.
 * @param {HofCtx} ctx Context.
 */
export function renderDetail(host, rec, all, ctx) {
  clear(host);
  const back = textButton("LOC_DEMOGRAPHICS_HIST_BACK_TO_HOF", () => { viewState.detail = null; ctx.rerender(); }, "dgh-button--back");
  back.insertBefore(el("span", { cls: "dgh-back-arrow", text: "←" }), back.firstChild);
  host.appendChild(el("div", { cls: "dgh-toolbar" }, [back]));
  const best = Math.max(0, ...all.map((r) => statOf(r, "triumphs")));
  host.appendChild(el("div", { cls: "dgh-scroll dgh-detail" }, [
    detailTop(rec, best, ctx),
    timelineSection(rec),
    highlightsSection(rec),
    gameOptions(rec, ctx)
  ]));
}
