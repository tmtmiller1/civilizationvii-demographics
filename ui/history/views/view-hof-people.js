// view-hof-people.js
//
// Hall of Fame Leaders and Civilizations cards (games, victories, best Triumphs, average length)
// and the Records board (the single best game for each record). ("hof" in file names is the Hall
// of Fame.)

import { el, clear } from "/demographics/ui/history/core/history-dom.js";
import { t, formatNumber, typeName } from "/demographics/ui/history/core/history-text.js";
import { byCivilization, byLeader, recordHolders, tallyGames } from "/demographics/ui/history/model/history-hof.js";
import { civIcon, emptyState, leaderIcon, pageHead, section } from "/demographics/ui/history/views/history-widgets.js";
import { gameCard } from "/demographics/ui/history/views/view-hof-games.js";

/** @typedef {import("./view-hof.js").HofCtx} HofCtx */
/** @typedef {import("../model/history-hof.js").GroupRow} GroupRow */

/**
 * @param {string} value Already formatted.
 * @param {string} label LOC tag.
 */
function figure(value, label) {
  return el("div", { cls: "dgh-fact" }, [
    el("div", { cls: "dgh-fact-n", text: value }),
    el("div", { cls: "dgh-fact-l", text: t(label) })
  ]);
}

/**
 * The parts of the bar: the finished games, split into those won and those not. Games still being
 * played are left out; they have no result yet, so they cannot be won or lost.
 * @param {GroupRow} row
 * @returns {{key: string, n: number, label: string, pct: number}[]} Parts, empty ones left out.
 */
function recordParts(row) {
  const finished = Math.max(0, row.finished);
  const share = (/** @type {number} */ n) => (finished ? Math.round((100 * n) / finished) : 0);
  return [
    { key: "win", n: row.wins, label: "LOC_DEMOGRAPHICS_HIST_N_WON", pct: share(row.wins) },
    { key: "loss", n: finished - row.wins, label: "LOC_DEMOGRAPHICS_HIST_N_NOT_WON", pct: share(finished - row.wins) }
  ].filter((p) => p.n > 0);
}

/**
 * The win rate as a bar: green for the games won, red for the rest of the finished games. With
 * nothing finished the bar stays empty, so gray always means "no result yet".
 * @param {GroupRow} row
 * @returns {HTMLElement}
 */
function recordBar(row) {
  const total = Math.max(1, row.finished);
  return el("div", { cls: "dgh-record-bar" }, recordParts(row).map(
    (p) => el("div", { cls: "dgh-record-seg dgh-record-seg--" + p.key, style: { width: (100 * p.n) / total + "%" } })
  ));
}

/**
 * What the bar is made of, in words: "Victories: 2 (67%) · No victory: 1 (33%)", each part in its
 * own color, with any unfinished games named after them.
 * @param {GroupRow} row
 * @returns {HTMLElement}
 */
function recordLegend(row) {
  /** @type {(HTMLElement|null)[]} */
  const items = [];
  const add = (/** @type {string} */ key, /** @type {string} */ text) => {
    if (items.length) items.push(el("span", { cls: "dgh-record-sep", text: "·" }));
    items.push(el("span", { cls: "dgh-record-key dgh-record-key--" + key, text }));
  };
  for (const part of recordParts(row)) {
    add(part.key, t(part.label, part.n) + " (" + t("LOC_DEMOGRAPHICS_HIST_PERCENT", part.pct) + ")");
  }
  if (!row.finished) add("open", t("LOC_DEMOGRAPHICS_HIST_NO_FINISHED"));
  if (row.open) add("open", t("LOC_DEMOGRAPHICS_HIST_N_UNFINISHED", row.open));
  return el("div", { cls: "dgh-record-legend" }, items);
}

/**
 * @param {HTMLElement} icon Portrait or emblem.
 * @param {string} name Localized name.
 * @param {GroupRow} row
 */
