// history-timeline-lanes.js
//
// The lanes of the Timeline graphic, each built for a window of the axis (the whole game or one
// age): the age header, wars, crises, milestones, the population growth curve and the date ruler.
// A lane is { label, height (rem), items }; items are absolutely placed by percentage inside the
// lane, and history-timeline-view.js stacks the lanes and keeps their labels in a fixed column.

import { el } from "/demographics/ui/history/core/history-dom.js";
import { t, formatNumber, typeName } from "/demographics/ui/history/core/history-text.js";
import { eventText } from "/demographics/ui/history/model/history-narrate.js";
import { civIcon } from "/demographics/ui/history/views/history-widgets.js";
import { withAlpha } from "/demographics/ui/history/views/history-colors.js";
import { MIGRATION_BUCKETS } from "/demographics/ui/history/model/history-timeline.js";
import { markIcon, KIND_ICONS, DISASTER_ICONS } from "/demographics/ui/history/core/history-icons.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
/** Most rows a point lane stacks into; past it markers share rows (zoom in to separate them). */
const MAX_DEPTH = 4;
/** Milestone medallion size and row pitch, and disaster icon row pitch (rem). */
const MEDAL = 2.3;
const DISASTER_ROW = 1.95;

/**
 * @typedef {import("../model/history-timeline.js").Timeline} Timeline
 * @typedef {import("../model/history-narrate.js").Cast} Cast
 * @typedef {{from:number, to:number}} AxisWindow The span of the axis being drawn.
 * @typedef {{key:string, label:string, height:number, items:HTMLElement[]}} Lane
 * @typedef {{left:number, width?:number, top:number, height?:number}} ItemBox
 *   Left and width in percent of the window, top and height in rem.
 */

/**
 * Percent of the window for an axis position, unclamped.
 * @param {AxisWindow} win
 * @param {number} at
 * @returns {number}
 */
export function turnToPercent(win, at) {
  return (100 * (at - win.from)) / Math.max(1, win.to - win.from);
}

/**
 * @param {AxisWindow} win
 * @param {number} from
 * @param {number} to
 */
function overlapsWindow(win, from, to) {
  return to > win.from && from < win.to;
}

/** @param {Timeline} tl @param {number} at */
function ageAt(tl, at) {
  return tl.ages.find((age) => at >= age.from && at < age.from + age.len)?.age || "";
}

/**
 * A cache of lane-item elements across redraws, so an item that survives a redraw keeps its
 * element, and with it the engine art inside. A newly inserted element paints without its
 * `blp:` texture for a frame or more, so re-creating an unchanged medallion, emblem or disaster
 * gem makes it blink. Only items that carry such art opt in (by passing `reuse` to
 * {@link placeItem}); the rest still rebuild, which costs nothing visible.
 * @typedef {{ items: Map<string, HTMLElement>, used: Set<HTMLElement>, seen: Map<string, number> }} ItemCache
 */

/**
 * One per timeline instance.
 * @returns {ItemCache}
 */
export function newItemCache() {
  return { items: new Map(), used: new Set(), seen: new Map() };
}

/**
 * Start a build pass: forget which items the previous pass used.
 * @param {ItemCache|undefined} cache
 */
export function beginItemPass(cache) {
  if (!cache) return;
  cache.used.clear();
  cache.seen.clear();
}

/**
 * Finish a build pass: drop every cached item this pass did not place, so the cache cannot grow
 * across age windows or civilization-filter changes.
 * @param {ItemCache|undefined} cache
 */
export function endItemPass(cache) {
  if (!cache) return;
  for (const [key, item] of cache.items) {
    if (!cache.used.has(item)) cache.items.delete(key);
  }
}

/**
 * The cache slot for one item this pass. Two items that describe themselves identically (a genuine
 * duplicate event) get separate slots rather than fighting over one element, which would make one
 * of them vanish.
 * @param {ItemCache} cache
 * @param {string} key The caller's key.
 * @returns {string} The unique slot key.
 */
function slotKey(cache, key) {
  const count = (cache.seen.get(key) || 0) + 1;
  cache.seen.set(key, count);
  return count > 1 ? key + "#" + count : key;
}

