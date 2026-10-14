// view-chronicle.js
//
// The Chronicle: this campaign's history as a readable feed, grouped by age. Each age opens with a
// summary card (what your civilization did in that age); below it, every recorded event in the
// player's language. Events about civilizations the player has not met are hidden and counted.

import { el, clear } from "/demographics/ui/history/core/history-dom.js";
import { t, formatNumber, typeName } from "/demographics/ui/history/core/history-text.js";
import {
  castFromDoc,
  eventText,
  eventVisible,
  summarizeAge,
  spanFor
} from "/demographics/ui/history/model/history-narrate.js";
import { pillRow, section, emptyState, textButton } from "/demographics/ui/history/views/history-widgets.js";
import { viewState, LIMIT_STEP } from "/demographics/ui/history/views/history-state.js";

/** Category filters: key -> event kinds (empty = all). */
export const FILTERS = /** @type {Record<string, HistoryEventKind[]>} */ ({
  all: [],
  mine: [],
  settlements: ["found", "capture", "razed"],
  wonders: ["wonder"],
  war: ["war", "peace", "capture", "elim"],
  faith: ["religion"],
  triumphs: ["triumph"],
  world: ["age", "civ", "met", "elim", "victory", "crisis", "disaster"]
});

/**
 * Display name of an age, from the age event that opened it.
 * @param {CampaignDoc} doc
 * @param {string} age
 * @returns {string}
 */
export function ageName(doc, age) {
  const opening = doc.events.find((x) => x.k === "age" && x.x === age);
  return typeName(opening?.n || "", age);
}

/**
 * Events passing the current filters, with visibility applied.
 * @param {CampaignDoc} doc
 * @param {import("../model/history-narrate.js").Cast} cast
 * @returns {{shown: HistoryEvent[], hidden: number}} Events and the count hidden as spoilers.
 */
export function filteredEvents(doc, cast) {
  const kinds = FILTERS[viewState.filter] || [];
  const ageIdx = viewState.age === "all" ? -1 : doc.ages.findIndex((age) => age.age === viewState.age);
  const inScope = doc.events.filter((event) =>
    (ageIdx < 0 || event.a === ageIdx) && (!kinds.length || kinds.includes(event.k)));
  const mine = viewState.filter === "mine"
    ? inScope.filter((event) => event.p === doc.local || event.q === doc.local)
    : inScope;
  const shown = mine.filter((event) => eventVisible(event, cast));
  return { shown, hidden: mine.length - shown.length };
}

/**
 * @param {HistoryEvent} event
 * @param {import("../model/history-narrate.js").Cast} cast
 * @param {string} age
 */
function eventRow(event, cast, age) {
  const mine = event.p === cast.local || event.q === cast.local;
  const dotColor = (event.p >= 0 && cast.color(event.p)) || "#a8845a";
  return el("div", { cls: "dgh-event dgh-event--" + event.k + (mine ? " is-mine" : "") }, [
    el("div", { cls: "dgh-event-date", text: event.d || t("LOC_DEMOGRAPHICS_HIST_TURN_N", event.t) }),
    el("div", { cls: "dgh-event-dot", style: { backgroundColor: dotColor } }),
    el("div", { cls: "dgh-event-text", text: eventText(event, cast, age) })
  ]);
}

/**
 * The age summary card for the local player.
 * @param {CampaignDoc} doc
 * @param {number} idx
 * @param {import("../model/history-narrate.js").Cast} cast
 * @returns {HTMLElement}
 */
export function ageCard(doc, idx, cast) {
  const age = doc.ages[idx].age;
  const summary = summarizeAge(doc.events.filter((event) => event.a === idx), cast, age);
  const span = spanFor(doc.players[String(doc.local)]?.civs || [], age);
  const civName = span ? typeName(span.name, span.civ) : "";
  const lead = t("LOC_DEMOGRAPHICS_HIST_NARR_LEAD", cast.leaderName(doc.local), civName);
  const since = idx === 0 && doc.since?.partial
    ? el("div", {
      cls: "dgh-subtitle",
      text: t("LOC_DEMOGRAPHICS_HIST_SINCE_PARTIAL", doc.since.d || t("LOC_DEMOGRAPHICS_HIST_TURN_N", doc.since.t))
    })
    : null;
  return section(ageName(doc, age), [
    el("div", { cls: "dgh-lead", text: lead }),
    since,
    factChips(summary),
    ...namedLines(summary)
  ], "dgh-age-card");
}

