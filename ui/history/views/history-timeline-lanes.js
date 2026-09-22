// history-timeline-lanes.js
//
// The lanes of the Timeline graphic, each built for a window of the axis (the whole game or one
// age): the age header, wars, crises, milestones, the population growth curve and the date ruler.
// A lane is { label, height (rem), items }; items are absolutely placed by percentage inside the
// lane, and history-timeline-view.js stacks the lanes and keeps their labels in a fixed column.

import { el } from "/demographics/ui/history/core/history-dom.js";
import { t, num, typeName } from "/demographics/ui/history/core/history-text.js";
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
 * @typedef {{from:number, to:number}} Win
 * @typedef {{key:string, label:string, height:number, items:HTMLElement[]}} Lane
 */

/**
 * Percent of the window for a position.
 * @param {Win} w Window.
 * @param {number} v Position.
 * @returns {number} 0..100 (unclamped).
 */
export function xp(w, v) {
  return (100 * (v - w.from)) / Math.max(1, w.to - w.from);
}

/**
 * Whether an interval shows in the window.
 * @param {Win} w Window.
 * @param {number} a Start.
 * @param {number} b End.
 * @returns {boolean} True when it overlaps.
 */
function inWin(w, a, b) {
  return b > w.from && a < w.to;
}

/**
 * A positioned element with a tooltip.
 * @param {string} cls Classes.
 * @param {{l:number, w?:number, top:number, h?:number}} box Left/width in %, top/height in rem.
 * @param {string} tip Tooltip text.
 * @param {Array<HTMLElement|null>} [kids] Children.
 * @returns {HTMLElement} Element.
 */
function place(cls, box, tip, kids = []) {
  const style = /** @type {Record<string, string>} */ ({ left: Math.max(0, box.l).toFixed(3) + "%", top: box.top + "rem" });
  if (box.w != null) style.width = Math.max(0.3, Math.min(100 - Math.max(0, box.l), box.w + Math.min(0, box.l))).toFixed(3) + "%";
  if (box.h != null) style.height = box.h + "rem";
  const e = el("div", { cls: "dgh-tl-item " + cls, style }, kids);
  if (tip) e.setAttribute("data-tooltip-content", tip);
  return e;
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
    let r = rowEnds.findIndex((end) => it.from >= end + gap);
    if (r === -1) r = rowEnds.length;
    rowEnds[r] = Math.max(it.to, it.from);
    return r;
  });
}

/**
 * Short people count ("2.5M", "10M", "1B").
 * @param {number} v People.
 * @returns {string} Label.
 */
export function shortPeople(v) {
  if (v >= 1e9) return num(v / 1e9) + "B";
  if (v >= 1e6) return num(v / 1e6) + "M";
  if (v >= 1e3) return num(v / 1e3) + "K";
  return num(v);
}

/**
 * The age header: one band per age with your civilization's emblem and name, the age and its dates.
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @param {Cast} cast Cast.
 * @returns {Lane} Lane.
 */
export function ageHeader(tl, w, cast) {
  const items = tl.ages.filter((a) => inWin(w, a.from, a.from + a.len)).map((a) => {
    const i = tl.ages.indexOf(a);
    const next = tl.ages[i + 1];
    const dates = a.d + (next?.d ? " – " + next.d : "");
    const civ = cast.civType(cast.local, a.age);
    const title = typeName(a.n, a.age);
    return place("dgh-tl-band dgh-tl-band--" + (i % 3), { l: xp(w, a.from), w: xp(w, a.from + a.len) - xp(w, a.from), top: 0, h: 2.3 }, title + (dates ? " (" + dates + ")" : ""), [
      civ ? civIcon(civ, "dgh-civ-icon dgh-tl-band-icon") : null,
      el("div", { cls: "dgh-tl-band-text" }, [
        el("div", { cls: "dgh-tl-band-age", text: title }),
        el("div", { cls: "dgh-tl-band-sub", text: [cast.civName(cast.local, a.age), dates].filter(Boolean).join("  ·  ") })
      ])
    ]);
  });
  return { key: "ages", label: "", height: 2.4, items };
}

/**
 * Wars as pills: yours in the enemy's color with their emblem and name; a war between two other
 * civilizations shaded from one's color to the other's, with both emblems.
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @param {Cast} cast Cast.
 * @returns {Lane|null} Lane.
 */