/**
 * A positioned element with a tooltip. With `reuse`, an item that was placed in an earlier draw is
 * reused: its class list is reset to `className` (so a stale edge/rival class from the previous
 * window is dropped and the decorators below re-add the current ones), its box is re-applied, and
 * its children (the engine art) are left exactly as they are.
 * @param {string} className
 * @param {ItemBox} box
 * @param {string} tooltip
 * @param {Array<HTMLElement|null>|(() => Array<HTMLElement|null>)} [children] Children, or a
 *   builder that is only called when the element has to be created.
 * @param {{cache: ItemCache, key: string}} [reuse] Opt-in reuse slot.
 * @returns {HTMLElement}
 */
function placeItem(className, box, tooltip, children = [], reuse) {
  const base = "dgh-tl-item " + className;
  const key = reuse ? slotKey(reuse.cache, reuse.key) : "";
  const cached = reuse ? reuse.cache.items.get(key) : undefined;
  const item = cached || el("div", { cls: base }, typeof children === "function" ? children() : children);
  // A reused element carries the previous pass's classes; reset to the base so edgeClass() and
  // rivalRing() decide again from the current position.
  if (cached) item.className = base;
  applyBox(item, box);
  if (tooltip) item.setAttribute("data-tooltip-content", tooltip);
  else if (cached) item.setAttribute("data-tooltip-content", "");
  if (reuse) {
    reuse.cache.items.set(key, item);
    reuse.cache.used.add(item);
  }
  return item;
}

/**
 * @param {ItemCache|undefined} cache
 * @param {string} key
 */
function reuseSlot(cache, key) {
  return cache ? { cache, key } : undefined;
}

/**
 * Write an item's box onto it. Width and height are cleared when the box has none, so a reused
 * element cannot keep a stale size from an earlier window.
 * @param {HTMLElement} item
 * @param {ItemBox} box
 */
function applyBox(item, box) {
  const left = Math.max(0, box.left);
  item.style.left = left.toFixed(3) + "%";
  item.style.top = box.top + "rem";
  item.style.width = box.width != null
    ? Math.max(0.3, Math.min(100 - left, box.width + Math.min(0, box.left))).toFixed(3) + "%"
    : "";
  item.style.height = box.height != null ? box.height + "rem" : "";
}

/**
 * @param {AxisWindow} win
 * @param {number} from
 * @param {number} to
 * @param {number} top
 * @param {number} height
 * @returns {ItemBox}
 */
function spanBox(win, from, to, top, height) {
  const left = turnToPercent(win, from);
  return { left, width: turnToPercent(win, to) - left, top, height };
}

/**
 * Assign each interval to the first row where it fits after the previous one.
 * @param {{from:number, to:number}[]} items Intervals, sorted by start.
 * @param {number} gap Minimum spacing in axis units.
 * @returns {number[]} Row index per item.
 */
export function stackRows(items, gap) {
  /** @type {number[]} */
  const rowEnds = [];
  return items.map((it) => {
    let row = rowEnds.findIndex((end) => it.from >= end + gap);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = Math.max(it.to, it.from);
    return row;
  });
}

/**
 * Short people count ("2.5M", "10M", "1B").
 * @param {number} people
 * @returns {string}
 */
export function shortPeople(people) {
  if (people >= 1e9) return formatNumber(people / 1e9) + "B";
  if (people >= 1e6) return formatNumber(people / 1e6) + "M";
  if (people >= 1e3) return formatNumber(people / 1e3) + "K";
  return formatNumber(people);
}

/**
 * The age header: one band per age with your civilization's emblem and name, the age and its dates.
 * @param {Timeline} tl
 * @param {AxisWindow} win
 * @param {Cast} cast
 * @param {ItemCache} [cache] Item-reuse cache (the bands carry civilization emblems).
 * @returns {Lane}
 */
export function ageHeader(tl, win, cast, cache) {
  const shown = tl.ages.filter((age) => overlapsWindow(win, age.from, age.from + age.len));
  const items = shown.map((age) => ageBand(tl, age, win, cast, cache));
  return { key: "ages", label: "", height: 2.4, items };
}

/**
 * @param {Timeline} tl
 * @param {Timeline["ages"][number]} age
 * @param {AxisWindow} win
 * @param {Cast} cast
 * @param {ItemCache} [cache]
 */
