// chart-crisis-stages.js
//
// The Crises page: the current age's crisis broken into its stages (Begins /
// Intensifies / Culminates / Ends), one colored bar per stage, and beneath each
// stage a cost section (the war-tooltip table, minus the war-only columns)
// listing every civ's losses accrued during that stage.

import {
  historySamples,
  appendEmptyNotice,
  getXAxisMode,
  civDroppedByPolicy
} from "/demographics/ui/screen-demographics/charts/shared/chart-shared.js";
import { participantCost } from "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-cost.js";
import { buildCostTable } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-cost-table.js";
import { flavorCrisisName } from "/demographics/ui/screen-demographics/charts/crises/crisis-names.js";
import { getGameSeed } from "/demographics/ui/screen-demographics/screen/guarded-reads.js";
import {
  CRISIS_STAGE_COLORS as STAGE_COLORS,
  CRISIS_STAGE_LABELS as STAGE_LABELS,
  ageLastTurns,
  crisisStageOnsets,
  crisisStageSegments,
  sampleAgeKey
} from "/demographics/ui/screen-demographics/charts/crises/crisis-stage-data.js";
import {
  CRISIS_METRICS,
  crisisParticipants,
  groupCrises,
  buildAgeCrisisCols,
  toTableCols,
  mergeAgeCols
} from "/demographics/ui/screen-demographics/charts/crises/crisis-cost-model.js";
import { localYear, t, turnPlain } from "/demographics/ui/core/demographics-i18n.js";

/** @param {Snapshot[]} samples */
function buildYearMap(samples) {
  /** @type {Map<number, string>} */
  const map = new Map();
  for (const sample of samples) {
    if (sample && typeof sample.turn === "number" && typeof sample.gameYear === "string") {
      map.set(sample.turn, sample.gameYear);
    }
  }
  return map;
}

/**
 * Format a stage's turn span per the shared X-axis time-unit mode: turns
 * ("T98 – T112"), game years ("100 BCE – 60 BCE"), or both.
 * @param {number} start The stage's first turn.
 * @param {number} end The stage's last turn.
 * @param {Map<number, string>} yearMap Turn -> game-year string.
 * @param {string} mode The time-unit mode ("turn" / "year" / "both").
 */
function formatStageSpan(start, end, yearMap, mode) {
  const turns = turnPlain(start) + " – " + turnPlain(end);
  if (mode === "turn") return turns;
  const startYear = localYear(yearMap.get(start));
  const endYear = localYear(yearMap.get(end));
  const years = startYear && endYear ? startYear + " – " + endYear : null;
  if (!years) return turns;
  if (mode === "year") return years;
  return turns + " · " + years;
}

/**
 * Build one stage's colored header bar (crisis name + stage label + time span).
 * The bar's background fades from black (behind the name, so it stays readable)
 * into the stage's severity color (the same orange/red shades used elsewhere).
 * @param {{ stage: number, start: number, end: number, sample: Snapshot }} segment
 * @param {number} idx The clamped stage index (0..3).
 * @param {string} seed The game seed (for the flavor crisis name).
 * @param {string} spanText The pre-formatted time span.
 * @returns {HTMLElement}
 */
function buildStageBar(segment, idx, seed, spanText) {
  const bar = document.createElement("div");
  bar.className = "demographics-crisis-stage-bar";
  bar.style.borderLeftColor = STAGE_COLORS[idx];
  bar.style.background =
    "linear-gradient(to right, #000 0%, #000 22%, " + STAGE_COLORS[idx] + " 60%)";
  const label = document.createElement("span");
  label.className = "demographics-crisis-stage-label";
  label.textContent = t(STAGE_LABELS[idx]);
  bar.appendChild(label);
  const name = document.createElement("span");
  name.className = "demographics-crisis-stage-name";
  name.textContent = flavorCrisisName(segment.sample, segment.stage, seed);
  bar.appendChild(name);
  const span = document.createElement("span");
  span.className = "demographics-crisis-stage-span";
  span.textContent = spanText;
  bar.appendChild(span);
  return bar;
}

/**
 * @param {Snapshot[]} samples
 * @param {number} start
 * @param {number} end
 */
function liveCrisisCols(samples, start, end) {
  return crisisParticipants(samples, start, end).map((participant) => ({
    entry: participant,
    cs: null,
    cost: participantCost(samples, participant, start, end)
  }));
}

/**
 * Wrap pre-built cost columns in a cost-table section element. Every column path (live, age-end
 * snapshot, cross-age overall) passes through here, so this is where the spoiler guard drops the
 * columns of civs the policy hides.
 * @param {*[]} cols
 * @param {Snapshot[]} samples The sample stream (portrait identity fallback).
 * @returns {HTMLElement}
 */
