// history-timeline-view.js
//
// The interactive Timeline graphic of one game: a control row (window, zoom, pan, playback) over a
// fixed column of lane labels beside a horizontally scrolling canvas of history-timeline-lanes.js
// lanes. Playback sweeps a cursor that veils the future and names the latest event; the graphic
// redraws in place so the page keeps its scroll position. Everything is HTML placed by percentage.

import { el, clear, onActivate } from "/demographics/ui/history/core/history-dom.js";
import { derr, safe } from "/demographics/ui/history/core/history-log.js";
import { t, typeName } from "/demographics/ui/history/core/history-text.js";
import { eventText } from "/demographics/ui/history/model/history-narrate.js";
import { pillRow, civIcon, emptyState } from "/demographics/ui/history/views/history-widgets.js";
import { mapPanel } from "/demographics/ui/history/views/history-map-view.js";
import { KIND_ICONS, DISASTER_ICONS } from "/demographics/ui/history/core/history-icons.js";
import { focusTimeline, timelineCivs } from "/demographics/ui/history/model/history-timeline.js";
import { viewState } from "/demographics/ui/history/views/history-state.js";
import {
  xp, ageHeader, warLane, crisisLane, milestoneLanes, settlementLane, disasterLane, migrationLane, populationLane,
  rulerLane, gridLines, shortPeople, newItemCache, beginItemPass, endItemPass
} from "/demographics/ui/history/views/history-timeline-lanes.js";

export { stackRows, shortPeople } from "/demographics/ui/history/views/history-timeline-lanes.js";

/** Zoom levels (canvas width in viewport widths). */
const ZOOMS = [1, 2, 4, 8];
/** Playback length of a window, in ticks, and the tick interval in milliseconds. */
const PLAY_TICKS = 300;
const PLAY_MS = 40;

/** Milestone kinds in legend order, with their legend labels. */
const MARK_LEGEND = [
  ["victory", "LOC_DEMOGRAPHICS_HIST_RESULT_VICTORY"],
  ["wonder", "LOC_DEMOGRAPHICS_HIST_FILTER_WONDERS"],
  ["triumph", "LOC_DEMOGRAPHICS_HIST_FILTER_TRIUMPHS"],
  ["religion", "LOC_DEMOGRAPHICS_HIST_FILTER_FAITH"],
  ["capture", "LOC_DEMOGRAPHICS_HIST_FACT_CAPTURED"],
  ["lost", "LOC_DEMOGRAPHICS_HIST_FACT_LOST"],
  ["elim", "LOC_DEMOGRAPHICS_HIST_LINEAGE_FALLEN"]
];

/**
 * @typedef {import("../model/history-timeline.js").Timeline} Timeline
 * @typedef {import("../model/history-narrate.js").Cast} Cast
 * @typedef {{from:number, to:number}} Win
 * @typedef {{at:number, text:string}} Beat
 */

/**
 * A handler that logs a throw instead of letting it out. Event and timer callbacks run outside the
 * page's render try/catch, so a throw there would leave the graphic half-updated with nothing
 * logged, and a timer would throw again on every tick.
 * @template {any[]} A
 * @param {string} what What the handler does, for the log line.
 * @param {(...args: A) => void} fn Handler.
 * @returns {(...args: A) => void} The guarded handler.
 */
function guarded(what, fn) {
  return (...args) => {
    try {
      fn(...args);
    } catch (e) {
      derr("timeline " + what + " failed", e);
    }
  };
}

/**
 * The window shown for the selected age ("all" is the whole game).
 * @param {Timeline} tl Timeline.
 * @param {string} age Selected age type or "all".
 * @returns {Win} Window.
 */
export function windowFor(tl, age) {
  const a = tl.ages.find((x) => x.age === age);
  return a ? { from: a.from, to: a.from + a.len } : { from: 0, to: Math.max(1, tl.total) };
}

/**
 * Every dated happening on the timeline, oldest first, for the playback caption.
 * @param {Timeline} tl Timeline.
 * @param {Cast} cast Cast.
 * @returns {Beat[]} Beats.
 */