function ageBand(tl, age, win, cast, cache) {
  const index = tl.ages.indexOf(age);
  const next = tl.ages[index + 1];
  const dates = age.d + (next?.d ? " – " + next.d : "");
  const civ = cast.civType(cast.local, age.age);
  const title = typeName(age.n, age.age);
  const civName = cast.civName(cast.local, age.age);
  const box = spanBox(win, age.from, age.from + age.len, 0, 2.3);
  const tooltip = title + (dates ? " (" + dates + ")" : "");
  const children = () => [
    civ ? civIcon(civ, "dgh-civ-icon dgh-tl-band-icon") : null,
    el("div", { cls: "dgh-tl-band-text" }, [
      el("div", { cls: "dgh-tl-band-age", text: title }),
      el("div", { cls: "dgh-tl-band-sub", text: [civName, dates].filter(Boolean).join("  ·  ") })
    ])
  ];
  const key = ["band", age.age, civ, title, dates, civName].join(":");
  return placeItem("dgh-tl-band dgh-tl-band--" + (index % 3), box, tooltip, children, reuseSlot(cache, key));
}

/**
 * Wars as pills: yours in the enemy's color with their emblem and name; a war between two other
 * civilizations shaded from one's color to the other's, with both emblems.
 * @param {Timeline} tl
 * @param {AxisWindow} win
 * @param {Cast} cast
 * @param {ItemCache} [cache] Item-reuse cache (the pills carry civilization emblems).
 * @returns {Lane|null}
 */
export function warLane(tl, win, cast, cache) {
  const wars = tl.wars.filter((war) => overlapsWindow(win, war.from, war.to));
  if (!wars.length) return null;
  const rows = stackRows(wars, 0);
  const items = wars.map((war, i) => {
    const age = ageAt(tl, war.from);
    const box = spanBox(win, war.from, war.to, 0.2 + rows[i] * 1.4, 1.2);
    const rival = war.a != null && war.a !== cast.local;
    return rival ? rivalWarPill(war, box, cast, age, cache) : warPill(war, box, cast, age, cache);
  });
  const height = 0.4 + (Math.max(...rows) + 1) * 1.4;
  return { key: "wars", label: "LOC_DEMOGRAPHICS_HIST_FACT_WARS", height, items };
}

/**
 * @param {Timeline["wars"][number]} war
 * @param {ItemBox} box
 * @param {Cast} cast
 * @param {string} age
 * @param {ItemCache} [cache]
 */
function warPill(war, box, cast, age, cache) {
  const name = partyName(cast, war.other, age);
  const color = cast.color(war.other) || "#a8845a";
  const civ = cast.civType(war.other, age);
  const tooltip = t("LOC_DEMOGRAPHICS_HIST_TL_WAR_WITH", name) + (war.d ? " (" + war.d + ")" : "");
  const children = () => [
    civ ? civIcon(civ, "dgh-civ-icon dgh-tl-war-icon") : null,
    el("div", { cls: "dgh-tl-war-name", text: name })
  ];
  const key = ["war", war.from, war.to, war.other, civ, name].join(":");
  const pill = placeItem("dgh-tl-war", box, tooltip, children, reuseSlot(cache, key));
  pill.style.backgroundImage =
    `linear-gradient(90deg, ${withAlpha(color, 0.95)} 0%, ${withAlpha(color, 0.45)} 100%)`;
  pill.style.borderColor = withAlpha(color, 1);
  return pill;
}

/**
 * @param {Timeline["wars"][number]} war War (`a` against `other`).
 * @param {ItemBox} box
 * @param {Cast} cast
 * @param {string} age
 * @param {ItemCache} [cache]
 */
function rivalWarPill(war, box, cast, age, cache) {
  const attacker = /** @type {number} */ (war.a);
  const attackerName = partyName(cast, attacker, age);
  const otherName = partyName(cast, war.other, age);
  const attackerColor = cast.color(attacker) || "#a8845a";
  const otherColor = cast.color(war.other) || "#a8845a";
  const icon = (/** @type {number} */ pid) => {
    const civ = cast.civType(pid, age);
    return civ ? civIcon(civ, "dgh-civ-icon dgh-tl-war-icon") : null;
  };
  const tooltip = t("LOC_DEMOGRAPHICS_HIST_TL_RIVAL_WAR", attackerName, otherName) + (war.d ? " (" + war.d + ")" : "");
  const children = () => [
    icon(attacker),
    icon(war.other),
    el("div", { cls: "dgh-tl-war-name", text: attackerName + " / " + otherName })
  ];
  const key = ["rivalwar", war.from, war.to, attacker, war.other, age, attackerName, otherName].join(":");
  const pill = placeItem("dgh-tl-war dgh-tl-war--rivals", box, tooltip, children, reuseSlot(cache, key));
  pill.style.backgroundImage =
    `linear-gradient(90deg, ${withAlpha(attackerColor, 0.8)} 0%, ${withAlpha(otherColor, 0.8)} 100%)`;
  pill.style.borderColor = withAlpha(attackerColor, 1);
  return pill;
}

