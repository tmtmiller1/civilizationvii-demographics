// view-hof-best.js
//
// The Hall of Fame's landing page: a strip of totals, a podium for the three best games, the rest
// of the top ten, and the current game placed at its rank between its neighbours, beside victories
// by type. Ranking follows history-hof.js ranked().

import { el } from "/demographics/ui/history/core/history-dom.js";
import { t, num, typeName, victoryName } from "/demographics/ui/history/core/history-text.js";
import { overview, standing, statOf, titleIndex } from "/demographics/ui/history/model/history-hof.js";
import {
  emptyState, laurelMedal, leaderIcon, outcomeMark, pageHead, section, statTile, table, trophyIcon,
  victoryIcon, civProgression
} from "/demographics/ui/history/views/history-widgets.js";
import { outcomeLabel, titleName } from "/demographics/ui/history/views/history-format.js";
import { viewState } from "/demographics/ui/history/views/history-state.js";

/** Games listed on the landing page. */
const TOP_N = 10;
/** Index of the civilizations column in rankTable. */
const CIVS_COL = 4;

/**
 * @typedef {import("./view-hof.js").HofCtx} HofCtx
 */

/**
 * Open a game's page.
 * @param {string} id Record id.
 * @param {HofCtx} ctx Context.
 */
function openGame(id, ctx) {
  viewState.detail = id;
  viewState.tlCivs = null;
  ctx.rerender();
}

/**
 * The civilizations a game's leader led, with emblems.
 * @param {ArchiveRecord} rec Record.
 * @param {string} cls Size variant.
 * @returns {HTMLElement} Progression.
 */
function progression(rec, cls) {
  return civProgression(rec.civs, (c) => typeName(c.name, c.civ), cls);
}

/**
 * A slim strip of totals: games, victories, win rate, turns, Triumphs.
 * @param {ArchiveRecord[]} records Visible games.
 * @returns {HTMLElement} Strip.
 */
function totals(records) {
  const o = overview(records);
  const rate = o.finished ? Math.round((100 * o.victories) / o.finished) : 0;
  return el("div", { cls: "dgh-tiles dgh-tiles--slim" }, [
    statTile(num(o.games), t("LOC_DEMOGRAPHICS_HIST_STAT_GAMES")),
    statTile(num(o.victories), t("LOC_DEMOGRAPHICS_HIST_STAT_VICTORIES")),
    statTile(t("LOC_DEMOGRAPHICS_HIST_PERCENT", rate), t("LOC_DEMOGRAPHICS_HIST_STAT_WIN_RATE")),
    statTile(num(o.turns), t("LOC_DEMOGRAPHICS_HIST_STAT_TURNS")),
    statTile(num(o.triumphs), t("LOC_DEMOGRAPHICS_HIST_STAT_TRIUMPHS"), trophyIcon())
  ]);
}

/**
 * One podium place: rank, portrait, honorific, leader, civilizations, result and figures.
 * @param {ArchiveRecord} rec Game.
 * @param {number} rank 1-3.
 * @param {number} best Most Triumphs in any game (the honorific scale).
 * @param {string} currentId The current game.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement} Card.
 */