export function beats(tl, cast) {
  const ageAt = (/** @type {number} */ at) => tl.ages.find((a) => at >= a.from && at < a.from + a.len)?.age || "";
  const said = (/** @type {number} */ at, /** @type {string} */ d, /** @type {HnrEvent} */ e) =>
    ({ at, text: dated(d, eventText(e, cast, ageAt(at))) });
  const ev = (/** @type {*} */ o) => /** @type {HnrEvent} */ ({ t: 0, a: 0, ...o });
  /** @type {Beat[]} */
  const out = [
    ...tl.ages.map((a) => ({ at: a.from, text: dated(a.d, typeName(a.n, a.age)) })),
    ...tl.wars.map((w) => ({ at: w.from, text: dated(w.d, warText(cast, w, ageAt(w.from))) })),
    ...tl.crises.map((c) => ({ at: c.from, text: crisisText(c) })),
    ...tl.marks.map((m) => said(m.at, m.d, ev({ k: m.k === "lost" ? "capture" : m.k, p: m.p, q: m.q, n: m.n, x: m.x }))),
    ...tl.disasters.map((d) => said(d.at, d.d, ev({ k: "disaster", p: d.p, n: d.n, x: d.x }))),
    ...tl.founds.map((f) => said(f.at, f.d, ev({ k: "found", p: f.p ?? cast.local, n: f.n }))),
    ...tl.pops.map((p) => ({ at: p.at, text: t("LOC_DEMOGRAPHICS_HIST_TL_POP_REACHED", shortPeople(p.v)) }))
  ];
  return out.sort((a, b) => a.at - b.at);
}

/**
 * "date: text", or the text alone without a date.
 * @param {string} d Date.
 * @param {string} s Text.
 * @returns {string} Line.
 */
function dated(d, s) {
  return (d ? d + ": " : "") + s;
}

/**
 * The enemy's name for a war (independent peoples when unnamed).
 * @param {Cast} cast Cast.
 * @param {number} pid Enemy.
 * @param {string} age Age.
 * @returns {string} Name.
 */
function warName(cast, pid, age) {
  return cast.civName(pid, age) || t("LOC_DEMOGRAPHICS_HIST_INDEPENDENT_PEOPLE");
}

/**
 * A war's caption: yours against the enemy, or two other civilizations against each other.
 * @param {Cast} cast Cast.
 * @param {Timeline["wars"][number]} w War.
 * @param {string} age Age type.
 * @returns {string} Caption.
 */
function warText(cast, w, age) {
  if (w.a != null && w.a !== cast.local) return t("LOC_DEMOGRAPHICS_HIST_TL_RIVAL_WAR", warName(cast, w.a, age), warName(cast, w.other, age));
  return t("LOC_DEMOGRAPHICS_HIST_TL_WAR_WITH", warName(cast, w.other, age));
}

/**
 * A crisis stage's caption.
 * @param {Timeline["crises"][number]} c Stage.
 * @returns {string} Caption.
 */
function crisisText(c) {
  return (t(c.n) || t("LOC_DEMOGRAPHICS_HIST_CRISIS_UNNAMED")) + ", " + t("LOC_DEMOGRAPHICS_HIST_TL_STAGE", c.stage);
}

/**
 * The latest beat at or before a position.
 * @param {Beat[]} list Beats, oldest first.
 * @param {number} at Position.
 * @returns {Beat|null} Beat.
 */
export function beatAt(list, at) {
  let found = null;
  for (const b of list) {
    if (b.at > at) break;
    found = b;
  }
  return found;
}

/**
 * The game turn and age at an axis position ("Antiquity, turn 42").
 * @param {Timeline} tl Timeline.
 * @param {number} at Position.
 * @returns {string} Label.
 */
function turnLabel(tl, at) {
  const a = tl.ages.find((x) => at >= x.from && at < x.from + x.len) || tl.ages[tl.ages.length - 1];
  if (!a) return "";
  return typeName(a.n, a.age) + ", " + t("LOC_DEMOGRAPHICS_HIST_TL_TURN", Math.round((a.t0 || 1) + at - a.from));
}

/**
 * The lanes of the window, in drawing order.
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @param {Cast} cast Cast.
 * @param {number} zoom Zoom.
 * @param {import("./history-timeline-lanes.js").ItemCache} [cache] Item-reuse cache, handed to the
 *   lanes whose items carry engine art (emblems, medallions, gems) so a redraw keeps those
 *   elements instead of re-creating them and making each one blink.
 * @returns {import("./history-timeline-lanes.js").Lane[]} Lanes.
 */