/**
 * A civilization's name, or the independent peoples when it has none.
 * @param {Cast} cast
 * @param {number} pid
 * @param {string} age
 * @returns {string}
 */
export function partyName(cast, pid, age) {
  return cast.civName(pid, age) || t("LOC_DEMOGRAPHICS_HIST_INDEPENDENT_PEOPLE");
}

/**
 * Crises: one bar per crisis carrying its name, divided into stages that darken from amber to crimson.
 * @param {Timeline} tl
 * @param {AxisWindow} win
 * @param {ItemCache} [cache] Item-reuse cache (the crisis name label carries an icon).
 * @returns {Lane|null}
 */
export function crisisLane(tl, win, cache) {
  const stages = tl.crises.filter((stage) => overlapsWindow(win, stage.from, stage.to));
  if (!stages.length) return null;
  /** @type {Array<typeof stages>} */
  const crises = [];
  for (const stage of stages) {
    const current = crises[crises.length - 1];
    const last = current?.[current.length - 1];
    if (current && last && stage.stage > last.stage && stage.from <= last.to) current.push(stage);
    else crises.push([stage]);
  }
  const items = crises.flatMap((crisis) => crisisItems(crisis, win, cache));
  return { key: "crises", label: "LOC_DEMOGRAPHICS_HIST_TL_CRISES", height: 1.9, items };
}

/**
 * @param {Timeline["crises"]} crisis Stages of one crisis.
 * @param {AxisWindow} win
 * @param {ItemCache} [cache]
 */
function crisisItems(crisis, win, cache) {
  const name = t(crisis[0].n) || t("LOC_DEMOGRAPHICS_HIST_CRISIS_UNNAMED");
  const segments = crisis.map((stage) =>
    placeItem(
      "dgh-tl-crisis dgh-tl-crisis--" + Math.min(4, stage.stage),
      spanBox(win, stage.from, stage.to, 0.85, 0.9),
      name + ", " + t("LOC_DEMOGRAPHICS_HIST_TL_STAGE", stage.stage),
      [el("div", { cls: "dgh-tl-crisis-n", text: ROMAN[stage.stage - 1] || String(stage.stage) })]
    )
  );
  const children = () => [
    iconDisc(el("div", { cls: "dgh-tl-crisis-icon" }), KIND_ICONS.crisis),
    el("div", { text: name })
  ];
  const box = { left: turnToPercent(win, crisis[0].from), top: 0 };
  const key = "crisisname:" + crisis[0].from + ":" + name;
  const label = placeItem("dgh-tl-crisis-name", box, name, children, reuseSlot(cache, key));
  return [label, ...segments];
}

/**
 * The milestone lanes, one per kind in a fixed order, so a kind is always on the same row.
 */
const MARK_GROUPS = [
  { key: "wonders", kinds: ["wonder"], label: "LOC_DEMOGRAPHICS_HIST_FILTER_WONDERS" },
  { key: "triumphs", kinds: ["triumph"], label: "LOC_DEMOGRAPHICS_HIST_FILTER_TRIUMPHS" },
  { key: "faith", kinds: ["religion"], label: "LOC_DEMOGRAPHICS_HIST_FILTER_FAITH" },
  { key: "conquests", kinds: ["capture", "lost"], label: "LOC_DEMOGRAPHICS_HIST_TL_CONQUESTS" },
  { key: "fates", kinds: ["victory", "elim"], label: "LOC_DEMOGRAPHICS_HIST_TL_FATES" }
];

/**
 * Milestones as icon medallions, a lane per kind (Wonders, Triumphs, Faith, Conquests, then victory
 * and fallen civilizations). Within a lane, close neighbors alternate between two rows.
 * @param {Timeline} tl
 * @param {AxisWindow} win
 * @param {Cast} cast
 * @param {ItemCache} [cache] Item-reuse cache (each medallion is an icon disc).
 * @returns {Lane[]} Lanes (kinds with nothing in the window are left out).
 */