export function warLane(tl, w, cast) {
  const wars = tl.wars.filter((x) => inWin(w, x.from, x.to));
  if (!wars.length) return null;
  const rows = stackRows(wars, 0);
  const items = wars.map((x, i) => {
    const age = tl.ages.find((a) => x.from >= a.from && x.from < a.from + a.len)?.age || "";
    const box = { l: xp(w, x.from), w: xp(w, x.to) - xp(w, x.from), top: 0.2 + rows[i] * 1.4, h: 1.2 };
    return x.a != null && x.a !== cast.local ? rivalWarPill(x, box, cast, age) : warPill(x, box, cast, age);
  });
  return { key: "wars", label: "LOC_DEMOGRAPHICS_HIST_FACT_WARS", height: 0.4 + (Math.max(...rows) + 1) * 1.4, items };
}

/**
 * A war of yours.
 * @param {Timeline["wars"][number]} x War.
 * @param {{l:number, w:number, top:number, h:number}} box Placement.
 * @param {Cast} cast Cast.
 * @param {string} age Age type.
 * @returns {HTMLElement} Pill.
 */
function warPill(x, box, cast, age) {
  const name = partyName(cast, x.other, age);
  const color = cast.color(x.other) || "#a8845a";
  const civ = cast.civType(x.other, age);
  const pill = place("dgh-tl-war", box, t("LOC_DEMOGRAPHICS_HIST_TL_WAR_WITH", name) + (x.d ? " (" + x.d + ")" : ""),
    [civ ? civIcon(civ, "dgh-civ-icon dgh-tl-war-icon") : null, el("div", { cls: "dgh-tl-war-name", text: name })]);
  pill.style.backgroundImage = `linear-gradient(90deg, ${withAlpha(color, 0.95)} 0%, ${withAlpha(color, 0.45)} 100%)`;
  pill.style.borderColor = withAlpha(color, 1);
  return pill;
}

/**
 * A war between two other civilizations.
 * @param {Timeline["wars"][number]} x War (`a` against `other`).
 * @param {{l:number, w:number, top:number, h:number}} box Placement.
 * @param {Cast} cast Cast.
 * @param {string} age Age type.
 * @returns {HTMLElement} Pill.
 */
function rivalWarPill(x, box, cast, age) {
  const a = /** @type {number} */ (x.a);
  const na = partyName(cast, a, age);
  const nb = partyName(cast, x.other, age);
  const ca = cast.color(a) || "#a8845a";
  const cb = cast.color(x.other) || "#a8845a";
  const icon = (/** @type {number} */ pid) => {
    const civ = cast.civType(pid, age);
    return civ ? civIcon(civ, "dgh-civ-icon dgh-tl-war-icon") : null;
  };
  const pill = place("dgh-tl-war dgh-tl-war--rivals", box,
    t("LOC_DEMOGRAPHICS_HIST_TL_RIVAL_WAR", na, nb) + (x.d ? " (" + x.d + ")" : ""),
    [icon(a), icon(x.other), el("div", { cls: "dgh-tl-war-name", text: na + " / " + nb })]);
  pill.style.backgroundImage = `linear-gradient(90deg, ${withAlpha(ca, 0.8)} 0%, ${withAlpha(cb, 0.8)} 100%)`;
  pill.style.borderColor = withAlpha(ca, 1);
  return pill;
}

/**
 * A civilization's name, or the independent peoples when it has none.
 * @param {Cast} cast Cast.
 * @param {number} pid Player.
 * @param {string} age Age type.
 * @returns {string} Name.
 */
function partyName(cast, pid, age) {
  return cast.civName(pid, age) || t("LOC_DEMOGRAPHICS_HIST_INDEPENDENT_PEOPLE");
}

/**
 * Crises: one bar per crisis carrying its name, divided into stages that darken from amber to crimson.
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @returns {Lane|null} Lane.
 */
