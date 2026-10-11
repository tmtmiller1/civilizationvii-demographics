// chart-war-series.js
//
// Pure data/series helpers shared by war mini charts.

/**
 * Compact magnitude format (e.g. 12.3K, 1.2M) for axis labels.
 * @param {number} n
 * @returns {string}
 */
export function formatCompact(n) {
  const magnitude = Math.abs(n);
  if (magnitude >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (magnitude >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

/**
 * @param {*} value
 * @returns {number | null} `value` when it is a finite number, else null.
 */
export function finiteOrNull(value) {
  return typeof value === "number" && isFinite(value) ? value : null;
}

/**
 * Read one metric value at a sample for a pid, from either the `players` map
 * (majors) or the `minors` map (city-states).
 * @param {*} sample
 * @param {number} pid
 * @param {string} metricId
 * @param {boolean} fromMinors Read from `minors` instead of `players`.
 * @returns {number | null} The finite value, or null when missing.
 */
export function metricAt(sample, pid, metricId, fromMinors) {
  const bag = fromMinors ? sample?.minors : sample?.players;
  return finiteOrNull(bag?.[pid]?.metrics?.[metricId]);
}

/**
 * Build one participant's point series for a metric over the window.
 * @param {{ pid: number, name: string, color: string }} participant
 * @param {Snapshot[]} win
 * @param {string} metricId The snapshot.metrics key.
 * @param {boolean} [fromMinors] Read from the `minors` bag (city-states).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }}
 */
export function buildSeries(participant, win, metricId, fromMinors) {
  const points = [];
  for (const sample of win) {
    const y = metricAt(sample, participant.pid, metricId, !!fromMinors);
    if (y !== null && typeof sample.turn === "number") points.push({ x: sample.turn, y });
  }
  return { name: participant.name, color: participant.color, points };
}

/**
 * Build one participant's cumulative-loss series for a level metric, plotted
 * negative: the running sum of every per-turn decline, negated. Rises are
 * ignored (growth never offsets a loss), matching the tooltip's "lost".
 * @param {{ pid: number, name: string, color: string }} participant
 * @param {Snapshot[]} win
 * @param {string} metricId The level snapshot.metrics key.
 * @param {boolean} [fromMinors] Read from the `minors` bag (city-states).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }}
 */
export function lossSeriesDeclines(participant, win, metricId, fromMinors) {
  const points = [];
  let prev = null;
  let cumulative = 0;
  for (const sample of win) {
    const value = metricAt(sample, participant.pid, metricId, !!fromMinors);
    if (value === null || typeof sample.turn !== "number") continue;
    if (prev !== null && value < prev) cumulative += prev - value;
    prev = value;
    points.push({ x: sample.turn, y: -cumulative });
  }
  return { name: participant.name, color: participant.color, points };
}

/**
 * Build one participant's cumulative-loss series from a monotonic loss counter
 * (e.g. milLostCum), plotted negative as the increase since the window start.
 * Falls back to {@link lossSeriesDeclines} on `fallbackId` when the counter has
 * no in-window data (a war predating the counter).
 * @param {{ pid: number, name: string, color: string }} participant
 * @param {Snapshot[]} win
 * @param {string} counterId The cumulative loss-counter key.
 * @param {string} fallbackId The level metric to derive declines from instead.
 * @param {boolean} [fromMinors] Read from the `minors` bag (city-states).
 * @returns {{ name: string, color: string, points: { x: number, y: number }[] }}
 */
export function lossSeriesCounter(participant, win, counterId, fallbackId, fromMinors) {
  const raw = [];
  for (const sample of win) {
    const value = metricAt(sample, participant.pid, counterId, !!fromMinors);
    if (value !== null && typeof sample.turn === "number") raw.push({ x: sample.turn, y: value });
  }
  if (raw.length < 2) return lossSeriesDeclines(participant, win, fallbackId, fromMinors);
  const base = raw[0].y;
  return {
    name: participant.name,
    color: participant.color,
    points: raw.map((pt) => ({ x: pt.x, y: -(pt.y - base) }))
  };
}

/**
 * Bounds across a set of series (x = turn, y = value).
 * @param {{ points: { x: number, y: number }[] }[]} seriesList
 * @returns {{ xMin: number, xMax: number, yMin: number,
 *   yMax: number } | null} Bounds, or null when empty.
 */
export function seriesBounds(seriesList) {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const series of seriesList) {
    for (const pt of series.points) {
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
 * @param {{ points: { x: number }[] }[]} series
 * @returns {number[]}
 */
export function collectTurns(series) {
  const set = new Set();
  for (const entry of series) for (const pt of entry.points) set.add(pt.x);
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * The turn in `turns` closest to `target`.
 * @param {number[]} turns Sorted.
 * @param {number} target
 * @returns {number}
 */
export function nearestTurn(turns, target) {
  let best = turns[0];
  let bestDist = Math.abs(best - target);
  for (const turn of turns) {
    const dist = Math.abs(turn - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = turn;
    }
  }
  return best;
}

/**
 * Format a hovered value (signed; 0 stays "0").
 * @param {number} y
 * @returns {string}
 */
export function tipVal(y) {
  if (y === 0) return "0";
  return (y < 0 ? "−" : "") + formatCompact(Math.abs(y));
}

/**
 * One participant's net change in a cumulative metric over the window
 * (last − first). Returns null when the metric isn't present in the window
 * (e.g. a war predating the counter); a single in-window point reads as 0.
 * @param {{ pid: number }} participant
 * @param {Snapshot[]} win
 * @param {string} metricId The cumulative snapshot.metrics key.
 * @returns {number | null} The net change, or null when no data.
 */
export function windowNet(participant, win, metricId) {
  const series = [];
  for (const sample of win) {
    const value = finiteOrNull(sample?.players?.[participant.pid]?.metrics?.[metricId]);
    if (value !== null) series.push(value);
  }
  if (!series.length) return null;
  return series[series.length - 1] - series[0];
}