export function milestoneLanes(tl, win, cast, cache) {
  const visible = tl.marks.filter((mark) => mark.at >= win.from && mark.at <= win.to);
  return MARK_GROUPS.map((group) => {
    const marks = visible.filter((mark) => group.kinds.includes(mark.k));
    return markLane(group, marks, tl, win, { cast, cache });
  })
    .filter((lane) => !!lane)
    .map((lane) => /** @type {Lane} */ (lane));
}

/**
 * @param {{key:string, label:string}} group
 * @param {Timeline["marks"]} marks Its milestones in the window.
 * @param {Timeline} tl
 * @param {AxisWindow} win
 * @param {{cast: Cast, cache?: ItemCache}} ctx
 * @returns {Lane|null}
 */
function markLane(group, marks, tl, win, ctx) {
  const { cast, cache } = ctx;
  if (!marks.length) return null;
  const points = marks.map((mark) => ({ from: mark.at, to: mark.at }));
  const rows = stackRows(points, (win.to - win.from) * 0.028).map((row) => row % 2);
  const depth = Math.max(...rows) + 1;
  const items = marks.map((mark, i) => {
    const age = ageAt(tl, mark.at);
    const kind = mark.k === "lost" ? "capture" : mark.k;
    const event = /** @type {HistoryEvent} */ ({ t: 0, a: 0, k: kind, p: mark.p, q: mark.q, n: mark.n, x: mark.x });
    const tooltip = (mark.d ? mark.d + ": " : "") + eventText(event, cast, age);
    const top = 0.15 + rows[i] * (MEDAL * 0.55);
    const key = "mark:" + mark.k + ":" + mark.at + ":" + mark.p + ":" +
      (mark.n || "") + ":" + (mark.x || "") + ":" + (mark.q || "");
    const box = { left: turnToPercent(win, mark.at), top };
    const medal = placeItem("dgh-tl-medal dgh-tl-medal--" + mark.k, box, tooltip, [], reuseSlot(cache, key));
    return rivalRing(iconDisc(medal, markIcon(mark)), mark, cast);
  });
  const height = 0.35 + MEDAL + (depth - 1) * MEDAL * 0.55;
  return { key: "marks-" + group.key, label: group.label, height, items };
}

/**
 * @param {HTMLElement} disc
 * @param {string} icon Texture path ("" leaves the disc's own fill).
 */
function iconDisc(disc, icon) {
  const url = icon ? "url('" + icon + "')" : "";
  // Only write when it changes: re-assigning the same `blp:` url on a reused disc can make the
  // engine resolve the texture again, which is the blink this cache exists to remove.
  if (url && disc.style.backgroundImage !== url) disc.style.backgroundImage = url;
  const edge = edgeClass(parseFloat(disc.style.left || "0"));
  if (edge) disc.classList.add(edge);
  return disc;
}

/**
 * The class that keeps a disc at either end of the chart inside it rather than half cut off.
 * @param {number} left In percent.
 * @returns {string} Class, or "".
 */
export function edgeClass(left) {
  if (left > 98.5) return "dgh-tl-edge-r";
  return left < 1.5 ? "dgh-tl-edge-l" : "";
}

/**
 * Mark another civilization's milestone (every ring is the same gold; its tooltip names the owner).
 * @param {HTMLElement} medal
 * @param {{k:string, p:number}} mark
 * @param {Cast} cast
 * @returns {HTMLElement}
 */
function rivalRing(medal, mark, cast) {
  const ownedByRival = mark.p !== cast.local && mark.k !== "elim" && mark.k !== "victory" && mark.k !== "lost";
  if (ownedByRival) medal.classList.add("is-rival");
  return medal;
}

/**
 * Settlements you founded: a marker per founding, stacked so none overlap, numbered in the tooltip.
 * @param {Timeline} tl
 * @param {AxisWindow} win
 * @param {Cast} cast
 * @returns {Lane|null}
 */
