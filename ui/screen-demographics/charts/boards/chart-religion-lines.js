// chart-religion-lines.js
//
// Plain-SVG multi-line time-series for religion: one polyline per religion over
// the sampled chart-turns, colored by the religion's own (readability-raised)
// color. Reads the per-turn `rel` map persisted on each sample (settlements `s`,
// population `p`). Text stays in ink; colors carry identity. Defensive.

import { t } from "/demographics/ui/core/demographics-i18n.js";
import * as U from "/demographics/ui/screen-demographics/charts/boards/board-ui.js";

const VW = 1000;
const VH = 520;
const PAD_L = 60;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 34;

/**
 * Resolve a religion $hash (string key) to a display name + readable color.
 * @param {string} hashKey The religion hash as a string.
 * @returns {{name:string, color:string}} The meta.
 */
function religionMeta(hashKey) {
  try {
    if (typeof GameInfo !== "undefined" && GameInfo.Religions) {
      for (const r of GameInfo.Religions) {
        if (r && String(r.$hash) === hashKey) {
          const name = r.Name && typeof Locale !== "undefined" ? Locale.compose(r.Name) : hashKey;
          return { name, color: U.readable(r.Color || "#B0B0B0") };
        }
      }
    }
  } catch (_) {
    /* fall through */
  }
  return { name: t("LOC_DEMOGRAPHICS_BOARD_RELIGION_FALLBACK", hashKey), color: "#B0B0B0" };
}

/**
 * Build per-religion point series + domain bounds from the history `rel` maps.
 * @param {*} history The persisted history blob.
 * @param {"s"|"p"} key The follower key (settlements or population).
 * @returns {{series: Map<string, {x:number, y:number}[]>, minX:number, maxX:number, maxY:number}} Data.
 */
function collectSeries(history, key) {
  /** @type {{series: Map<string, {x:number, y:number}[]>, minX:number, maxX:number, maxY:number}} */
  const acc = { series: new Map(), minX: Infinity, maxX: -Infinity, maxY: 0 };
  const samples = history && Array.isArray(history.samples) ? history.samples : [];
  for (const s of samples) foldRelSample(s, key, acc);
  return acc;
}

/**
 * Fold one sample's `rel` map into the series accumulator, in place.
 * @param {*} s One sample.
 * @param {"s"|"p"} key The follower key.
 * @param {{series: Map<string, {x:number, y:number}[]>, minX:number, maxX:number, maxY:number}} acc
 *   The accumulator (mutated).
 */
function foldRelSample(s, key, acc) {
  const rel = s && s.rel;
  const x = s && s.chartTurn;
  if (!rel || typeof x !== "number") return;
  acc.minX = Math.min(acc.minX, x);
  acc.maxX = Math.max(acc.maxX, x);
  for (const hash in rel) {
    const y = rel[hash] && rel[hash][key];
    if (typeof y !== "number") continue;
    acc.maxY = Math.max(acc.maxY, y);
    let pts = acc.series.get(hash);
    if (!pts) {
      pts = [];
      acc.series.set(hash, pts);
    }
    pts.push({ x, y });
  }
}

/**
 * Map a data point to SVG viewport coordinates.
 * @param {number} x Data x (chart turn).
 * @param {number} y Data y (value).
 * @param {{minX:number, maxX:number, maxY:number}} d Domain bounds.
 * @returns {{px:number, py:number}} Viewport coords.
 */
function project(x, y, d) {
  const spanX = d.maxX - d.minX || 1;
  const px = PAD_L + ((x - d.minX) / spanX) * (VW - PAD_L - PAD_R);
  const py = VH - PAD_B - (y / (d.maxY || 1)) * (VH - PAD_T - PAD_B);
  return { px, py };
}

/**
 * Append the axis frame + min/max labels to the SVG.
 * @param {SVGElement} svg The SVG root.
 * @param {{minX:number, maxX:number, maxY:number}} d Domain bounds.
 */
function appendAxes(svg, d) {
  svg.appendChild(U.svgEl("line", { x1: PAD_L, y1: PAD_T, x2: PAD_L, y2: VH - PAD_B, stroke: U.GRID }));
  svg.appendChild(U.svgEl("line", {
    x1: PAD_L, y1: VH - PAD_B, x2: VW - PAD_R, y2: VH - PAD_B, stroke: U.GRID
  }));
  svg.appendChild(U.svgText(PAD_L - 6, PAD_T + 10, String(Math.round(d.maxY)), { anchor: "end" }));
  svg.appendChild(U.svgText(PAD_L, VH - 8, t("LOC_DEMOGRAPHICS_WONDER_TURN", d.minX)));
  svg.appendChild(U.svgText(VW - PAD_R, VH - 8, t("LOC_DEMOGRAPHICS_WONDER_TURN", d.maxX), { anchor: "end" }));
}

/**
 * Append one religion's polyline; return its legend meta.
 * @param {SVGElement} svg The SVG root.
 * @param {{hash:string, pts:{x:number, y:number}[]}} s The series.
 * @param {{minX:number, maxX:number, maxY:number}} d Domain bounds.
 * @returns {{name:string, color:string}} Legend meta for the series.
 */
function appendSeries(svg, s, d) {
  const meta = religionMeta(s.hash);
  const points = s.pts
    .sort((a, b) => a.x - b.x)
    .map((pt) => {
      const { px, py } = project(pt.x, pt.y, d);
      return px.toFixed(1) + "," + py.toFixed(1);
    })
    .join(" ");
  const line = U.svgEl("polyline", {
    points, fill: "none", stroke: meta.color, "stroke-width": 2.5, "stroke-linejoin": "round"
  });
  line.setAttribute("data-tooltip-content", meta.name);
  svg.appendChild(line);
  return meta;
}

/**
 * Render a religion time-series line chart into `host`.
 * @param {HTMLElement} host The chart host.
 * @param {*} history The persisted history blob.
 * @param {"s"|"p"} key The follower key.
 */
function renderReligionLines(host, history, key) {
  host.innerHTML = "";
  const d = collectSeries(history, key);
  if (!d.series.size || d.maxX < d.minX) return U.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_RELIGION"));
  const svg = U.svgRoot(host, VW, VH);
  appendAxes(svg, d);
  const meta = [];
  for (const [hash, pts] of d.series) meta.push(appendSeries(svg, { hash, pts }, d));
  host.appendChild(U.legend(meta));
}

/**
 * Render Religion Spread (settlements following) over time.
 * @param {HTMLElement} host The chart host.
 * @param {{history:*}} opts Render options.
 */
export function renderReligionSpread(host, opts) {
  renderReligionLines(host, opts && opts.history, "s");
}

/**
 * Render Religion by Population (population following) over time.
 * @param {HTMLElement} host The chart host.
 * @param {{history:*}} opts Render options.
 */
export function renderReligionByPop(host, opts) {
  renderReligionLines(host, opts && opts.history, "p");
}