/** @param {import("../model/history-narrate.js").AgeSummary} summary */
function factChips(summary) {
  const facts = [
    [summary.founded, "LOC_DEMOGRAPHICS_HIST_FACT_FOUNDED"],
    [summary.captured, "LOC_DEMOGRAPHICS_HIST_FACT_CAPTURED"],
    [summary.lost, "LOC_DEMOGRAPHICS_HIST_FACT_LOST"],
    [summary.wonders.length, "LOC_DEMOGRAPHICS_HIST_FACT_WONDERS"],
    [summary.triumphs, "LOC_DEMOGRAPHICS_HIST_FACT_TRIUMPHS"],
    [summary.wars, "LOC_DEMOGRAPHICS_HIST_FACT_WARS"]
  ];
  return el("div", { cls: "dgh-facts" }, facts.map(([count, label]) =>
    el("div", { cls: "dgh-fact" + (count ? "" : " is-zero") }, [
      el("div", { cls: "dgh-fact-n", text: formatNumber(Number(count)) }),
      el("div", { cls: "dgh-fact-l", text: t(String(label)) })
    ])
  ));
}

/** @param {import("../model/history-narrate.js").AgeSummary} summary */
function namedLines(summary) {
  /** @type {Array<[string, string]>} */
  const lines = [
    ["LOC_DEMOGRAPHICS_HIST_LINE_WONDERS", summary.wonders.join(", ")],
    ["LOC_DEMOGRAPHICS_HIST_LINE_RELIGION", summary.religion],
    ["LOC_DEMOGRAPHICS_HIST_LINE_FALLEN", summary.fallen.join(", ")]
  ];
  return lines.filter(([, value]) => !!value).map(([key, value]) => el("div", { cls: "dgh-line" }, [
    el("span", { cls: "dgh-line-k", text: t(key) }),
    el("span", { cls: "dgh-line-v", text: value })
  ]));
}

/**
 * @param {CampaignDoc} doc
 * @param {() => void} rerender
 */
function controls(doc, rerender) {
  const set = (/** @type {Partial<import("./history-state.js").ViewState>} */ patch) => {
    Object.assign(viewState, patch, { limit: LIMIT_STEP });
    rerender();
  };
  const ages = [
    { key: "all", label: t("LOC_DEMOGRAPHICS_HIST_ALL_AGES") },
    ...doc.ages.map((age) => ({ key: age.age, label: ageName(doc, age.age) }))
  ];
  const filters = Object.keys(FILTERS)
    .map((key) => ({ key, label: t("LOC_DEMOGRAPHICS_HIST_FILTER_" + key.toUpperCase()) }));
  const order = [
    { key: "new", label: t("LOC_DEMOGRAPHICS_HIST_ORDER_NEWEST") },
    { key: "old", label: t("LOC_DEMOGRAPHICS_HIST_ORDER_OLDEST") }
  ];
  return [
    pillRow(ages, viewState.age, (key) => set({ age: key })),
    el("div", { cls: "dgh-toolbar" }, [
      pillRow(filters, viewState.filter, (key) => set({ filter: key }), "filter"),
      pillRow(order, viewState.newestFirst ? "new" : "old", (key) => set({ newestFirst: key === "new" }), "filter")
    ])
  ];
}

/**
 * @param {CampaignDoc} doc
 * @param {HistoryEvent[]} events Visible events.
 * @param {import("../model/history-narrate.js").Cast} cast
 */
function feed(doc, events, cast) {
  const order = doc.ages.map((_, i) => i);
  if (viewState.newestFirst) order.reverse();
  let budget = viewState.limit;
  /** @type {HTMLElement[]} */
  const groups = [];
  for (const idx of order) {
    if (viewState.age !== "all" && doc.ages[idx].age !== viewState.age) continue;
    const list = events.filter((event) => event.a === idx);
    if (viewState.newestFirst) list.reverse();
    const rows = list.slice(0, Math.max(0, budget)).map((event) => eventRow(event, cast, doc.ages[idx].age));
    budget -= rows.length;
    groups.push(el("div", { cls: "dgh-age-group" }, [
      ageCard(doc, idx, cast),
      el("div", { cls: "dgh-feed" }, rows)
    ]));
  }
  return groups;
}

/**
 * Render the Chronicle.
 * @param {HTMLElement} host
 * @param {CampaignDoc|null} doc The live campaign.
 * @param {() => void} rerender
 * @param {"full"|"met"|"own"} [visibility] See castFromDoc.
 */
export function renderChronicle(host, doc, rerender, visibility = "met") {
  clear(host);
  if (!doc || !doc.events.length) {
    host.appendChild(emptyState(t("LOC_DEMOGRAPHICS_HIST_EMPTY_CHRONICLE")));
    return;
  }
  const cast = castFromDoc(doc, visibility);
  const { shown, hidden } = filteredEvents(doc, cast);
  const body = el("div", { cls: "dgh-scroll" }, feed(doc, shown, cast));
  if (shown.length > viewState.limit) {
    const showMore = () => {
      viewState.limit += LIMIT_STEP;
      rerender();
    };
    body.appendChild(textButton("LOC_DEMOGRAPHICS_HIST_SHOW_MORE", showMore, "dgh-more"));
  }
  if (hidden > 0) {
    body.appendChild(el("div", { cls: "dgh-note", text: t("LOC_DEMOGRAPHICS_HIST_HIDDEN_UNMET", hidden) }));
  }
  for (const control of controls(doc, rerender)) host.appendChild(control);
  host.appendChild(body);
}
