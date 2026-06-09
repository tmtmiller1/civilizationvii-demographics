// chart-crisis-stages.js
//
// The Crises page: the current age's crisis broken into its stages
// (Begins / Intensifies / Culminates / Ends), one colored bar per stage (the
// same severity colors the historical line charts use for crisis markers), and
// directly beneath each stage a PERMANENT cost section - the exact war-tooltip
// table - listing every civ's losses accrued during that stage. War-only
// columns ("Directed to War", "Settlements Razed") are omitted; crises have no
// sides, so it's one column per civ with no "vs".

import {
  historySamples,
  appendEmptyNotice,
  getXAxisMode
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { COST_METRICS, participantCost } from "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-cost.js";
import { buildCostTable } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-cost-table.js";
import { flavorCrisisName, getGameSeed } from "/demographics/ui/screen-demographics/charts/crises/crisis-names.js";
import {
  CRISIS_STAGE_COLORS as STAGE_COLORS,
  CRISIS_STAGE_LABELS as STAGE_LABELS,
  crisisStageOnsets,
  crisisStageSegments
} from "/demographics/ui/screen-demographics/charts/crises/crisis-stage-data.js";
import { t } from "/demographics/ui/core/demographics-i18n.js";

// Cost metrics shown per stage: every war-cost figure EXCEPT production directed
// to war and settlements razed (both war-specific).
const CRISIS_METRICS = COST_METRICS.filter(
  (m) => m.id !== "warProdCum" && m.id !== "razedCum"
);

/**
 * Every major civ present in the samples within [start, end] (one cost column
 * each), in first-seen order. Iterating `s.players` yields majors only - the
 * sampler stores city-states / independents in a separate `s.minors` map (see
 * sampleMinors in demographics-sampler.js), so no isCS filter is needed here.
 * @param {Snapshot[]} samples The sample stream.
 * @param {number} start The window start turn.
 * @param {number} end The window end turn.
 * @returns {{ pid: number }[]} The participant column entries.
 */
function crisisParticipants(samples, start, end) {
  const seen = new Set();
  const out = [];
  for (const s of samples) {
    if (typeof s?.turn !== "number" || s.turn < start || s.turn > end) continue;
    for (const pid in s.players || {}) {
      const n = Number(pid);
      if (!seen.has(n)) {
        seen.add(n);
        out.push({ pid: n });
      }
    }
  }
  return out;
}

/**
 * Build a turn -> game-year lookup from the samples (for the year/both span modes).
 * @param {Snapshot[]} samples The sample stream.
 * @returns {Map<number, string>} Turn -> game-year string.
 */
function buildYearMap(samples) {
  /** @type {Map<number, string>} */
  const map = new Map();
  for (const s of samples) {
    if (s && typeof s.turn === "number" && typeof s.gameYear === "string") map.set(s.turn, s.gameYear);
  }
  return map;
}

/**
 * Format a stage's turn span per the shared X-axis time-unit mode: turns
 * ("T98 – T112"), game years ("100 BCE – 60 BCE"), or both. Falls back to turns
 * when no year data is available.
 * @param {number} start The stage's first turn.
 * @param {number} end The stage's last turn.
 * @param {Map<number, string>} yearMap Turn -> game-year string.
 * @param {string} mode The time-unit mode ("turn" / "year" / "both").
 * @returns {string} The formatted span.
 */
function formatStageSpan(start, end, yearMap, mode) {
  const turns = "T" + start + " – T" + end;
  if (mode === "turn") return turns;
  const ys = yearMap.get(start);
  const ye = yearMap.get(end);
  const years = ys && ye ? ys + " – " + ye : null;
  if (!years) return turns;
  if (mode === "year") return years;
  return turns + " · " + years;
}

/**
 * Build one stage's colored header bar (crisis name + stage label + time span).
 * The bar's background fades from black (behind the name, so it stays readable)
 * into the stage's severity color (the same orange/red shades used elsewhere).
 * @param {{ stage: number, start: number, end: number, sample: Snapshot }} seg The segment.
 * @param {number} idx The clamped stage index (0..3).
 * @param {string} seed The game seed (for the flavor crisis name).
 * @param {string} spanText The pre-formatted time span.
 * @returns {HTMLElement} The bar element.
 */
function buildStageBar(seg, idx, seed, spanText) {
  const bar = document.createElement("div");
  bar.className = "demographics-crisis-stage-bar";
  bar.style.borderLeftColor = STAGE_COLORS[idx];
  bar.style.background = "linear-gradient(to right, #000 0%, #000 22%, " + STAGE_COLORS[idx] + " 60%)";
  const label = document.createElement("span");
  label.className = "demographics-crisis-stage-label";
  label.textContent = t(STAGE_LABELS[idx]);
  bar.appendChild(label);
  const name = document.createElement("span");
  name.className = "demographics-crisis-stage-name";
  name.textContent = flavorCrisisName(seg.sample, seg.stage, seed);
  bar.appendChild(name);
  const span = document.createElement("span");
  span.className = "demographics-crisis-stage-span";
  span.textContent = spanText;
  bar.appendChild(span);
  return bar;
}

/**
 * Build a per-civ cost-table section over [start, end].
 * @param {Snapshot[]} samples The sample stream.
 * @param {number} start Window start turn.
 * @param {number} end Window end turn.
 * @returns {HTMLElement} The cost section.
 */
function buildCostSection(samples, start, end) {
  const cols = crisisParticipants(samples, start, end).map((p) => ({
    entry: p,
    cs: null,
    cost: participantCost(samples, p, start, end)
  }));
  const costs = document.createElement("div");
  costs.className = "demographics-crisis-stage-costs";
  costs.appendChild(buildCostTable(cols, CRISIS_METRICS, samples, -1));
  return costs;
}

/**
 * Build one stage block: the colored bar plus that stage's own per-civ cost table.
 * @param {{ stage: number, start: number, end: number, sample: Snapshot }} seg The segment.
 * @param {{ samples: Snapshot[], seed: string, yearMap: Map<number,string>,
 *   mode: string }} ctx Render context.
 * @returns {HTMLElement} The stage block.
 */
function buildStageBlock(seg, ctx) {
  const idx = Math.max(0, Math.min(3, seg.stage - 1));
  const block = document.createElement("div");
  block.className = "demographics-crisis-stage";
  block.appendChild(
    buildStageBar(seg, idx, ctx.seed, formatStageSpan(seg.start, seg.end, ctx.yearMap, ctx.mode))
  );
  block.appendChild(buildCostSection(ctx.samples, seg.start, seg.end));
  return block;
}

/**
 * Build the crisis-wide cumulative-impact block: a caption plus a cost table
 * spanning the entire crisis ([group.start, group.end] — every stage summed).
 * Rendered once per crisis beneath its stage blocks, INDEPENDENT of whether an
 * "Ends" (stage 4) sample was ever captured — the engine often resolves a crisis
 * straight from "Culminates" without a stage-4 reading, so gating on stage 4
 * silently dropped the cumulative table.
 * @param {{ start: number, end: number }} group The crisis run.
 * @param {{ samples: Snapshot[] }} ctx Render context.
 * @returns {HTMLElement} The cumulative block.
 */
function buildCumulativeBlock(group, ctx) {
  const block = document.createElement("div");
  block.className = "demographics-crisis-stage demographics-crisis-cumulative";
  const cap = document.createElement("div");
  cap.className = "demographics-crisis-cumulative-caption";
  cap.textContent = t("LOC_DEMOGRAPHICS_CRISIS_CUMULATIVE");
  block.appendChild(cap);
  block.appendChild(buildCostSection(ctx.samples, group.start, group.end));
  return block;
}

/**
 * Split the flat stage segments into per-crisis runs. A new crisis begins at each
 * stage-1 onset (crisis_stage resets to 0 between ages, so the next age's crisis
 * starts a fresh run) - which lets the page separate each age's crisis.
 * @param {{ stage:number, start:number, end:number, sample:Snapshot }[]} segments The segments.
 * @returns {{ segments:any[], start:number, end:number, sample:Snapshot }[]} The crisis groups.
 */
function groupCrises(segments) {
  /** @type {{ segments:any[], start:number, end:number, sample:Snapshot, age:* }[]} */
  const groups = [];
  /** @type {{ segments:any[], start:number, end:number, sample:Snapshot, age:* }|null} */
  let cur = null;
  for (const seg of segments) {
    const age = seg.sample && seg.sample.age;
    // Start a fresh crisis run at each stage-1 onset OR whenever the age changes —
    // each age has its own crisis, so the Antiquity and Exploration crises always
    // get their own group (and thus their own cumulative-impact table), even if a
    // crisis's stage 1 wasn't captured.
    if (!cur || seg.stage === 1 || age !== cur.age) {
      cur = { segments: [], start: seg.start, end: seg.end, sample: seg.sample, age };
      groups.push(cur);
    }
    cur.segments.push(seg);
    cur.end = seg.end;
  }
  return groups;
}

/**
 * Build one crisis group: a title header (the crisis's flavor name, which differs
 * per age), its per-stage blocks, then a cumulative-impact block summing the whole
 * crisis (shown whenever the crisis has more than one stage).
 * @param {{ segments:any[], start:number, end:number, sample:Snapshot }} group The crisis run.
 * @param {{ samples: Snapshot[], seed: string, yearMap: Map<number,string>,
 *   mode: string }} ctx Render context.
 * @returns {HTMLElement} The crisis-group element.
 */
function buildCrisisGroup(group, ctx) {
  const wrap = document.createElement("div");
  wrap.className = "demographics-crisis-group";
  const header = document.createElement("div");
  header.className = "demographics-crisis-group-header";
  header.textContent = flavorCrisisName(group.sample, group.segments[0].stage, ctx.seed);
  wrap.appendChild(header);
  for (const seg of group.segments) wrap.appendChild(buildStageBlock(seg, ctx));
  if (group.segments.length >= 2) wrap.appendChild(buildCumulativeBlock(group, ctx));
  return wrap;
}

/**
 * Render the Crises page: each age's crisis as its own titled group (separated
 * visually), with one block per stage and a cumulative table on the final stage.
 * @param {HTMLElement} host The chart host (cleared and repopulated).
 * @param {{ history?: * }} [opts] Render options.
 * @returns {null} Always null (no chart handle).
 */
export function renderCrisisStages(host, opts) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const history = (opts && opts.history) || {};
  const samples = historySamples(history);
  const latestTurn = samples.length ? samples[samples.length - 1].turn ?? 0 : 0;
  const onsets = crisisStageOnsets(samples);
  if (!onsets.length) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_CRISIS_EMPTY_NONE"));
    return null;
  }
  const ctx = {
    samples,
    seed: getGameSeed(),
    yearMap: buildYearMap(samples),
    mode: getXAxisMode()
  };
  const groups = groupCrises(crisisStageSegments(onsets, latestTurn));
  const panel = document.createElement("div");
  panel.className = "demographics-crisis-stages";
  for (const group of groups) panel.appendChild(buildCrisisGroup(group, ctx));
  host.appendChild(panel);
  return null;
}