function podiumCard(rec, rank, best, currentId, ctx) {
  const card = el("div", { cls: "dgh-podium-card dgh-podium-card--" + rank + (rec.id === currentId ? " is-current" : "") }, [
    laurelMedal(rank, "dgh-podium-rank"),
    leaderIcon(rec.leader, "dgh-leader-icon dgh-podium-portrait"),
    el("div", { cls: "dgh-podium-honor", text: titleName(titleIndex(rec, best)) }),
    el("div", { cls: "dgh-podium-name", text: typeName(rec.leaderName, rec.leader) }),
    progression(rec, "dgh-progression--sm dgh-podium-civs"),
    el("div", { cls: "dgh-podium-result" }, [outcomeMark(rec.outcome), el("div", { text: outcomeLabel(rec) })]),
    el("div", { cls: "dgh-podium-figures" }, [
      el("div", { text: t("LOC_DEMOGRAPHICS_HIST_N_TURNS", rec.turns) + "  ·  " }),
      trophyIcon("dgh-trophy-icon dgh-trophy-icon--sm"),
      el("div", { text: t("LOC_DEMOGRAPHICS_HIST_N_TRIUMPHS", statOf(rec, "triumphs")) })
    ]),
    rec.id === currentId ? el("div", { cls: "dgh-podium-current", text: t(ctx.live ? "LOC_DEMOGRAPHICS_HIST_THIS_GAME" : "LOC_DEMOGRAPHICS_HIST_LATEST_GAME") }) : null
  ]);
  card.addEventListener("click", () => openGame(rec.id, ctx));
  return card;
}

/**
 * The podium: second, first and third place, the first raised in the middle.
 * @param {ArchiveRecord[]} top Best games.
 * @param {number} best Honorific scale.
 * @param {string} currentId Current game.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement} Podium.
 */
function podium(top, best, currentId, ctx) {
  const at = (/** @type {number} */ i) => (top[i] ? podiumCard(top[i], i + 1, best, currentId, ctx) : null);
  return el("div", { cls: "dgh-podium" }, [at(1), at(0), at(2)]);
}

/**
 * A compact ranked table (rank, honorific, leader, civilizations, result, turns, Triumphs).
 * @param {{rec: ArchiveRecord, rank: number}[]} rows Games with their ranks.
 * @param {number} best Honorific scale.
 * @param {string} currentId Current game (highlighted).
 * @param {HofCtx} ctx Context.
 * @param {boolean} [narrow] Leave out the civilizations (for the side column).
 * @returns {HTMLElement} Table.
 */
function rankTable(rows, best, currentId, ctx, narrow = false) {
  const all = [
    { label: "#", cls: "dgh-col-xs" }, { label: t("LOC_DEMOGRAPHICS_HIST_COL_TITLE"), cls: "dgh-col-md" }, { label: "", cls: "dgh-col-icon" },
    { label: t("LOC_DEMOGRAPHICS_HIST_COL_LEADER"), cls: "dgh-col-md" }, { label: t("LOC_DEMOGRAPHICS_HIST_COL_CIVILIZATIONS"), cls: "dgh-col-grow" },
    { label: t("LOC_DEMOGRAPHICS_HIST_COL_RESULT"), cls: "dgh-col-result" }, { label: t("LOC_DEMOGRAPHICS_HIST_COL_TURNS"), cls: "dgh-col-num" },
    { label: t("LOC_DEMOGRAPHICS_HIST_COL_TRIUMPHS"), cls: "dgh-col-num" }
  ];
  const keep = (/** @type {*} */ _x, /** @type {number} */ i) => !narrow || i !== CIVS_COL;
  const cols = all.filter(keep);
  const cells = rows.map(({ rec, rank }) => [
    num(rank), titleName(titleIndex(rec, best)), leaderIcon(rec.leader, "dgh-leader-icon dgh-leader-icon--sm"),
    typeName(rec.leaderName, rec.leader), progression(rec, "dgh-progression--sm"),
    el("div", { cls: "dgh-result-row" }, [outcomeMark(rec.outcome), el("div", { cls: "dgh-result", text: outcomeLabel(rec) })]),
    num(rec.turns), num(statOf(rec, "triumphs"))
  ].filter(keep));
  return table(cols, cells, {
    onRow: (i) => openGame(rows[i].rec.id, ctx),
    highlight: (i) => rows[i].rec.id === currentId
  });
}

/**
 * The current game at its rank, between the games just above and below it.
 * @param {import("../model/history-hof.js").Standing["current"]} cur Current game's standing.
 * @param {number} best Honorific scale.
 * @param {HofCtx} ctx Context.
 * @returns {HTMLElement|null} Section.
 */