export function crisisLane(tl, w) {
  const stages = tl.crises.filter((c) => inWin(w, c.from, c.to));
  if (!stages.length) return null;
  /** @type {Array<typeof stages>} */
  const groups = [];
  for (const c of stages) {
    const g = groups[groups.length - 1];
    if (g && c.stage > g[g.length - 1].stage && c.from <= g[g.length - 1].to) g.push(c);
    else groups.push([c]);
  }
  const items = groups.flatMap((g) => crisisGroup(g, w));
  return { key: "crises", label: "LOC_DEMOGRAPHICS_HIST_TL_CRISES", height: 1.9, items };
}

/**
 * One crisis: its stage segments and its name.
 * @param {Timeline["crises"]} g Stages of one crisis.
 * @param {Win} w Window.
 * @returns {HTMLElement[]} Elements.
 */
function crisisGroup(g, w) {
  const name = t(g[0].n) || t("LOC_DEMOGRAPHICS_HIST_CRISIS_UNNAMED");
  const segs = g.map((c) => place("dgh-tl-crisis dgh-tl-crisis--" + Math.min(4, c.stage),
    { l: xp(w, c.from), w: xp(w, c.to) - xp(w, c.from), top: 0.85, h: 0.9 },
    name + ", " + t("LOC_DEMOGRAPHICS_HIST_TL_STAGE", c.stage), [el("div", { cls: "dgh-tl-crisis-n", text: ROMAN[c.stage - 1] || String(c.stage) })]));
  const label = place("dgh-tl-crisis-name", { l: xp(w, g[0].from), top: 0 }, name, [
    iconDisc(el("div", { cls: "dgh-tl-crisis-icon" }), KIND_ICONS.crisis), el("div", { text: name })
  ]);
  return [label, ...segs];
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
 * and fallen civilizations). Within a lane, close neighbours alternate between two rows.
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @param {Cast} cast Cast.
 * @returns {Lane[]} Lanes (kinds with nothing in the window are left out).
 */
export function milestoneLanes(tl, w, cast) {
  const inWin = tl.marks.filter((m) => m.at >= w.from && m.at <= w.to);
  return MARK_GROUPS.map((g) => markLane(g, inWin.filter((m) => g.kinds.includes(m.k)), tl, w, cast))
    .filter((l) => !!l)
    .map((l) => /** @type {Lane} */ (l));
}

/**
 * One kind's lane.
 * @param {{key:string, label:string}} g Group.
 * @param {Timeline["marks"]} marks Its milestones in the window.
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @param {Cast} cast Cast.
 * @returns {Lane|null} Lane.
 */
function markLane(g, marks, tl, w, cast) {
  if (!marks.length) return null;
  const rows = stackRows(marks.map((m) => ({ from: m.at, to: m.at })), (w.to - w.from) * 0.028).map((r) => r % 2);
  const depth = Math.max(...rows) + 1;
  const items = marks.map((m, i) => {
    const age = tl.ages.find((a) => m.at >= a.from && m.at < a.from + a.len)?.age || "";
    const e = /** @type {HnrEvent} */ ({ t: 0, a: 0, k: m.k === "lost" ? "capture" : m.k, p: m.p, q: m.q, n: m.n, x: m.x });
    const tip = (m.d ? m.d + ": " : "") + eventText(e, cast, age);
    const top = 0.15 + rows[i] * (MEDAL * 0.55);
    return rivalRing(iconDisc(place("dgh-tl-medal dgh-tl-medal--" + m.k, { l: xp(w, m.at), top }, tip), markIcon(m)), m, cast);
  });
  return { key: "marks-" + g.key, label: g.label, height: 0.35 + MEDAL + (depth - 1) * MEDAL * 0.55, items };
}

/**
 * Paint a game icon into a disc.
 * @param {HTMLElement} disc Disc.
 * @param {string} icon Texture path ("" leaves the disc's own fill).
 * @returns {HTMLElement} The disc.
 */
function iconDisc(disc, icon) {
  if (icon) disc.style.backgroundImage = "url('" + icon + "')";
  const edge = edgeClass(parseFloat(disc.style.left || "0"));
  if (edge) disc.classList.add(edge);
  return disc;
}

/**
 * The class that keeps a disc at either end of the chart inside it rather than half cut off.
 * @param {number} left Left position in percent.
 * @returns {string} Class, or "".
 */
export function edgeClass(left) {
  if (left > 98.5) return "dgh-tl-edge-r";
  return left < 1.5 ? "dgh-tl-edge-l" : "";
}