function lanesFor(tl, w, cast, zoom, cache) {
  return [
    ageHeader(tl, w, cast, cache), warLane(tl, w, cast, cache), crisisLane(tl, w, cache),
    ...milestoneLanes(tl, w, cast, cache),
    settlementLane(tl, w, cast), disasterLane(tl, w, cast, cache), migrationLane(tl, w),
    populationLane(tl, w, cast), rulerLane(tl, w, zoom)
  ].filter((x) => !!x).map((x) => /** @type {import("./history-timeline-lanes.js").Lane} */ (x));
}

/**
 * The legend of what this timeline shows.
 * @param {Timeline} tl Timeline.
 * @returns {HTMLElement} Legend.
 */
function legend(tl) {
  const present = new Set(tl.marks.map((m) => m.k));
  const item = (/** @type {string} */ swatch, /** @type {string} */ label) =>
    el("div", { cls: "dgh-tl-legend-item" }, [el("div", { cls: swatch }), el("div", { text: t(label) })]);
  const iconItem = (/** @type {string} */ icon, /** @type {string} */ label) => {
    const swatch = el("div", { cls: "dgh-tl-legend-icon" });
    swatch.style.backgroundImage = "url('" + icon + "')";
    return el("div", { cls: "dgh-tl-legend-item" }, [swatch, el("div", { text: t(label) })]);
  };
  const items = MARK_LEGEND.filter(([k]) => present.has(k)).map(([k, label]) => iconItem(KIND_ICONS[k], label));
  if (tl.crises.length) items.push(iconItem(KIND_ICONS.crisis, "LOC_DEMOGRAPHICS_HIST_TL_CRISES"));
  if (tl.disasters.length) items.push(iconItem(DISASTER_ICONS.volcano, "LOC_DEMOGRAPHICS_HIST_TL_DISASTERS"));
  if (tl.mig.length) {
    items.push(item("dgh-tl-swatch dgh-tl-swatch--in", "LOC_DEMOGRAPHICS_HIST_TL_ARRIVED"));
    items.push(item("dgh-tl-swatch dgh-tl-swatch--out", "LOC_DEMOGRAPHICS_HIST_TL_LEFT"));
  }
  return el("div", { cls: "dgh-tl-legend" }, items);
}

/**
 * The territory map (when the game has one) above the timeline, following its cursor, with an
 * optional companion (the rivals) to its right.
 * @param {Timeline} tl Timeline.
 * @param {import("../model/history-map.js").MapView|null} mv Territory map.
 * @param {Cast} cast Cast.
 * @param {HTMLElement|null} [side] Shown to the right of the map.
 * @param {string} [key] The game's id (the civilization filter is remembered per game).
 * @returns {HTMLElement[]} Map row and timeline.
 */
export function timelineWithMap(tl, mv, cast, side = null, key = "") {
  if (!mv) return side ? [side, timelineGraphic(tl, cast, { key })] : [timelineGraphic(tl, cast, { key })];
  const ageAt = (/** @type {number} */ at) =>
    (tl.ages.find((a) => at >= a.from && at < a.from + a.len) || tl.ages[tl.ages.length - 1])?.age || "";
  const map = mapPanel(mv, cast, ageAt, (at) => turnLabel(tl, at));
  const row = el("div", { cls: "dgh-map-row" }, [map.el, side ? el("div", { cls: "dgh-map-side" }, [side]) : null]);
  return [row, timelineGraphic(tl, cast, { onSeek: map.show, key })];
}

/**
 * The interactive timeline of one game.
 * @param {Timeline} tl Timeline.
 * @param {Cast} cast Cast.
 * @param {{onSeek?: (at:number) => void, key?: string}} [opts] onSeek: told the position shown (the cursor,
 *   else the end of the window), so a companion such as the territory map can follow; key: the game's id.
 * @returns {HTMLElement} Graphic.
 */
