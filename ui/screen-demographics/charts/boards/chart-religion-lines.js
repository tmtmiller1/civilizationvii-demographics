// chart-religion-lines.js
//
// Plain-SVG multi-line time-series for religion: one polyline per religion, colored by the
// religion's own (readability-raised) color, from the per-turn `rel` map persisted on each sample
// (settlements `s`, population `p`).

import { t } from "/demographics/ui/core/demographics-i18n.js";
import * as board from "/demographics/ui/screen-demographics/charts/boards/board-ui.js";

const VW = 1000;
const VH = 520;
const PAD_L = 60;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 34;

/** @param {string} hashKey */
function religionMeta(hashKey) {
  try {
    if (typeof GameInfo !== "undefined" && GameInfo.Religions) {
      for (const religion of GameInfo.Religions) {
        if (religion && String(religion.$hash) === hashKey) {
          const name = religion.Name && typeof Locale !== "undefined" ? Locale.compose(religion.Name) : hashKey;
          return { name, color: board.readable(religion.Color || board.FALLBACK_COLOR) };
        }
      }
    }
  } catch (_) {
    /* fall through */
  }
  return { name: t("LOC_DEMOGRAPHICS_BOARD_RELIGION_FALLBACK", hashKey), color: board.FALLBACK_COLOR };
}

/**
 * @param {*} history
 * @param {"s"|"p"} key The follower key (settlements or population).
 */
function collectSeries(history, key) {
  /** @type {{series: Map<string, {x:number, y:number}[]>, minX:number, maxX:number, maxY:number}} */
  const acc = { series: new Map(), minX: Infinity, maxX: -Infinity, maxY: 0 };
  const samples = history && Array.isArray(history.samples) ? history.samples : [];
  for (const sample of samples) foldRelSample(sample, key, acc);
  return acc;
}

/**
 * @param {*} sample
 * @param {"s"|"p"} key
 * @param {{series: Map<string, {x:number, y:number}[]>, minX:number, maxX:number, maxY:number}} acc
 */
function foldRelSample(sample, key, acc) {
  const followers = sample && sample.rel;
  const x = sample && sample.chartTurn;
  if (!followers || typeof x !== "number") return;
  acc.minX = Math.min(acc.minX, x);
  acc.maxX = Math.max(acc.maxX, x);
  for (const hash in followers) {
    const y = followers[hash] && followers[hash][key];
    if (typeof y !== "number") continue;
    acc.maxY = Math.max(acc.maxY, y);
    let points = acc.series.get(hash);
    if (!points) {
      points = [];
      acc.series.set(hash, points);
    }
    points.push({ x, y });
  }
}

/**
 * @param {number} x Data x (chart turn).
 * @param {number} y
 * @param {{minX:number, maxX:number, maxY:number}} domain
 */
function project(x, y, domain) {
  const spanX = domain.maxX - domain.minX || 1;
  const px = PAD_L + ((x - domain.minX) / spanX) * (VW - PAD_L - PAD_R);
  const py = VH - PAD_B - (y / (domain.maxY || 1)) * (VH - PAD_T - PAD_B);
  return { px, py };
}

/**
 * @param {SVGElement} svg
 * @param {{minX:number, maxX:number, maxY:number}} domain
 */
function appendAxes(svg, domain) {
  svg.appendChild(board.svgEl("line", { x1: PAD_L, y1: PAD_T, x2: PAD_L, y2: VH - PAD_B, stroke: board.GRID }));
  svg.appendChild(board.svgEl("line", {
    x1: PAD_L, y1: VH - PAD_B, x2: VW - PAD_R, y2: VH - PAD_B, stroke: board.GRID
  }));
  svg.appendChild(board.svgText(PAD_L - 6, PAD_T + 10, String(Math.round(domain.maxY)), { anchor: "end" }));
  svg.appendChild(board.svgText(PAD_L, VH - 8, t("LOC_DEMOGRAPHICS_WONDER_TURN", domain.minX)));
  svg.appendChild(board.svgText(VW - PAD_R, VH - 8, t("LOC_DEMOGRAPHICS_WONDER_TURN", domain.maxX), {
    anchor: "end"
  }));
}

/**
 * @param {SVGElement} svg
 * @param {{hash:string, pts:{x:number, y:number}[]}} entry
 * @param {{minX:number, maxX:number, maxY:number}} domain
 */
function appendSeries(svg, entry, domain) {
  const meta = religionMeta(entry.hash);
  const points = entry.pts
    .sort((a, b) => a.x - b.x)
    .map((pt) => {
      const { px, py } = project(pt.x, pt.y, domain);
      return px.toFixed(1) + "," + py.toFixed(1);
    })
    .join(" ");
  const line = board.svgEl("polyline", {
    points,
    fill: "none",
    stroke: meta.color,
    "stroke-width": 2.5,
    "stroke-linejoin": "round"
  });
  line.setAttribute("data-tooltip-content", meta.name);
  svg.appendChild(line);
  return meta;
}

/**
 * @param {HTMLElement} host
 * @param {*} history
 * @param {"s"|"p"} key
 */
function renderReligionLines(host, history, key) {
  host.innerHTML = "";
  const domain = collectSeries(history, key);
  if (!domain.series.size || domain.maxX < domain.minX) {
    return board.emptyState(host, t("LOC_DEMOGRAPHICS_BOARD_NO_RELIGION"));
  }
  const svg = board.svgRoot(host, VW, VH);
  appendAxes(svg, domain);
  const meta = [];
  for (const [hash, points] of domain.series) meta.push(appendSeries(svg, { hash, pts: points }, domain));
  host.appendChild(board.legend(meta));
}

/**
 * Render Religion Spread (settlements following) over time.
 * @param {HTMLElement} host
 * @param {{history:*}} opts
 */
export function renderReligionSpread(host, opts) {
  renderReligionLines(host, opts && opts.history, "s");
}

/**
 * Render Religion by Population (population following) over time.
 * @param {HTMLElement} host
 * @param {{history:*}} opts
 */
export function renderReligionByPop(host, opts) {
  renderReligionLines(host, opts && opts.history, "p");
}
