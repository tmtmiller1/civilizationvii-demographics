// chart-war-series.js
//
// Pure data/series helpers shared by war mini charts.

/**
 * Compact magnitude format (e.g. 12.3K, 1.2M) for axis labels.
 * @param {number} n The value.
 * @returns {string} The formatted value.
 */
export function fmt(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

/**
 * Coerce to a finite number or null.
 * @param {*} v The value.
 * @returns {number | null} The finite number, or null.
 */
export function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

/**
 * Read one metric value at a sample for a pid, from either the `players` map
 * (majors) or the `minors` map (city-states).
 * @param {*} s The snapshot.
 * @param {number} pid The participant pid.
 * @param {string} metricId The metric key.
 * @param {boolean} fromMinors Read from `minors` instead of `players`.
 * @returns {number | null} The finite value, or null.
 */
export function metricAt(s, pid, metricId, fromMinors) {
  const bag = fromMinors ? s?.minors : s?.players;
  return num(bag?.[pid]?.metrics?.[metricId]);
}

/**
 * Build one participant's point series for a metric over the window.
 * @param {{ pid: number, name: string, color: string }} p The participant.
 * @param {Snapshot[]} win The windowed samples.
 * @param {string} metricId The snapshot.metrics key.
 * @param {boolean} [fromMinors] Read from the `minors` bag (city-states).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }} Series.
 */
export function buildSeries(p, win, metricId, fromMinors) {
  const points = [];
  for (const s of win) {
    const y = metricAt(s, p.pid, metricId, !!fromMinors);
    if (y !== null && typeof s.turn === "number") points.push({ x: s.turn, y });
  }
  return { name: p.name, color: p.color, points };
}

/**
 * Build one participant's cumulative-LOSS series for a level metric, plotted
 * NEGATIVE: each point is the running sum of every per-turn decline so far,
 * negated, so the line starts at 0 and descends as the civ loses ground. Rises
 * are ignored (growth never offsets a loss), matching the tooltip's "lost".
 * @param {{ pid: number, name: string, color: string }} p The participant.
 * @param {Snapshot[]} win The windowed samples.
 * @param {string} metricId The level snapshot.metrics key.
 * @param {boolean} [fromMinors] Read from the `minors` bag (city-states).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }} Loss series.
 */
export function lossSeriesDeclines(p, win, metricId, fromMinors) {
  const points = [];
  let prev = null;
  let cum = 0;
  for (const s of win) {
    const v = metricAt(s, p.pid, metricId, !!fromMinors);
    if (v === null || typeof s.turn !== "number") continue;
    if (prev !== null && v < prev) cum += prev - v;
    prev = v;
    points.push({ x: s.turn, y: -cum });
  }
  return { name: p.name, color: p.color, points };
}

/**
 * Build one participant's cumulative-loss series from a monotonic loss counter
 * (e.g. milLostCum), plotted negative as the increase since the window start.
 * Falls back to {@link lossSeriesDeclines} on `fallbackId` when the counter has
 * no in-window data (a war predating the counter).
 * @param {{ pid: number, name: string, color: string }} p The participant.
 * @param {Snapshot[]} win The windowed samples.
 * @param {string} counterId The cumulative loss-counter key.
 * @param {string} fallbackId The level metric to derive declines from instead.
 * @param {boolean} [fromMinors] Read from the `minors` bag (city-states).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }} Loss series.
 */
export function lossSeriesCounter(p, win, counterId, fallbackId, fromMinors) {
  const raw = [];
  for (const s of win) {
    const v = metricAt(s, p.pid, counterId, !!fromMinors);
    if (v !== null && typeof s.turn === "number") raw.push({ x: s.turn, y: v });
  }
  if (raw.length < 2) return lossSeriesDeclines(p, win, fallbackId, fromMinors);
  const base = raw[0].y;
  return {
    name: p.name,
    color: p.color,
    points: raw.map((pt) => ({ x: pt.x, y: -(pt.y - base) }))
  };
}

/**
 * Bounds across a set of series (x = turn, y = value).
 * @param {{ points: { x: number, y: number }[] }[]} seriesList The series.
 * @returns {{ xMin: number, xMax: number, yMin: number,
 *   yMax: number } | null} Bounds, or null when empty.
 */
export function seriesBounds(seriesList) {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const s of seriesList) {
    for (const pt of s.points) {
      if (pt.x < xMin) xMin = pt.x;
      if (pt.x > xMax) xMax = pt.x;
      if (pt.y < yMin) yMin = pt.y;
      if (pt.y > yMax) yMax = pt.y;
    }
  }
  return isFinite(xMin) ? { xMin, xMax, yMin, yMax } : null;
}

/**
 * Distinct, sorted turns present across a series list.
 * @param {{ points: { x: number }[] }[]} series The series.
 * @returns {number[]} Sorted distinct turns.
 */
export function collectTurns(series) {
  const set = new Set();
  for (const s of series) for (const pt of s.points) set.add(pt.x);
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * The turn in `turns` closest to `t`.
 * @param {number[]} turns Sorted turns.
 * @param {number} t The target turn.
 * @returns {number} The nearest turn.
 */
export function nearestTurn(turns, t) {
  let best = turns[0];
  let bd = Math.abs(best - t);
  for (const tn of turns) {
    const d = Math.abs(tn - t);
    if (d < bd) {
      bd = d;
      best = tn;
    }
  }
  return best;
}

/**
 * Format a hovered value (signed; 0 stays "0").
 * @param {number} y The value.
 * @returns {string} The formatted value.
 */
export function tipVal(y) {
  if (y === 0) return "0";
  return (y < 0 ? "−" : "") + fmt(Math.abs(y));
}

/**
 * One participant's net change in a cumulative metric over the window
 * (last − first). Returns null when the metric isn't present in the window
 * (e.g. a war predating the counter); a single in-window point reads as 0.
 * @param {{ pid: number }} p The participant.
 * @param {Snapshot[]} win The windowed samples.
 * @param {string} metricId The cumulative snapshot.metrics key.
 * @returns {number | null} The net change, or null when no data.
 */
export function windowNet(p, win, metricId) {
  const series = [];
  for (const s of win) {
    const v = num(s?.players?.[p.pid]?.metrics?.[metricId]);
    if (v !== null) series.push(v);
  }
  if (!series.length) return null;
  return series[series.length - 1] - series[0];
}