function costSection(cols, samples) {
  const costs = document.createElement("div");
  costs.className = "demographics-crisis-stage-costs";
  const shown = cols.filter(
    (column) => !civDroppedByPolicy(samples, column && column.entry ? column.entry.pid : undefined)
  );
  costs.appendChild(buildCostTable(shown, CRISIS_METRICS, samples, -1));
  return costs;
}

/**
 * @param {Snapshot[]} samples
 * @param {number} start
 * @param {number} end
 */
function buildCostSection(samples, start, end) {
  return costSection(liveCrisisCols(samples, start, end), samples);
}

/**
 * The cumulative cost columns for a crisis group, preferring the age-end snapshot (persisted while
 * the finished age's samples were still dense) over recomputing from now-decimated samples, which
 * would blank out the loss columns when viewed from a later age.
 * @param {{ start:number, end:number, sample:Snapshot }} group The crisis run.
 * @param {{ samples:Snapshot[], crisisSnapshots?:Record<string, *[]> }} ctx
 * @returns {*[]}
 */
function cumulativeCols(group, ctx) {
  const snap = ctx.crisisSnapshots && ctx.crisisSnapshots[sampleAgeKey(group.sample)];
  if (Array.isArray(snap)) return toTableCols(snap);
  return liveCrisisCols(ctx.samples, group.start, group.end);
}

/**
 * @param {{ stage: number, start: number, end: number, sample: Snapshot }} segment
 * @param {{ samples: Snapshot[], seed: string, yearMap: Map<number,string>,
 *   mode: string }} ctx
 */
function buildStageBlock(segment, ctx) {
  const idx = Math.max(0, Math.min(3, segment.stage - 1));
  const block = document.createElement("div");
  block.className = "demographics-crisis-stage";
  block.appendChild(
    buildStageBar(
      segment,
      idx,
      ctx.seed,
      formatStageSpan(segment.start, segment.end, ctx.yearMap, ctx.mode)
    )
  );
  block.appendChild(buildCostSection(ctx.samples, segment.start, segment.end));
  return block;
}

/**
 * Build the crisis-wide cumulative-impact block: a caption plus a cost table
 * spanning the entire crisis ([group.start, group.end]). Rendered independent
 * of whether an "Ends" (stage 4) sample was captured, since the engine often
 * resolves a crisis straight from "Culminates".
 * @param {{ start: number, end: number, sample: Snapshot }} group The crisis run.
 * @param {{ samples: Snapshot[], crisisSnapshots?: Record<string, *[]> }} ctx
 * @returns {HTMLElement}
 */
function buildCumulativeBlock(group, ctx) {
  const block = document.createElement("div");
  block.className = "demographics-crisis-stage demographics-crisis-cumulative";
  const caption = document.createElement("div");
  caption.className = "demographics-crisis-cumulative-caption";
  caption.textContent = t("LOC_DEMOGRAPHICS_CRISIS_CUMULATIVE");
  block.appendChild(caption);
  block.appendChild(costSection(cumulativeCols(group, ctx), ctx.samples));
  return block;
}

/**
 * @param {{ segments:any[], start:number, end:number, sample:Snapshot }} group The crisis run.
 * @param {{ samples: Snapshot[], seed: string, yearMap: Map<number,string>,
 *   mode: string }} ctx
 */
function buildCrisisGroup(group, ctx) {
  const wrap = document.createElement("div");
  wrap.className = "demographics-crisis-group";
  const header = document.createElement("div");
  header.className = "demographics-crisis-group-header";
  header.textContent = flavorCrisisName(group.sample, group.segments[0].stage, ctx.seed);
  wrap.appendChild(header);
  for (const segment of group.segments) wrap.appendChild(buildStageBlock(segment, ctx));
  if (group.segments.length >= 2) wrap.appendChild(buildCumulativeBlock(group, ctx));
  return wrap;
}

/**
 * Build a per-group render context whose samples + year map are restricted to
 * the group's age, so a later age's coincident age-local turn numbers can't
 * leak into this crisis's windows.
 * @param {*} ctx Base render context (samples / seed / yearMap / mode).
 * @param {{ sample: Snapshot }} group The crisis group.
 * @returns {*} The same context with samples + yearMap scoped to the group's age.
 */