export function settlementLane(tl, win, cast) {
  /** @type {Map<number, number>} */
  const count = new Map();
  const numbered = tl.founds.map((found) => {
    const founder = found.p ?? cast.local;
    count.set(founder, (count.get(founder) || 0) + 1);
    return { ...found, p: founder, nth: count.get(founder) || 1 };
  });
  const list = numbered.filter((found) => found.at >= win.from && found.at <= win.to);
  if (!list.length) return null;
  const points = list.map((found) => ({ from: found.at, to: found.at }));
  const rows = stackRows(points, (win.to - win.from) * 0.008);
  const depth = Math.min(MAX_DEPTH, Math.max(...rows) + 1);
  const items = list.map((found, i) => {
    const age = ageAt(tl, found.at);
    const event = /** @type {HistoryEvent} */ ({ t: 0, a: 0, k: "found", p: found.p, n: found.n });
    const color = cast.color(found.p) || "#e5d2ac";
    const nth = " (" + t("LOC_DEMOGRAPHICS_HIST_TL_NTH_SETTLEMENT", found.nth) + ")";
    const tooltip = (found.d ? found.d + ": " : "") + eventText(event, cast, age) + nth;
    const box = { left: turnToPercent(win, found.at), top: 0.3 + (rows[i] % MAX_DEPTH) * 0.85 };
    const pin = placeItem("dgh-tl-found", box, tooltip, [el("div", { cls: "dgh-tl-found-roof" })]);
    pin.style.backgroundColor = color;
    return pin;
  });
  return { key: "founds", label: "LOC_DEMOGRAPHICS_HIST_TL_SETTLEMENTS", height: 0.6 + depth * 0.85, items };
}

/**
 * Population (Demographics' scaled figures): your growth curve filled, with its milestones, and a
 * line in each shown rival's color, all on one scale.
 * @param {Timeline} tl
 * @param {AxisWindow} win
 * @param {Cast} cast
 * @returns {Lane|null}
 */
export function populationLane(tl, win, cast) {
  const inWindow = (/** @type {{at:number, v:number}[]} */ points) =>
    points.filter((point) => point.at >= win.from - 1 && point.at <= win.to + 1);
  const mine = inWindow(tl.curve);
  const others = (tl.lines || [])
    .map((line) => ({ pid: line.pid, pts: inWindow(line.pts) }))
    .filter((line) => line.pts.length >= 2);
  if (mine.length < 2 && !others.length) return null;
  const max = Math.max(
    1,
    ...mine.map((point) => point.v),
    ...others.flatMap((line) => line.pts.map((point) => point.v))
  );
  const height = others.length ? 3.8 : 3;
  const holder = el("div", {
    cls: "dgh-tl-item dgh-tl-curve-box",
    style: { left: "0%", width: "100%", top: "0rem", height: height + "rem" }
  });
  const rivalLines = others.map((line) => ({ pts: line.pts, color: cast.color(line.pid) || "#c2c4cc" }));
  holder.appendChild(/** @type {any} */ (curveSvg(mine, rivalLines, win, max)));
  const ticks = tl.pops
    .filter((pop) => pop.at >= win.from && pop.at <= win.to)
    .map((pop) =>
      placeItem(
        "dgh-tl-poptick",
        { left: turnToPercent(win, pop.at), top: 0, height },
        t("LOC_DEMOGRAPHICS_HIST_TL_POP_REACHED", shortPeople(pop.v)),
        [el("div", { cls: "dgh-tl-poptick-label", text: shortPeople(pop.v) })]
      )
    );
  return { key: "pops", label: "LOC_DEMOGRAPHICS_HIST_COL_POPULATION", height, items: [holder, ...ticks] };
}

/**
 * The curves as one stretched SVG (lines only; labels stay in HTML).
 * @param {{at:number, v:number}[]} mine Your points in the window (filled).
 * @param {{pts:{at:number, v:number}[], color:string}[]} others Other civilizations' points (lines).
 * @param {AxisWindow} win
 * @param {number} max Top of the scale.
 * @returns {Element}
 */