export function timelineGraphic(tl, cast, opts = {}) {
  const root = el("div", { cls: "dgh-tl" });
  /** @type {{timer: any, at: number}} */
  const play = { timer: null, at: -1 };
  const stop = () => {
    if (play.timer != null) clearInterval(play.timer);
    play.timer = null;
  };
  // Every redraw path (age and zoom pills, the civilization filter) ends here, so a redraw that
  // fails leaves a message in place of the graphic rather than a half-drawn one or nothing.
  // The civilization filter (civ emblems) and the legend (icon swatches) depend only on WHICH
  // civilizations are shown — never on the age window or the zoom. Rebuilding them on every age or
  // zoom click re-created their engine art, and each icon blinked while it resolved again, so they
  // are kept against the shown set and moved back into place instead of being remade.
  /** @type {{ sig: string|null, civs: HTMLElement|null, legend: HTMLElement|null }} */
  const chrome = { sig: null, civs: null, legend: null };
  // One cache per timeline instance (never module-level: two timelines would fight over the same
  // elements, and an element can only have one parent).
  const items = newItemCache();
  const draw = () => {
    stop();
    try {
      if (!tl.ages.some((a) => a.age === viewState.tlAge)) viewState.tlAge = "all";
      const shown = shownCivs(opts.key || "", cast);
      const focused = focusTimeline(tl, cast.local, shown);
      const sig = Array.from(shown).sort((a, b) => a - b).join(",");
      if (sig !== chrome.sig) {
        chrome.sig = sig;
        chrome.civs = civFilter(tl, cast, shown, opts.key || "", draw);
        chrome.legend = legend(focused);
      }
      clearExcept(root, [chrome.civs, chrome.legend]);
      const fx = { redraw: draw, stop, onSeek: opts.onSeek || (() => {}) };
      drawInto(root, focused, cast, play, { ...fx, civs: chrome.civs, legend: chrome.legend, items });
    } catch (e) {
      derr("timeline draw failed", e);
      // The kept chrome may be half-wired after a throw, and the item pass never finished; force a
      // clean rebuild of both on the next draw.
      chrome.sig = null;
      items.items.clear();
      clear(root);
      root.appendChild(emptyState(t("LOC_DEMOGRAPHICS_EMPTY_CHART_RENDER_FAILED")));
    }
  };
  draw();
  return root;
}

/**
 * The civilizations picked for a game: the saved pick for this game, else just your own.
 * @param {string} key Game id.
 * @param {Cast} cast Cast.
 * @returns {Set<number>} Picked player ids.
 */
function shownCivs(key, cast) {
  const pick = viewState.tlCivs;
  return new Set(pick && pick.key === key ? pick.pids : [cast.local]);
}

/**
 * The civilization filter: a chip per civilization the timeline can show (emblem, color, name), with
 * "Only mine" and "All" shortcuts. Independent of the territory map.
 * @param {Timeline} tl Timeline (unfiltered).
 * @param {Cast} cast Cast.
 * @param {Set<number>} shown Picked civilizations.
 * @param {string} key Game id.
 * @param {() => void} redraw Redraw the timeline.
 * @returns {HTMLElement|null} The row, or null when only you appear.
 */
function civFilter(tl, cast, shown, key, redraw) {
  const age = tl.ages[tl.ages.length - 1]?.age || "";
  const civs = timelineCivs(tl, cast.local).filter((pid) => pid === cast.local || (cast.known(pid) && cast.color(pid)));
  if (civs.length < 2) return null;
  const set = guarded("civilization filter", (/** @type {number[]} */ pids) => {
    viewState.tlCivs = { key, pids };
    redraw();
  });
  const quick = (/** @type {string} */ label, /** @type {number[]} */ pids, /** @type {boolean} */ on) => {
    const b = el("div", { cls: "dgh-pill dgh-tl-civ-quick" + (on ? " is-active" : ""), text: t(label) });
    onActivate(b, () => set(pids));
    return b;
  };
  const chips = civs.map((pid) => {
    const on = shown.has(pid);
    const civ = cast.civType(pid, age);
    const chip = el("div", { cls: "dgh-tl-civ" + (on ? " is-active" : "") + (pid === cast.local ? " is-mine" : "") }, [
      el("div", { cls: "dgh-civ-dot", style: { backgroundColor: cast.color(pid) || "#85878c" } }),
      civ ? civIcon(civ, "dgh-civ-icon dgh-tl-civ-icon") : null,
      el("div", { text: cast.civName(pid, age) || cast.leaderName(pid) })
    ]);
    chip.setAttribute("data-tooltip-content", cast.leaderName(pid));
    onActivate(chip, () => set(on ? [...shown].filter((x) => x !== pid) : [...shown, pid]));
    return chip;
  });
  const onlyMine = shown.size === 1 && shown.has(cast.local);
  return el("div", { cls: "dgh-tl-civs" }, [
    el("div", { cls: "dgh-tl-civs-label", text: t("LOC_DEMOGRAPHICS_HIST_TL_CIVS") }),
    quick("LOC_DEMOGRAPHICS_HIST_TL_ONLY_MINE", [cast.local], onlyMine),
    quick("LOC_DEMOGRAPHICS_HIST_TL_ALL_CIVS", civs, shown.size === civs.length),
    ...chips
  ]);
}

