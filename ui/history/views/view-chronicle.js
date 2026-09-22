// view-chronicle.js
//
// The Chronicle: this campaign's history as a readable feed, grouped by age. Each age opens with a
// summary card (what your civilization did in that age); below it, every recorded event in the
// player's language. Events about civilizations the player has not met are hidden and counted.

import { el, clear } from "/demographics/ui/history/core/history-dom.js";
import { t, num, typeName } from "/demographics/ui/history/core/history-text.js";
import { castFromDoc, eventText, eventVisible, summarizeAge, spanFor } from "/demographics/ui/history/model/history-narrate.js";
import { pillRow, section, emptyState, textButton } from "/demographics/ui/history/views/history-widgets.js";
import { viewState, LIMIT_STEP } from "/demographics/ui/history/views/history-state.js";

/** Category filters: key -> event kinds (empty = all). */
export const FILTERS = /** @type {Record<string, HnrEventKind[]>} */ ({
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
 * @param {CampaignDoc} doc Campaign.
 * @param {string} age Age type.
 * @returns {string} Localized name.
 */
export function ageName(doc, age) {
  const e = doc.events.find((x) => x.k === "age" && x.x === age);
  return typeName(e?.n || "", age);
}

/**
 * Events passing the current filters, with visibility applied.
 * @param {CampaignDoc} doc Campaign.
 * @param {import("../model/history-narrate.js").Cast} cast Cast.
 * @returns {{shown: HnrEvent[], hidden: number}} Events and the count hidden as spoilers.
 */
export function filteredEvents(doc, cast) {
  const kinds = FILTERS[viewState.filter] || [];
  const ageIdx = viewState.age === "all" ? -1 : doc.ages.findIndex((a) => a.age === viewState.age);
  const inScope = doc.events.filter((e) => (ageIdx < 0 || e.a === ageIdx) && (!kinds.length || kinds.includes(e.k)));
  const mine = viewState.filter === "mine" ? inScope.filter((e) => e.p === doc.local || e.q === doc.local) : inScope;
  const shown = mine.filter((e) => eventVisible(e, cast));
  return { shown, hidden: mine.length - shown.length };
}

/**
 * A single feed row.
 * @param {HnrEvent} e Event.
 * @param {import("../model/history-narrate.js").Cast} cast Cast.
 * @param {string} age Age type.
 * @returns {HTMLElement} The row.
 */
function eventRow(e, cast, age) {
  const mine = e.p === cast.local || e.q === cast.local;
  return el("div", { cls: "dgh-event dgh-event--" + e.k + (mine ? " is-mine" : "") }, [
    el("div", { cls: "dgh-event-date", text: e.d || t("LOC_DEMOGRAPHICS_HIST_TURN_N", e.t) }),
    el("div", { cls: "dgh-event-dot", style: { backgroundColor: (e.p >= 0 && cast.color(e.p)) || "#a8845a" } }),
    el("div", { cls: "dgh-event-text", text: eventText(e, cast, age) })
  ]);
}

/**
 * The age summary card for the local player.
 * @param {CampaignDoc} doc Campaign.
 * @param {number} idx Age index.
 * @param {import("../model/history-narrate.js").Cast} cast Cast.
 * @returns {HTMLElement} The card.
 */
export function ageCard(doc, idx, cast) {
  const age = doc.ages[idx].age;
  const s = summarizeAge(doc.events.filter((e) => e.a === idx), cast, age);
  const span = spanFor(doc.players[String(doc.local)]?.civs || [], age);
  const lead = t("LOC_DEMOGRAPHICS_HIST_NARR_LEAD", cast.leaderName(doc.local), span ? typeName(span.name, span.civ) : "");
  const facts = [
    [s.founded, "LOC_DEMOGRAPHICS_HIST_FACT_FOUNDED"], [s.captured, "LOC_DEMOGRAPHICS_HIST_FACT_CAPTURED"], [s.lost, "LOC_DEMOGRAPHICS_HIST_FACT_LOST"],
    [s.wonders.length, "LOC_DEMOGRAPHICS_HIST_FACT_WONDERS"], [s.triumphs, "LOC_DEMOGRAPHICS_HIST_FACT_TRIUMPHS"], [s.wars, "LOC_DEMOGRAPHICS_HIST_FACT_WARS"]
  ];
  const chips = el("div", { cls: "dgh-facts" }, facts.map(([n, label]) =>
    el("div", { cls: "dgh-fact" + (n ? "" : " is-zero") }, [el("div", { cls: "dgh-fact-n", text: num(Number(n)) }), el("div", { cls: "dgh-fact-l", text: t(String(label)) })])
  ));
  const since = idx === 0 && doc.since?.partial
    ? el("div", { cls: "dgh-subtitle", text: t("LOC_DEMOGRAPHICS_HIST_SINCE_PARTIAL", doc.since.d || t("LOC_DEMOGRAPHICS_HIST_TURN_N", doc.since.t)) })
    : null;
  return section(ageName(doc, age), [el("div", { cls: "dgh-lead", text: lead }), since, chips, ...namedLines(s)], "dgh-age-card");
}

/**
 * Named detail lines for an age summary (wonders, religion, fallen civilizations).
 * @param {import("../model/history-narrate.js").AgeSummary} s Summary.
 * @returns {HTMLElement[]} Lines.
 */
function namedLines(s) {
  /** @type {Array<[string, string]>} */
  const lines = [
    ["LOC_DEMOGRAPHICS_HIST_LINE_WONDERS", s.wonders.join(", ")],
    ["LOC_DEMOGRAPHICS_HIST_LINE_RELIGION", s.religion],
    ["LOC_DEMOGRAPHICS_HIST_LINE_FALLEN", s.fallen.join(", ")]
  ];
  return lines.filter(([, v]) => !!v).map(([k, v]) => el("div", { cls: "dgh-line" }, [
    el("span", { cls: "dgh-line-k", text: t(k) }), el("span", { cls: "dgh-line-v", text: v })
  ]));
}

/**
 * The filter controls.
 * @param {CampaignDoc} doc Campaign.
 * @param {() => void} rerender Redraw callback.
 * @returns {HTMLElement[]} Control rows.
 */
function controls(doc, rerender) {
  const set = (/** @type {Partial<import("./history-state.js").ViewState>} */ patch) => {
    Object.assign(viewState, patch, { limit: LIMIT_STEP });
    rerender();
  };
  const ages = [{ key: "all", label: t("LOC_DEMOGRAPHICS_HIST_ALL_AGES") }, ...doc.ages.map((a) => ({ key: a.age, label: ageName(doc, a.age) }))];
  const filters = Object.keys(FILTERS).map((k) => ({ key: k, label: t("LOC_DEMOGRAPHICS_HIST_FILTER_" + k.toUpperCase()) }));
  const order = [{ key: "new", label: t("LOC_DEMOGRAPHICS_HIST_ORDER_NEWEST") }, { key: "old", label: t("LOC_DEMOGRAPHICS_HIST_ORDER_OLDEST") }];
  return [
    pillRow(ages, viewState.age, (k) => set({ age: k })),
    el("div", { cls: "dgh-toolbar" }, [
      pillRow(filters, viewState.filter, (k) => set({ filter: k }), "filter"),
      pillRow(order, viewState.newestFirst ? "new" : "old", (k) => set({ newestFirst: k === "new" }), "filter")
    ])
  ];
}

/**
 * The grouped feed.
 * @param {CampaignDoc} doc Campaign.
 * @param {HnrEvent[]} events Visible events.
 * @param {import("../model/history-narrate.js").Cast} cast Cast.
 * @returns {HTMLElement[]} Age groups.
 */
function feed(doc, events, cast) {
  const order = doc.ages.map((_, i) => i);
  if (viewState.newestFirst) order.reverse();
  let budget = viewState.limit;
  /** @type {HTMLElement[]} */
  const groups = [];
  for (const idx of order) {
    if (viewState.age !== "all" && doc.ages[idx].age !== viewState.age) continue;
    const list = events.filter((e) => e.a === idx);
    if (viewState.newestFirst) list.reverse();
    const rows = list.slice(0, Math.max(0, budget)).map((e) => eventRow(e, cast, doc.ages[idx].age));
    budget -= rows.length;
    groups.push(el("div", { cls: "dgh-age-group" }, [ageCard(doc, idx, cast), el("div", { cls: "dgh-feed" }, rows)]));
  }
  return groups;
}

/**
 * Render the Chronicle.
 * @param {HTMLElement} host Container.
 * @param {CampaignDoc|null} doc The live campaign.
 * @param {() => void} rerender Redraw callback.
 * @param {"full"|"met"|"own"} [visibility] Analytics visibility (see castFromDoc).
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
    body.appendChild(textButton("LOC_DEMOGRAPHICS_HIST_SHOW_MORE", () => { viewState.limit += LIMIT_STEP; rerender(); }, "dgh-more"));
  }
  if (hidden > 0) body.appendChild(el("div", { cls: "dgh-note", text: t("LOC_DEMOGRAPHICS_HIST_HIDDEN_UNMET", hidden) }));
  for (const c of controls(doc, rerender)) host.appendChild(c);
  host.appendChild(body);
}