function curveSvg(mine, others, win, max) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 1000 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "dgh-tl-curve");
  const svgX = (/** @type {number} */ at) => (turnToPercent(win, at) * 10).toFixed(1);
  const svgY = (/** @type {number} */ value) => (100 - (95 * value) / max).toFixed(1);
  const pointList = (/** @type {{at:number, v:number}[]} */ points) =>
    points.map((point) => `${svgX(point.at)},${svgY(point.v)}`).join(" ");
  const shape = (/** @type {string} */ tag, /** @type {string} */ points, /** @type {string} */ cls) => {
    const node = document.createElementNS(SVG_NS, tag);
    node.setAttribute("points", points);
    node.setAttribute("class", cls);
    svg.appendChild(node);
    return node;
  };
  if (mine.length >= 2) {
    const area = `${svgX(mine[0].at)},100 ${pointList(mine)} ${svgX(mine[mine.length - 1].at)},100`;
    shape("polygon", area, "dgh-tl-curve-area");
    shape("polyline", pointList(mine), "dgh-tl-curve-line");
  }
  for (const other of others) {
    shape("polyline", pointList(other.pts), "dgh-tl-curve-rival").setAttribute("stroke", other.color);
  }
  return svg;
}

/** Major tick spacing candidates, in turns. */
const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

/**
 * Tick spacing for a window seen at a zoom: at most sixteen labeled ticks across the visible width, with
 * unlabelled minor ticks between them.
 * @param {AxisWindow} win
 * @param {number} zoom Canvas width in viewport widths.
 * @returns {{major:number, minor:number}} In turns.
 */
export function tickSteps(win, zoom) {
  const visible = (win.to - win.from) / Math.max(1, zoom);
  const major = TICK_STEPS.find((step) => visible / step <= 16) || 100;
  const minor = major >= 10 ? major / 5 : major >= 2 ? 1 : 0;
  return { major, minor: minor >= 1 && Number.isInteger(minor) ? minor : 0 };
}

/**
 * Every tick in the window: axis position, the age's own turn number, and whether it is labeled.
 * Turns restart each age, so ticks count from each age's first turn.
 * @param {Timeline} tl
 * @param {AxisWindow} win
 * @param {number} zoom
 * @returns {{at:number, turn:number, major:boolean}[]}
 */
export function ticks(tl, win, zoom) {
  const { major, minor } = tickSteps(win, zoom);
  const step = minor || major;
  /** @type {{at:number, turn:number, major:boolean}[]} */
  const out = [];
  for (const age of tl.ages) {
    const firstTurn = age.t0 || 1;
    for (let turn = Math.ceil(firstTurn / step) * step; turn < firstTurn + age.len; turn += step) {
      const at = age.from + (turn - firstTurn);
      if (at > age.from && at >= win.from && at <= win.to) out.push({ at, turn, major: turn % major === 0 });
    }
  }
  return out;
}

/**
 * The ruler: turn ticks (labeled every major step) and each age's opening date.
 * @param {Timeline} tl
 * @param {AxisWindow} win
 * @param {number} zoom
 * @returns {Lane}
 */
export function rulerLane(tl, win, zoom) {
  const ageOf = (/** @type {number} */ at) => tl.ages.find((age) => at >= age.from && at < age.from + age.len);
  const tickTip = (/** @type {{at:number, turn:number}} */ tick) => {
    const age = ageOf(tick.at);
    return (age ? typeName(age.n, age.age) + ", " : "") + t("LOC_DEMOGRAPHICS_HIST_TL_TURN", tick.turn);
  };
  const items = ticks(tl, win, zoom).map((tick) => {
    const label = t("LOC_DEMOGRAPHICS_HIST_TL_TURN", tick.turn);
    return placeItem(
      "dgh-tl-tick" + (tick.major ? " dgh-tl-tick--major" : ""),
      { left: turnToPercent(win, tick.at), top: 0, height: tick.major ? 0.75 : 0.45 },
      tickTip(tick),
      tick.major ? [el("div", { cls: "dgh-tl-tick-label", text: label })] : []
    );
  });
  for (const age of tl.ages.filter((x) => x.from >= win.from && x.from < win.to)) {
    const box = { left: turnToPercent(win, age.from), top: 0, height: 1.8 };
    const date = el("div", { cls: "dgh-tl-tick-date", text: age.d || typeName(age.n, age.age) });
    items.push(placeItem("dgh-tl-tick dgh-tl-tick--age", box, age.d, [date]));
  }
  return { key: "ruler", label: "", height: 2, items };
}

/**
 * Faint vertical guides through every lane at the labeled ticks.
 * @param {Timeline} tl
 * @param {AxisWindow} win
 * @param {number} zoom
 * @returns {HTMLElement[]}
 */