/**
 * Build the controls, labels, canvas and caption into the root.
 * @param {HTMLElement} root Root (emptied).
 * @param {Timeline} tl Timeline.
 * @param {Cast} cast Cast.
 * @param {{timer: any, at: number}} play Playback state.
 * @param {{redraw: () => void, stop: () => void, onSeek: (at:number) => void,
 *   civs: HTMLElement|null, legend?: HTMLElement|null,
 *   items?: import("./history-timeline-lanes.js").ItemCache}} fx Redraw,
 *   stop, seek listener and the civilization filter row.
 */
function drawInto(root, tl, cast, play, fx) {
  const zoom = ZOOMS.includes(viewState.tlZoom) ? viewState.tlZoom : 1;
  const w = windowFor(tl, viewState.tlAge);
  beginItemPass(fx.items);
  const lanes = lanesFor(tl, w, cast, zoom, fx.items);
  endItemPass(fx.items);
  const labels = el("div", { cls: "dgh-tl-labels" }, lanes.map((l) =>
    el("div", { cls: "dgh-tl-label", text: l.label ? t(l.label) : "", style: { height: l.height + "rem" } })));
  const laneEls = lanes.map((l) => el("div", { cls: "dgh-tl-lane dgh-tl-lane--" + l.key, style: { height: l.height + "rem" } }, l.items));
  const canvas = el("div", { cls: "dgh-tl-canvas", style: { width: zoom * 100 + "%" } }, [...gridLines(tl, w, zoom), ...laneEls]);
  const viewport = el("div", { cls: "dgh-tl-viewport" }, [canvas]);
  const caption = el("div", { cls: "dgh-tl-caption" });
  const player = playback(tl, cast, w, play, { canvas, viewport, caption, stop: fx.stop, onSeek: fx.onSeek });
  wireLanes(tl, w, lanes.map((l, i) => ({ key: l.key, node: laneEls[i] })), player, cast);
  root.appendChild(controls(tl, player, viewport, fx));
  if (fx.civs) root.appendChild(fx.civs);
  root.appendChild(el("div", { cls: "dgh-tl-body" }, [labels, viewport]));
  root.appendChild(caption);
  // Kept from the previous draw when the shown civilizations did not change (see `chrome` in
  // timelineGraphic); appending an element already in the tree MOVES it back into place.
  root.appendChild(fx.legend || legend(tl));
  if (play.at >= w.from && play.at <= w.to) player.seek(play.at);
  else fx.onSeek(w.to - 0.5);
}

/**
 * Remove every child of `node` except the ones being kept across this redraw.
 * @param {HTMLElement} node The container.
 * @param {Array<HTMLElement|null>} keep The children to leave in the tree.
 */
function clearExcept(node, keep) {
  for (const child of Array.prototype.slice.call(node.children)) {
    if (!keep.includes(child) && child.parentNode === node) node.removeChild(child);
  }
}

/**
 * Mouse behaviour of the lanes: the ruler seeks on click, and the ruler and population lane show a
 * readout that follows the mouse.
 * @param {Timeline} tl Timeline.
 * @param {Win} w Window.
 * @param {{key:string, node:HTMLElement}[]} lanes Lane elements.
 * @param {Player} player Player.
 * @param {Cast} cast Cast.
 */
function wireLanes(tl, w, lanes, player, cast) {
  const ruler = lanes.find((l) => l.key === "ruler")?.node;
  if (ruler) {
    onActivateAt(ruler, (frac) => player.seek(w.from + frac * (w.to - w.from)));
    hoverReadout(ruler, w, (at) => turnLabel(tl, at));
  }
  const pops = lanes.find((l) => l.key === "pops")?.node;
  if (pops) hoverReadout(pops, w, (at) => turnLabel(tl, at) + "  ·  " + populationsAt(tl, cast, at));
}