function groupCtx(ctx, group) {
  const age = sampleAgeKey(group.sample);
  const ageSamples = ctx.samples.filter(
    (/** @type {Snapshot} */ sample) => sampleAgeKey(sample) === age
  );
  return { ...ctx, samples: ageSamples, yearMap: buildYearMap(ageSamples) };
}

/**
 * One age's cumulative crisis cost columns (raw {pid,leaderType,color,cost}), preferring the
 * persisted age-end snapshot over recomputing from now-decimated samples.
 * @param {string} age
 * @param {{ samples:Snapshot[], crisisSnapshots?:Record<string, *[]> }} ctx
 * @returns {*[]}
 */
function ageOverallCols(age, ctx) {
  const snap = ctx.crisisSnapshots && ctx.crisisSnapshots[age];
  // Persisted array: its elements are untrusted (null / scalar); mergeAgeCols drops those.
  if (Array.isArray(snap)) return snap;
  return buildAgeCrisisCols(ctx.samples.filter((s) => sampleAgeKey(s) === age));
}

/**
 * @param {{ sample: Snapshot }[]} groups
 * @param {{ samples:Snapshot[], crisisSnapshots?:Record<string, *[]> }} ctx
 */
function aggregateOverallCols(groups, ctx) {
  const ages = [...new Set(groups.map((g) => sampleAgeKey(g.sample)))];
  return mergeAgeCols(ages.map((age) => ageOverallCols(age, ctx)));
}

/**
 * Build the gated overall cumulative block summing every age's crisis. Only
 * meaningful once crises span more than one age, so the caller renders it solely
 * when a second age's crisis (e.g. Exploration) exists.
 * @param {{ sample: Snapshot }[]} groups The crisis groups.
 * @param {{ samples: Snapshot[] }} ctx Render context (full samples, for identity).
 * @returns {HTMLElement}
 */
function buildOverallBlock(groups, ctx) {
  const block = document.createElement("div");
  block.className =
    "demographics-crisis-stage demographics-crisis-cumulative demographics-crisis-overall";
  const caption = document.createElement("div");
  caption.className = "demographics-crisis-cumulative-caption";
  caption.textContent = t("LOC_DEMOGRAPHICS_CRISIS_OVERALL");
  block.appendChild(caption);
  block.appendChild(costSection(aggregateOverallCols(groups, ctx), ctx.samples));
  return block;
}

/**
 * @param {HTMLElement} panel
 * @param {{ sample: Snapshot, start: number, end: number }[]} groups
 * @param {{ samples: Snapshot[] }} ctx
 */
function appendOverallBlock(panel, groups, ctx) {
  const ages = new Set(groups.map((g) => sampleAgeKey(g.sample)));
  if (ages.size < 2) return;
  panel.appendChild(buildOverallBlock(groups, ctx));
}

/** @param {*} history */
function historyCrisisSnapshots(history) {
  return (history && history.crisisSnapshots) || {};
}

/**
 * Render the Crises page: each age's crisis as its own titled group (separated
 * visually), with one block per stage and a per-age cumulative on the final
 * stage, plus a single overall cumulative once crises span two or more ages.
 * @param {HTMLElement} host The chart host (cleared and repopulated).
 * @param {{ history?: * }} [opts]
 * @returns {null} Always null (no chart handle).
 */
export function renderCrisisStages(host, opts) {
  if (!host) return null;
  while (host.firstChild) host.removeChild(host.firstChild);
  const history = (opts && opts.history) || {};
  const samples = historySamples(history);
  const latestTurn = samples.length ? (samples[samples.length - 1]?.turn ?? 0) : 0;
  const onsets = crisisStageOnsets(samples);
  if (!onsets.length) {
    appendEmptyNotice(host, t("LOC_DEMOGRAPHICS_CRISIS_EMPTY_NONE"));
    return null;
  }
  const ctx = {
    samples,
    seed: getGameSeed(),
    yearMap: buildYearMap(samples),
    mode: getXAxisMode(),
    // Per-age cumulative crisis costs captured at each age boundary (while that age's samples were
    // still dense). The cumulative + overall blocks prefer these for a finished age, so its loss
    // columns survive later sample decimation. Absent for the current (ongoing) age → live compute.
    crisisSnapshots: historyCrisisSnapshots(history)
  };
  const groups = groupCrises(crisisStageSegments(onsets, latestTurn, ageLastTurns(samples)));
  const panel = document.createElement("div");
  panel.className = "demographics-crisis-stages";
  for (const group of groups) panel.appendChild(buildCrisisGroup(group, groupCtx(ctx, group)));
  appendOverallBlock(panel, groups, ctx);
  host.appendChild(panel);
  return null;
}