/**
 * Mark another civilization's milestone (every ring is the same gold; its tooltip names the owner).
 * @param {HTMLElement} medal Medal.
 * @param {{k:string, p:number}} m Milestone.
 * @param {Cast} cast Cast.
 * @returns {HTMLElement} The medal.
 */
function rivalRing(medal, m, cast) {
  if (m.p !== cast.local && m.k !== "elim" && m.k !== "victory" && m.k !== "lost") medal.classList.add("is-rival");
  return medal;
}

/**
 * Settlements you founded: a marker per founding, stacked so none overlap, numbered in the tooltip.
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @param {Cast} cast Cast.
 * @returns {Lane|null} Lane.
 */
export function settlementLane(tl, w, cast) {
  /** @type {Map<number, number>} */
  const count = new Map();
  const numbered = tl.founds.map((f) => {
    const p = f.p ?? cast.local;
    count.set(p, (count.get(p) || 0) + 1);
    return { ...f, p, nth: count.get(p) || 1 };
  });
  const list = numbered.filter((f) => f.at >= w.from && f.at <= w.to);
  if (!list.length) return null;
  const rows = stackRows(list.map((f) => ({ from: f.at, to: f.at })), (w.to - w.from) * 0.008);
  const depth = Math.min(MAX_DEPTH, Math.max(...rows) + 1);
  const items = list.map((f, i) => {
    const age = tl.ages.find((a) => f.at >= a.from && f.at < a.from + a.len)?.age || "";
    const e = /** @type {HnrEvent} */ ({ t: 0, a: 0, k: "found", p: f.p, n: f.n });
    const color = cast.color(f.p) || "#e5d2ac";
    const tip = (f.d ? f.d + ": " : "") + eventText(e, cast, age) + " (" + t("LOC_DEMOGRAPHICS_HIST_TL_NTH_SETTLEMENT", f.nth) + ")";
    const pin = place("dgh-tl-found", { l: xp(w, f.at), top: 0.3 + (rows[i] % MAX_DEPTH) * 0.85 }, tip, [el("div", { cls: "dgh-tl-found-roof" })]);
    pin.style.backgroundColor = color;
    return pin;
  });
  return { key: "founds", label: "LOC_DEMOGRAPHICS_HIST_TL_SETTLEMENTS", height: 0.6 + depth * 0.85, items };
}

/**
 * Population (Demographics' scaled figures): your growth curve filled, with its milestones, and a
 * line in each shown rival's color, all on one scale.
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @param {Cast} cast Cast.
 * @returns {Lane|null} Lane.
 */
export function populationLane(tl, w, cast) {
  const inW = (/** @type {{at:number, v:number}[]} */ pts) => pts.filter((p) => p.at >= w.from - 1 && p.at <= w.to + 1);
  const mine = inW(tl.curve);
  const others = (tl.lines || []).map((l) => ({ pid: l.pid, pts: inW(l.pts) })).filter((l) => l.pts.length >= 2);
  if (mine.length < 2 && !others.length) return null;
  const max = Math.max(1, ...mine.map((p) => p.v), ...others.flatMap((l) => l.pts.map((p) => p.v)));
  const height = others.length ? 3.8 : 3;
  const holder = el("div", { cls: "dgh-tl-item dgh-tl-curve-box", style: { left: "0%", width: "100%", top: "0rem", height: height + "rem" } });
  holder.appendChild(/** @type {any} */ (curveSvg(mine, others.map((l) => ({ pts: l.pts, color: cast.color(l.pid) || "#c2c4cc" })), w, max)));
  const ticks = tl.pops.filter((p) => p.at >= w.from && p.at <= w.to).map((p) =>
    place("dgh-tl-poptick", { l: xp(w, p.at), top: 0, h: height }, t("LOC_DEMOGRAPHICS_HIST_TL_POP_REACHED", shortPeople(p.v)),
      [el("div", { cls: "dgh-tl-poptick-label", text: shortPeople(p.v) })]));
  return { key: "pops", label: "LOC_DEMOGRAPHICS_HIST_COL_POPULATION", height, items: [holder, ...ticks] };
}