function currentInContext(cur, best, ctx) {
  if (!cur) return null;
  const rows = [
    cur.above ? { rec: cur.above, rank: cur.rank - 1 } : null,
    { rec: cur.rec, rank: cur.rank },
    cur.below ? { rec: cur.below, rank: cur.rank + 1 } : null
  ].filter((x) => !!x).map((x) => /** @type {{rec: ArchiveRecord, rank: number}} */ (x));
  const title = t(ctx.live ? "LOC_DEMOGRAPHICS_HIST_THIS_GAME" : "LOC_DEMOGRAPHICS_HIST_LATEST_GAME");
  return section(title, [
    el("div", { cls: "dgh-standing" }, [
      el("div", { cls: "dgh-standing-rank", text: t("LOC_DEMOGRAPHICS_HIST_RANK_OF", cur.rank, cur.of) }),
      el("div", { cls: "dgh-standing-note", text: cur.rank <= TOP_N ? t("LOC_DEMOGRAPHICS_HIST_IN_TOP_TEN") : t("LOC_DEMOGRAPHICS_HIST_RANKING_RULE") })
    ]),
    rankTable(rows, best, cur.rec.id, ctx, true)
  ], "dgh-col dgh-standing-section");
}

/**
 * Victories by type, as bars.
 * @param {ArchiveRecord[]} records Visible games.
 * @returns {HTMLElement} Section.
 */
function victoriesByType(records) {
  const o = overview(records);
  const rows = o.victoriesByType.map(([type, n]) => {
    const rec = records.find((r) => r.outcome.victory === type);
    return el("div", { cls: "dgh-bar-row" }, [
      victoryIcon(rec?.outcome.cls || "", "dgh-victory-icon dgh-mark"),
      el("div", { cls: "dgh-bar-label", text: victoryName(type, rec?.outcome.name || "") }),
      el("div", { cls: "dgh-bar" }, [el("div", { cls: "dgh-bar-fill", style: { width: Math.round((100 * n) / Math.max(1, o.victories)) + "%" } })]),
      el("div", { cls: "dgh-bar-n", text: num(n) })
    ]);
  });
  return section(t("LOC_DEMOGRAPHICS_HIST_VICTORIES_BY_TYPE"), rows.length ? rows : [emptyState(t("LOC_DEMOGRAPHICS_HIST_NO_VICTORIES"))], "dgh-col");
}

/**
 * The landing page.
 * @param {HTMLElement} host Container.
 * @param {ArchiveRecord[]} records Visible games.
 * @param {ArchiveRecord[]} all Every game (the honorific scale).
 * @param {HofCtx} ctx Context.
 */
export function renderBest(host, records, all, ctx) {
  const best = Math.max(0, ...all.map((r) => statOf(r, "triumphs")));
  const st = standing(records, ctx.live?.id || "", TOP_N);
  const currentId = st.current?.rec.id || "";
  const rest = st.top.slice(3).map((rec, i) => ({ rec, rank: i + 4 }));
  host.appendChild(el("div", { cls: "dgh-scroll dgh-best" }, [
    pageHead(t("LOC_DEMOGRAPHICS_HIST_HOF_BEST"), t("LOC_DEMOGRAPHICS_HIST_BEST_NOTE")),
    totals(records),
    section(t("LOC_DEMOGRAPHICS_HIST_BEST_TITLE"), [podium(st.top, best, currentId, ctx)]),
    el("div", { cls: "dgh-cols" }, [
      rest.length ? section(t("LOC_DEMOGRAPHICS_HIST_NEXT_BEST"), [rankTable(rest, best, currentId, ctx)], "dgh-col dgh-col--wide") : null,
      el("div", { cls: "dgh-col dgh-col-stack" }, [currentInContext(st.current, best, ctx), victoriesByType(records)])
    ])
  ]));
}
