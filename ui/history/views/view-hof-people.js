// view-hof-people.js
//
// Hall of Fame Leaders and Civilizations cards (games, victories, best Triumphs, average length)
// and the Records board (the single best game for each record).

import { el, clear } from "/demographics/ui/history/core/history-dom.js";
import { t, num, typeName } from "/demographics/ui/history/core/history-text.js";
import { leaderRows, civRows, recordHolders } from "/demographics/ui/history/model/history-hof.js";
import { civIcon, emptyState, leaderIcon, pageHead, section } from "/demographics/ui/history/views/history-widgets.js";
import { gameCard } from "/demographics/ui/history/views/view-hof-games.js";

/** @typedef {import("./view-hof.js").HofCtx} HofCtx */
/** @typedef {import("../model/history-hof.js").GroupRow} GroupRow */

/**
 * One figure on a card.
 * @param {string} value Formatted value.
 * @param {string} label LOC tag.
 * @returns {HTMLElement} Chip.
 */
function figure(value, label) {
  return el("div", { cls: "dgh-fact" }, [el("div", { cls: "dgh-fact-n", text: value }), el("div", { cls: "dgh-fact-l", text: t(label) })]);
}

/**
 * The parts of the bar: the finished games, split into those won and those not. Games still being
 * played are left out — they have no result yet, so they cannot be won or lost.
 * @param {GroupRow} r Row.
 * @returns {{key: string, n: number, label: string, pct: number}[]} Parts, empty ones left out.
 */
function recordParts(r) {
  const finished = Math.max(0, r.finished);
  const share = (/** @type {number} */ n) => (finished ? Math.round((100 * n) / finished) : 0);
  return [
    { key: "win", n: r.wins, label: "LOC_DEMOGRAPHICS_HIST_N_WON", pct: share(r.wins) },
    { key: "loss", n: finished - r.wins, label: "LOC_DEMOGRAPHICS_HIST_N_NOT_WON", pct: share(finished - r.wins) }
  ].filter((p) => p.n > 0);
}

/**
 * The win rate as a bar: green for the games won, red for the rest of the finished games. With
 * nothing finished the bar stays empty, so grey always means "no result yet".
 * @param {GroupRow} r Row.
 * @returns {HTMLElement} Bar.
 */
function recordBar(r) {
  const total = Math.max(1, r.finished);
  return el("div", { cls: "dgh-record-bar" }, recordParts(r).map(
    (p) => el("div", { cls: "dgh-record-seg dgh-record-seg--" + p.key, style: { width: (100 * p.n) / total + "%" } })
  ));
}

/**
 * What the bar is made of, in words: "Victories: 2 (67%) · No victory: 1 (33%)", each part in its
 * own colour, with any unfinished games named after them.
 * @param {GroupRow} r Row.
 * @returns {HTMLElement} Legend.
 */
function recordLegend(r) {
  /** @type {(HTMLElement|null)[]} */
  const items = [];
  const add = (/** @type {string} */ key, /** @type {string} */ text) => {
    if (items.length) items.push(el("span", { cls: "dgh-record-sep", text: "·" }));
    items.push(el("span", { cls: "dgh-record-key dgh-record-key--" + key, text }));
  };
  for (const p of recordParts(r)) add(p.key, t(p.label, p.n) + " (" + t("LOC_DEMOGRAPHICS_HIST_PERCENT", p.pct) + ")");
  if (!r.finished) add("open", t("LOC_DEMOGRAPHICS_HIST_NO_FINISHED"));
  if (r.open) add("open", t("LOC_DEMOGRAPHICS_HIST_N_UNFINISHED", r.open));
  return el("div", { cls: "dgh-record-legend" }, items);
}

/**
 * A card for one leader or civilization: emblem, name, win rate over finished games, that rate as a
 * bar with both parts named and given their share, then the figures.
 * @param {HTMLElement} icon Portrait or emblem.
 * @param {string} name Localized name.
 * @param {GroupRow} r Row.
 * @returns {HTMLElement} Card.
 */