/**
 * The curves as one stretched SVG (lines only; labels stay in HTML).
 * @param {{at:number, v:number}[]} mine Your points in the window (filled).
 * @param {{pts:{at:number, v:number}[], color:string}[]} others Other civilizations' points (lines).
 * @param {Win} w Window.
 * @param {number} max Top of the scale.
 * @returns {Element} SVG.
 */
function curveSvg(mine, others, w, max) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 1000 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("class", "dgh-tl-curve");
  const x = (/** @type {number} */ at) => (xp(w, at) * 10).toFixed(1);
  const xy = (/** @type {{at:number, v:number}[]} */ pts) => pts.map((p) => `${x(p.at)},${(100 - (95 * p.v) / max).toFixed(1)}`).join(" ");
  const shape = (/** @type {string} */ tag, /** @type {string} */ points, /** @type {string} */ cls) => {
    const n = document.createElementNS(SVG_NS, tag);
    n.setAttribute("points", points);
    n.setAttribute("class", cls);
    svg.appendChild(n);
    return n;
  };
  if (mine.length >= 2) {
    shape("polygon", `${x(mine[0].at)},100 ${xy(mine)} ${x(mine[mine.length - 1].at)},100`, "dgh-tl-curve-area");
    shape("polyline", xy(mine), "dgh-tl-curve-line");
  }
  for (const o of others) shape("polyline", xy(o.pts), "dgh-tl-curve-rival").setAttribute("stroke", o.color);
  return svg;
}

/** Major tick spacing candidates, in turns. */
const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100];

/**
 * Tick spacing for a window seen at a zoom: at most sixteen labelled ticks across the visible width, with
 * unlabelled minor ticks between them.
 * @param {Win} w Window.
 * @param {number} zoom Canvas width in viewport widths.
 * @returns {{major:number, minor:number}} Steps in turns.
 */
export function tickSteps(w, zoom) {
  const visible = (w.to - w.from) / Math.max(1, zoom);
  const major = TICK_STEPS.find((s) => visible / s <= 16) || 100;
  const minor = major >= 10 ? major / 5 : major >= 2 ? 1 : 0;
  return { major, minor: minor >= 1 && Number.isInteger(minor) ? minor : 0 };
}

/**
 * Every tick in the window: axis position, the age's own turn number, and whether it is labelled.
 * Turns restart each age, so ticks count from each age's first turn.
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @param {number} zoom Zoom.
 * @returns {{at:number, turn:number, major:boolean}[]} Ticks.
 */
export function ticks(tl, w, zoom) {
  const { major, minor } = tickSteps(w, zoom);
  const step = minor || major;
  /** @type {{at:number, turn:number, major:boolean}[]} */
  const out = [];
  for (const a of tl.ages) {
    const t0 = a.t0 || 1;
    for (let turn = Math.ceil(t0 / step) * step; turn < t0 + a.len; turn += step) {
      const at = a.from + (turn - t0);
      if (at > a.from && at >= w.from && at <= w.to) out.push({ at, turn, major: turn % major === 0 });
    }
  }
  return out;
}

/**
 * The ruler: turn ticks (labelled every major step) and each age's opening date.
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @param {number} zoom Zoom.
 * @returns {Lane} Lane.
 */
export function rulerLane(tl, w, zoom) {
  const ageOf = (/** @type {number} */ at) => tl.ages.find((a) => at >= a.from && at < a.from + a.len);
  const tickTip = (/** @type {{at:number, turn:number}} */ k) => {
    const a = ageOf(k.at);
    return (a ? typeName(a.n, a.age) + ", " : "") + t("LOC_DEMOGRAPHICS_HIST_TL_TURN", k.turn);
  };
  const items = ticks(tl, w, zoom).map((k) =>
    place("dgh-tl-tick" + (k.major ? " dgh-tl-tick--major" : ""), { l: xp(w, k.at), top: 0, h: k.major ? 0.75 : 0.45 }, tickTip(k),
      k.major ? [el("div", { cls: "dgh-tl-tick-label", text: t("LOC_DEMOGRAPHICS_HIST_TL_TURN", k.turn) })] : []));
  for (const a of tl.ages.filter((x) => x.from >= w.from && x.from < w.to)) {
    items.push(place("dgh-tl-tick dgh-tl-tick--age", { l: xp(w, a.from), top: 0, h: 1.8 }, a.d,
      [el("div", { cls: "dgh-tl-tick-date", text: a.d || typeName(a.n, a.age) })]));
  }
  return { key: "ruler", label: "", height: 2, items };
}