/**
 * Population at a position: yours alone, or each shown civilization's when rivals are shown.
 * @param {Timeline} tl Timeline (focused).
 * @param {Cast} cast Cast.
 * @param {number} at Position.
 * @returns {string} Text.
 */
function populationsAt(tl, cast, at) {
  const lines = tl.lines || [];
  const age = tl.ages.find((a) => at >= a.from && at < a.from + a.len)?.age || "";
  if (!lines.length) return shortPeople(valueAt(tl.curve, at));
  const all = [...(tl.curve.length ? [{ pid: cast.local, pts: tl.curve }] : []), ...lines];
  return all.map((l) => (cast.civName(l.pid, age) || cast.leaderName(l.pid)) + " " + shortPeople(valueAt(l.pts, at))).join("  ·  ");
}

/**
 * The value of a curve at a position, interpolated between its points (0 before the first).
 * @param {{at:number, v:number}[]} curve Points, oldest first.
 * @param {number} at Position.
 * @returns {number} Value.
 */
export function valueAt(curve, at) {
  if (!curve.length || at < curve[0].at) return 0;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (at <= b.at) return b.at === a.at ? b.v : a.v + ((b.v - a.v) * (at - a.at)) / (b.at - a.at);
  }
  return curve[curve.length - 1].v;
}

/**
 * A readout that follows the mouse across a lane: a hairline and a label naming what is under it.
 * @param {HTMLElement} lane Lane.
 * @param {Win} w Window.
 * @param {(at:number) => string} textAt Label for a position.
 */
function hoverReadout(lane, w, textAt) {
  const line = el("div", { cls: "dgh-tl-hover-line" });
  const label = el("div", { cls: "dgh-tl-hover-label" });
  const box = el("div", { cls: "dgh-tl-hover is-hidden" }, [line, label]);
  lane.appendChild(box);
  lane.addEventListener("mousemove", guarded("readout", (/** @type {any} */ ev) => {
    const r = lane.getBoundingClientRect();
    if (!(r.width > 0) || typeof ev.clientX !== "number") return;
    const frac = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    box.style.left = (frac * 100).toFixed(3) + "%";
    label.textContent = textAt(w.from + frac * (w.to - w.from));
    if (frac > 0.75) label.classList.add("is-left");
    else label.classList.remove("is-left");
    box.classList.remove("is-hidden");
  }));
  // GameFace also sends mouseleave when the pointer crosses the lane's own children, so hide only
  // once it is really outside the lane.
  lane.addEventListener("mouseleave", (/** @type {any} */ ev) => {
    const r = lane.getBoundingClientRect();
    const x = ev?.clientX;
    const y = ev?.clientY;
    const inside = typeof x === "number" && typeof y === "number" && x > r.left && x < r.left + r.width && y > r.top && y < r.top + r.height;
    if (!inside) box.classList.add("is-hidden");
  });
}

/**
 * Call back with the horizontal fraction (0..1) of a click inside an element.
 * @param {Element} target Element.
 * @param {(frac:number) => void} fn Handler.
 */
function onActivateAt(target, fn) {
  target.addEventListener("click", guarded("seek", (/** @type {any} */ ev) => {
    const r = target.getBoundingClientRect();
    if (r.width > 0) fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)));
  }));
}

/**
 * @typedef {Object} Player
 * @property {(at:number) => void} seek Move the cursor.
 * @property {() => void} toggle Play or pause.
 * @property {() => boolean} playing Whether playback runs.
 * @property {(fn: () => void) => void} onEnd Called when playback reaches the end of the window.
 */

/**
 * Playback: a cursor with a veil over the future and a caption naming the latest event.
 * @param {Timeline} tl Timeline.
 * @param {Cast} cast Cast.
 * @param {Win} w Window.
 * @param {{timer: any, at: number}} play Playback state (kept across redraws).
 * @param {{canvas: HTMLElement, viewport: HTMLElement, caption: HTMLElement, stop: () => void,
 *   onSeek: (at:number) => void}} ui Parts.
 * @returns {Player} Player.
 */