function groupCard(icon, name, r) {
  const rate = r.finished ? Math.round((100 * r.wins) / r.finished) : 0;
  return el("div", { cls: "dgh-person-card" }, [
    icon,
    el("div", { cls: "dgh-person-body" }, [
      el("div", { cls: "dgh-person-head" }, [
        el("div", { cls: "dgh-person-name", text: name }),
        el("div", { cls: "dgh-person-rate" }, [
          // Nothing finished yet: the rate is 0% in grey, beside an empty grey bar, until a game ends.
          el("div", { cls: "dgh-person-rate-n" + (r.finished ? "" : " is-none"), text: t("LOC_DEMOGRAPHICS_HIST_PERCENT", rate) }),
          el("div", { cls: "dgh-person-rate-l", text: t("LOC_DEMOGRAPHICS_HIST_STAT_WIN_RATE") })
        ])
      ]),
      recordBar(r),
      recordLegend(r),
      el("div", { cls: "dgh-facts" }, [
        figure(num(r.games), "LOC_DEMOGRAPHICS_HIST_STAT_ATTEMPTS"),
        figure(num(r.bestTriumphs), "LOC_DEMOGRAPHICS_HIST_COL_BEST_TRIUMPHS"),
        figure(num(r.avgTurns), "LOC_DEMOGRAPHICS_HIST_COL_AVG_TURNS")
      ])
    ])
  ]);
}

/**
 * Leaders tab.
 * @param {HTMLElement} host Container.
 * @param {ArchiveRecord[]} records Records.
 */
export function renderLeaders(host, records) {
  clear(host);
  const cards = leaderRows(records).map((r) => groupCard(leaderIcon(r.key, "dgh-leader-icon dgh-leader-icon--lg"), typeName(r.name, r.key), r));
  host.appendChild(el("div", { cls: "dgh-scroll" }, [
    pageHead(t("LOC_DEMOGRAPHICS_HIST_HOF_LEADERS"), t("LOC_DEMOGRAPHICS_HIST_LEADERS_NOTE")),
    section("", [cards.length ? el("div", { cls: "dgh-cards" }, cards) : emptyState(t("LOC_DEMOGRAPHICS_HIST_EMPTY_HOF"))])
  ]));
}

/**
 * Civilizations tab.
 * @param {HTMLElement} host Container.
 * @param {ArchiveRecord[]} records Records.
 */
export function renderCivs(host, records) {
  clear(host);
  const cards = civRows(records).map((r) => groupCard(civIcon(r.key, "dgh-civ-icon dgh-civ-icon--lg"), typeName(r.name, r.key), r));
  host.appendChild(el("div", { cls: "dgh-scroll" }, [
    pageHead(t("LOC_DEMOGRAPHICS_HIST_HOF_CIVS"), t("LOC_DEMOGRAPHICS_HIST_CIVS_NOTE")),
    section("", [cards.length ? el("div", { cls: "dgh-cards" }, cards) : emptyState(t("LOC_DEMOGRAPHICS_HIST_EMPTY_HOF"))])
  ]));
}

/**
 * Records tab.
 * @param {HTMLElement} host Container.
 * @param {ArchiveRecord[]} records Records.
 * @param {HofCtx} ctx Context.
 */
export function renderRecords(host, records, ctx) {
  clear(host);
  const holders = recordHolders(records);
  const cards = holders.map((h) => el("div", { cls: "dgh-record" }, [
    el("div", { cls: "dgh-record-head" }, [
      el("div", { cls: "dgh-record-name", text: t("LOC_DEMOGRAPHICS_HIST_RECORD_" + h.id.toUpperCase()) }),
      el("div", { cls: "dgh-record-value", text: num(h.value) })
    ]),
    gameCard(h.game, ctx)
  ]));
  host.appendChild(el("div", { cls: "dgh-scroll" }, [
    pageHead(t("LOC_DEMOGRAPHICS_HIST_HOF_RECORDS"), t("LOC_DEMOGRAPHICS_HIST_RECORDS_NOTE")),
    section("", cards.length ? [el("div", { cls: "dgh-records" }, cards)] : [emptyState(t("LOC_DEMOGRAPHICS_HIST_EMPTY_HOF"))])
  ]));
}