function groupCard(icon, name, row) {
  const rate = row.finished ? Math.round((100 * row.wins) / row.finished) : 0;
  return el("div", { cls: "dgh-person-card" }, [
    icon,
    el("div", { cls: "dgh-person-body" }, [
      el("div", { cls: "dgh-person-head" }, [
        el("div", { cls: "dgh-person-name", text: name }),
        el("div", { cls: "dgh-person-rate" }, [
          // Nothing finished yet: the rate is 0% in gray, beside an empty gray bar, until a game ends.
          el("div", {
            cls: "dgh-person-rate-n" + (row.finished ? "" : " is-none"),
            text: t("LOC_DEMOGRAPHICS_HIST_PERCENT", rate)
          }),
          el("div", { cls: "dgh-person-rate-l", text: t("LOC_DEMOGRAPHICS_HIST_STAT_WIN_RATE") })
        ])
      ]),
      recordBar(row),
      recordLegend(row),
      el("div", { cls: "dgh-facts" }, [
        figure(formatNumber(row.games), "LOC_DEMOGRAPHICS_HIST_STAT_ATTEMPTS"),
        figure(formatNumber(row.bestTriumphs), "LOC_DEMOGRAPHICS_HIST_COL_BEST_TRIUMPHS"),
        figure(formatNumber(row.avgTurns), "LOC_DEMOGRAPHICS_HIST_COL_AVG_TURNS")
      ])
    ])
  ]);
}

/**
 * @param {HTMLElement} host
 * @param {GroupRow[]} rows Tallied rows, already in display order.
 * @param {(key: string) => HTMLElement} iconFor The card icon for a row key.
 * @param {string} title LOC tag for the page heading.
 * @param {string} note LOC tag for the line under the heading.
 */
function renderTallyTab(host, rows, iconFor, title, note) {
  clear(host);
  const cards = rows.map((r) => groupCard(iconFor(r.key), typeName(r.name, r.key), r));
  const body = cards.length
    ? el("div", { cls: "dgh-cards" }, cards)
    : emptyState(t("LOC_DEMOGRAPHICS_HIST_EMPTY_HOF"));
  host.appendChild(el("div", { cls: "dgh-scroll" }, [pageHead(t(title), t(note)), section("", [body])]));
}

/**
 * Leaders tab.
 * @param {HTMLElement} host
 * @param {ArchiveRecord[]} records
 */
export function renderLeaderTab(host, records) {
  const icon = (/** @type {string} */ key) => leaderIcon(key, "dgh-leader-icon dgh-leader-icon--lg");
  renderTallyTab(host, tallyGames(records, byLeader), icon,
    "LOC_DEMOGRAPHICS_HIST_HOF_LEADERS", "LOC_DEMOGRAPHICS_HIST_LEADERS_NOTE");
}

/**
 * Civilizations tab.
 * @param {HTMLElement} host
 * @param {ArchiveRecord[]} records
 */
export function renderCivilizationTab(host, records) {
  const icon = (/** @type {string} */ key) => civIcon(key, "dgh-civ-icon dgh-civ-icon--lg");
  renderTallyTab(host, tallyGames(records, byCivilization), icon,
    "LOC_DEMOGRAPHICS_HIST_HOF_CIVS", "LOC_DEMOGRAPHICS_HIST_CIVS_NOTE");
}

/**
 * Records tab.
 * @param {HTMLElement} host
 * @param {ArchiveRecord[]} records
 * @param {HofCtx} ctx
 */
export function renderRecords(host, records, ctx) {
  clear(host);
  const holders = recordHolders(records);
  const cards = holders.map((holder) => el("div", { cls: "dgh-record" }, [
    el("div", { cls: "dgh-record-head" }, [
      el("div", { cls: "dgh-record-name", text: t("LOC_DEMOGRAPHICS_HIST_RECORD_" + holder.id.toUpperCase()) }),
      el("div", { cls: "dgh-record-value", text: formatNumber(holder.value) })
    ]),
    gameCard(holder.game, ctx)
  ]));
  const body = cards.length
    ? [el("div", { cls: "dgh-records" }, cards)]
    : [emptyState(t("LOC_DEMOGRAPHICS_HIST_EMPTY_HOF"))];
  host.appendChild(el("div", { cls: "dgh-scroll" }, [
    pageHead(t("LOC_DEMOGRAPHICS_HIST_HOF_RECORDS"), t("LOC_DEMOGRAPHICS_HIST_RECORDS_NOTE")),
    section("", body)
  ]));
}