/**
 * Faint vertical guides through every lane at the labelled ticks.
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @param {number} zoom Zoom.
 * @returns {HTMLElement[]} Lines.
 */
export function gridLines(tl, w, zoom) {
  return ticks(tl, w, zoom).filter((k) => k.major).map((k) =>
    el("div", { cls: "dgh-tl-grid", style: { left: xp(w, k.at).toFixed(3) + "%" } }));
}

/**
 * The family of a disaster type, for its color: volcano, flood, storm or other.
 * @param {string} type RandomEventType.
 * @returns {string} Family.
 */
export function disasterFamily(type) {
  const u = String(type || "").toUpperCase();
  if (u.includes("VOLCAN") || u.includes("ERUPT")) return "volcano";
  if (u.includes("FLOOD")) return "flood";
  if (/STORM|HURRICANE|TORNADO|BLIZZARD|CYCLONE|TYPHOON|DUST|SAND|WIND/.test(u)) return "storm";
  if (/FIRE|DROUGHT|HEAT/.test(u)) return "fire";
  return "other";
}

/**
 * Natural disasters: a gem per strike, colored by family, ringed in the struck civilization's color
 * (your own lands full strength, others' dimmer).
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @param {Cast} cast Cast.
 * @returns {Lane|null} Lane.
 */
export function disasterLane(tl, w, cast) {
  const list = tl.disasters.filter((d) => d.at >= w.from && d.at <= w.to);
  if (!list.length) return null;
  const rows = stackRows(list.map((d) => ({ from: d.at, to: d.at })), (w.to - w.from) * 0.012).map((r) => r % 3);
  const items = list.map((d, i) => {
    const age = tl.ages.find((a) => d.at >= a.from && d.at < a.from + a.len)?.age || "";
    const e = /** @type {HnrEvent} */ ({ t: 0, a: 0, k: "disaster", p: d.p, n: d.n, x: d.x });
    const family = disasterFamily(d.x);
    const gem = iconDisc(place("dgh-tl-disaster dgh-tl-disaster--" + family + (d.p === cast.local ? "" : " is-foreign"),
      { l: xp(w, d.at), top: 0.25 + rows[i] * DISASTER_ROW }, (d.d ? d.d + ": " : "") + eventText(e, cast, age)), DISASTER_ICONS[family]);
    return gem;
  });
  return { key: "disasters", label: "LOC_DEMOGRAPHICS_HIST_TL_DISASTERS", height: 0.5 + (Math.max(...rows) + 1) * DISASTER_ROW, items };
}

/**
 * Migration (Emigration mod): arrivals rise above the center line, departures hang below it.
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @returns {Lane|null} Lane.
 */
export function migrationLane(tl, w) {
  const list = tl.mig.filter((m) => m.at >= w.from && m.at <= w.to);
  if (!list.length) return null;
  const max = Math.max(1, ...list.map((m) => Math.max(m.i, m.o)));
  const half = 1.3;
  const width = Math.max(0.3, (70 * (tl.total / MIGRATION_BUCKETS)) / Math.max(1, w.to - w.from));
  const items = [place("dgh-tl-mig-axis", { l: 0, w: 100, top: half, h: 0.05 }, "")];
  for (const m of list) {
    const tip = t("LOC_DEMOGRAPHICS_HIST_TL_MIGRATION", shortPeople(m.i), shortPeople(m.o));
    const hi = (half * m.i) / max;
    const ho = (half * m.o) / max;
    if (m.i > 0) items.push(place("dgh-tl-mig dgh-tl-mig--in", { l: xp(w, m.at) - width / 2, w: width, top: half - hi, h: hi }, tip));
    if (m.o > 0) items.push(place("dgh-tl-mig dgh-tl-mig--out", { l: xp(w, m.at) - width / 2, w: width, top: half + 0.05, h: ho }, tip));
  }
  return { key: "mig", label: "LOC_DEMOGRAPHICS_HIST_TL_MIGRATION_LANE", height: half * 2 + 0.1, items };
}