export function gridLines(tl, win, zoom) {
  return ticks(tl, win, zoom)
    .filter((tick) => tick.major)
    .map((tick) => el("div", { cls: "dgh-tl-grid", style: { left: turnToPercent(win, tick.at).toFixed(3) + "%" } }));
}

/**
 * The family of a disaster type, for its color: volcano, flood, storm or other.
 * @param {string} type RandomEventType.
 * @returns {string}
 */
export function disasterFamily(type) {
  const upper = String(type || "").toUpperCase();
  if (upper.includes("VOLCAN") || upper.includes("ERUPT")) return "volcano";
  if (upper.includes("FLOOD")) return "flood";
  if (/STORM|HURRICANE|TORNADO|BLIZZARD|CYCLONE|TYPHOON|DUST|SAND|WIND/.test(upper)) return "storm";
  if (/FIRE|DROUGHT|HEAT/.test(upper)) return "fire";
  return "other";
}

/**
 * Natural disasters: a gem per strike, colored by family, ringed in the struck civilization's color
 * (your own lands full strength, others' dimmer).
 * @param {Timeline} tl
 * @param {AxisWindow} win
 * @param {Cast} cast
 * @param {ItemCache} [cache] Item-reuse cache (each gem is an icon disc).
 * @returns {Lane|null}
 */
export function disasterLane(tl, win, cast, cache) {
  const list = tl.disasters.filter((strike) => strike.at >= win.from && strike.at <= win.to);
  if (!list.length) return null;
  const points = list.map((strike) => ({ from: strike.at, to: strike.at }));
  const rows = stackRows(points, (win.to - win.from) * 0.012).map((row) => row % 3);
  const items = list.map((strike, i) => {
    const age = ageAt(tl, strike.at);
    const event = /** @type {HistoryEvent} */ ({ t: 0, a: 0, k: "disaster", p: strike.p, n: strike.n, x: strike.x });
    const family = disasterFamily(strike.x);
    const key = "dis:" + strike.at + ":" + strike.p + ":" + (strike.x || "") + ":" + (strike.n || "");
    const className = "dgh-tl-disaster dgh-tl-disaster--" + family + (strike.p === cast.local ? "" : " is-foreign");
    const box = { left: turnToPercent(win, strike.at), top: 0.25 + rows[i] * DISASTER_ROW };
    const tooltip = (strike.d ? strike.d + ": " : "") + eventText(event, cast, age);
    return iconDisc(placeItem(className, box, tooltip, [], reuseSlot(cache, key)), DISASTER_ICONS[family]);
  });
  const height = 0.5 + (Math.max(...rows) + 1) * DISASTER_ROW;
  return { key: "disasters", label: "LOC_DEMOGRAPHICS_HIST_TL_DISASTERS", height, items };
}

/**
 * Migration (Emigration mod): arrivals rise above the center line, departures hang below it.
 * @param {Timeline} tl
 * @param {AxisWindow} win
 * @returns {Lane|null}
 */
export function migrationLane(tl, win) {
  const list = tl.mig.filter((bucket) => bucket.at >= win.from && bucket.at <= win.to);
  if (!list.length) return null;
  const max = Math.max(1, ...list.map((bucket) => Math.max(bucket.i, bucket.o)));
  const half = 1.3;
  const width = Math.max(0.3, (70 * (tl.total / MIGRATION_BUCKETS)) / Math.max(1, win.to - win.from));
  const items = [placeItem("dgh-tl-mig-axis", { left: 0, width: 100, top: half, height: 0.05 }, "")];
  for (const bucket of list) {
    const tooltip = t("LOC_DEMOGRAPHICS_HIST_TL_MIGRATION", shortPeople(bucket.i), shortPeople(bucket.o));
    const inHeight = (half * bucket.i) / max;
    const outHeight = (half * bucket.o) / max;
    const left = turnToPercent(win, bucket.at) - width / 2;
    if (bucket.i > 0) {
      const box = { left, width, top: half - inHeight, height: inHeight };
      items.push(placeItem("dgh-tl-mig dgh-tl-mig--in", box, tooltip));
    }
    if (bucket.o > 0) {
      const box = { left, width, top: half + 0.05, height: outHeight };
      items.push(placeItem("dgh-tl-mig dgh-tl-mig--out", box, tooltip));
    }
  }
  return { key: "mig", label: "LOC_DEMOGRAPHICS_HIST_TL_MIGRATION_LANE", height: half * 2 + 0.1, items };
}