function playback(tl, cast, w, play, ui) {
  const list = beats(tl, cast);
  const cursor = el("div", { cls: "dgh-tl-cursor" });
  const veil = el("div", { cls: "dgh-tl-veil" });
  /** @type {(() => void)|null} */
  let onChange = null;
  const seek = (/** @type {number} */ at) => {
    play.at = Math.max(w.from, Math.min(w.to, at));
    const x = xp(w, play.at);
    if (!cursor.parentNode) { ui.canvas.appendChild(veil); ui.canvas.appendChild(cursor); }
    cursor.style.left = x.toFixed(3) + "%";
    veil.style.left = x.toFixed(3) + "%";
    const beat = beatAt(list, play.at);
    ui.caption.textContent = turnLabel(tl, play.at) + (beat && beat.at >= w.from ? "  ·  " + beat.text : "");
    follow(ui.viewport, ui.canvas, x);
    ui.onSeek(play.at);
  };
  // A throw inside a tick stops playback first: the interval would otherwise throw again every
  // PLAY_MS, and the play button would still read "Pause".
  const tick = () => {
    try {
      if (!ui.canvas.isConnected) return ui.stop();
      const next = play.at + (w.to - w.from) / PLAY_TICKS;
      seek(next);
      if (next >= w.to) { ui.stop(); onChange?.(); }
    } catch (e) {
      ui.stop();
      derr("timeline playback failed", e);
      safe(() => onChange?.(), undefined);
    }
  };
  return {
    seek,
    playing: () => play.timer != null,
    toggle: () => {
      if (play.timer != null) ui.stop();
      else {
        if (play.at < w.from || play.at >= w.to) seek(w.from);
        play.timer = setInterval(tick, PLAY_MS);
      }
    },
    onEnd: (fn) => { onChange = fn; }
  };
}

/**
 * Keep the cursor in view while it moves.
 * @param {HTMLElement} viewport Scroll box.
 * @param {HTMLElement} canvas Canvas.
 * @param {number} x Cursor position in percent of the canvas.
 */
function follow(viewport, canvas, x) {
  const px = (canvas.offsetWidth * x) / 100;
  const view = viewport.clientWidth;
  const off = px < viewport.scrollLeft + view * 0.1 || px > viewport.scrollLeft + view * 0.8;
  if (off) viewport.scrollLeft = Math.max(0, px - view * 0.3);
}

/**
 * The control row: age window, zoom, pan and play.
 * @param {Timeline} tl Timeline.
 * @param {Player} player Player.
 * @param {HTMLElement} viewport Scroll box.
 * @param {{redraw: () => void, stop: () => void}} fx Redraw.
 * @returns {HTMLElement} Row.
 */
function controls(tl, player, viewport, fx) {
  const ages = [
    { key: "all", label: t("LOC_DEMOGRAPHICS_HIST_TL_ALL_AGES") },
    ...tl.ages.map((a) => ({ key: a.age, label: typeName(a.n, a.age) }))
  ];
  const zooms = ZOOMS.map((z) => ({ key: String(z), label: z + "×" }));
  const pan = (/** @type {number} */ dir) => {
    viewport.scrollLeft = Math.max(0, viewport.scrollLeft + dir * viewport.clientWidth * 0.8);
  };
  const playBtn = el("div", { cls: "dgh-button dgh-tl-play" });
  const label = () => {
    clear(playBtn);
    playBtn.appendChild(el("div", { cls: player.playing() ? "dgh-tl-pause-icon" : "dgh-tl-play-icon" }));
    playBtn.appendChild(el("div", { text: t(player.playing() ? "LOC_DEMOGRAPHICS_HIST_TL_PAUSE" : "LOC_DEMOGRAPHICS_HIST_TL_PLAY") }));
  };
  player.onEnd(label);
  onActivate(playBtn, guarded("play", () => { player.toggle(); label(); }));
  label();
  const panBtn = (/** @type {string} */ text, /** @type {number} */ dir) => {
    const b = el("div", { cls: "dgh-button dgh-tl-pan", text });
    onActivate(b, () => pan(dir));
    return b;
  };
  return el("div", { cls: "dgh-tl-controls" }, [
    pillRow(ages, viewState.tlAge, guarded("age window", (k) => { viewState.tlAge = k; fx.redraw(); })),
    el("div", { cls: "dgh-tl-controls-right" }, [
      pillRow(zooms, String(viewState.tlZoom), guarded("zoom", (k) => { viewState.tlZoom = Number(k); fx.redraw(); })),
      panBtn("←", -1), panBtn("→", 1), playBtn
    ])
  ]);
}
