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
import { participantCost } from "/demographics/ui/screen-demographics/charts/conflicts/chart-conflicts-cost.js";
import { buildCostTable } from "/demographics/ui/screen-demographics/charts/wars/chart-wars-cost-table.js";
import { flavorCrisisName, getGameSeed } from "/demographics/ui/screen-demographics/charts/crises/crisis-names.js";
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
import { t } from "/demographics/ui/core/demographics-i18n.js";

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
 * Live per-civ cost-table columns over [start, end] (computed from the samples).
 * @param {Snapshot[]} samples The sample stream.
 * @param {number} start Window start turn.
 * @param {number} end Window end turn.
 * @returns {*[]} The table columns.
 */
function liveCrisisCols(samples, start, end) {
  return crisisParticipants(samples, start, end).map((p) => ({
    entry: p,
    cs: null,
    cost: participantCost(samples, p, start, end)
  }));
}

/**
 * Wrap pre-built cost columns in a cost-table section element.
 * @param {*[]} cols The table columns.
 * @param {Snapshot[]} samples The sample stream (portrait identity fallback).
 * @returns {HTMLElement} The cost section.
 */
function costSection(cols, samples) {
  const costs = document.createElement("div");
  costs.className = "demographics-crisis-stage-costs";
  costs.appendChild(buildCostTable(cols, CRISIS_METRICS, samples, -1));
  return costs;
}

/**
 * Build a live per-civ cost-table section over [start, end].
 * @param {Snapshot[]} samples The sample stream.
 * @param {number} start Window start turn.
 * @param {number} end Window end turn.
 * @returns {HTMLElement} The cost section.
 */
function buildCostSection(samples, start, end) {
  return costSection(liveCrisisCols(samples, start, end), samples);
}

/**
 * The cumulative cost columns for a crisis group, preferring the age-end SNAPSHOT (persisted while
 * the finished age's samples were still dense) over recomputing from now-decimated samples — which
 * is what made the loss columns blank out from a later age.
 * @param {{ start:number, end:number, sample:Snapshot }} group The crisis run.
 * @param {{ samples:Snapshot[], crisisSnapshots?:Record<string, *[]> }} ctx Render context.
 * @returns {*[]} The cost-table columns.
 */
function cumulativeCols(group, ctx) {
  const snap = ctx.crisisSnapshots && ctx.crisisSnapshots[sampleAgeKey(group.sample)];
  if (Array.isArray(snap)) return toTableCols(snap);
  return liveCrisisCols(ctx.samples, group.start, group.end);
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
 * @param {{ start: number, end: number, sample: Snapshot }} group The crisis run.
 * @param {{ samples: Snapshot[], crisisSnapshots?: Record<string, *[]> }} ctx Render context.
 * @returns {HTMLElement} The cumulative block.
 */
function buildCumulativeBlock(group, ctx) {
  const block = document.createElement("div");
  block.className = "demographics-crisis-stage demographics-crisis-cumulative";
  const cap = document.createElement("div");
  cap.className = "demographics-crisis-cumulative-caption";
  cap.textContent = t("LOC_DEMOGRAPHICS_CRISIS_CUMULATIVE");
  block.appendChild(cap);
  block.appendChild(costSection(cumulativeCols(group, ctx), ctx.samples));
  return block;
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
 * Build a per-group render context whose samples + year map are restricted to
 * the group's age. Crisis windows key off age-local `s.turn`, which resets each
 * age, so an unfiltered stream would let a later age's coincident turn numbers
 * leak into (or invert) this crisis's windows. Filtering to the age makes every
 * downstream turn lookup unambiguous.
 * @param {*} ctx Base render context (samples / seed / yearMap / mode).
 * @param {{ sample: Snapshot }} group The crisis group.
 * @returns {*} The same context with samples + yearMap scoped to the group's age.
 */
function groupCtx(ctx, group) {
  const age = sampleAgeKey(group.sample);
  const gSamples = ctx.samples.filter((/** @type {Snapshot} */ s) => sampleAgeKey(s) === age);
  return { ...ctx, samples: gSamples, yearMap: buildYearMap(gSamples) };
}

/**
 * One age's cumulative crisis cost columns (raw {pid,leaderType,color,cost}), preferring the
 * persisted age-end snapshot over recomputing from now-decimated samples.
 * @param {string} age The age key.
 * @param {{ samples:Snapshot[], crisisSnapshots?:Record<string, *[]> }} ctx Render context.
 * @returns {*[]} The age's cumulative cost columns.
 */
function ageOverallCols(age, ctx) {
  const snap = ctx.crisisSnapshots && ctx.crisisSnapshots[age];
  if (Array.isArray(snap)) return snap;
  return buildAgeCrisisCols(ctx.samples.filter((s) => sampleAgeKey(s) === age));
}

/**
 * Aggregate every participant's cost across all ages' crises into cost-table columns: each age's
 * cumulative (snapshot or live) merged by pid.
 * @param {{ sample: Snapshot }[]} groups The crisis groups.
 * @param {{ samples:Snapshot[], crisisSnapshots?:Record<string, *[]> }} ctx Render context.
 * @returns {*[]} The overall table columns.
 */
function aggregateOverallCols(groups, ctx) {
  const ages = [...new Set(groups.map((g) => sampleAgeKey(g.sample)))];
  return mergeAgeCols(ages.map((age) => ageOverallCols(age, ctx)));
}

/**
 * Build the gated OVERALL cumulative block summing every age's crisis. Only
 * meaningful once crises span more than one age, so the caller renders it solely
 * when a second age's crisis (e.g. Exploration) exists.
 * @param {{ sample: Snapshot }[]} groups The crisis groups.
 * @param {{ samples: Snapshot[] }} ctx Render context (full samples, for identity).
 * @returns {HTMLElement} The overall block.
 */
function buildOverallBlock(groups, ctx) {
  const block = document.createElement("div");
  block.className =
    "demographics-crisis-stage demographics-crisis-cumulative demographics-crisis-overall";
  const cap = document.createElement("div");
  cap.className = "demographics-crisis-cumulative-caption";
  cap.textContent = t("LOC_DEMOGRAPHICS_CRISIS_OVERALL");
  block.appendChild(cap);
  block.appendChild(costSection(aggregateOverallCols(groups, ctx), ctx.samples));
  return block;
}

/**
 * Append the overall cross-age cumulative block, but only once crises exist in
 * at least two distinct ages (i.e. after the Exploration crisis occurs).
 * @param {HTMLElement} panel The page panel.
 * @param {{ sample: Snapshot, start: number, end: number }[]} groups The crisis groups.
 * @param {{ samples: Snapshot[] }} ctx Render context.
 */
function appendOverallBlock(panel, groups, ctx) {
  const ages = new Set(groups.map((g) => sampleAgeKey(g.sample)));
  if (ages.size < 2) return;
  panel.appendChild(buildOverallBlock(groups, ctx));
}

/**
 * The persisted per-age crisis-cost snapshots from the history blob (empty when none).
 * @param {*} history The history blob.
 * @returns {Record<string, *[]>} Age key → cumulative cost columns.
 */
function historyCrisisSnapshots(history) {
  return (history && history.crisisSnapshots) || {};
}

/**
 * Render the Crises page: each age's crisis as its own titled group (separated
 * visually), with one block per stage and a per-age cumulative on the final
 * stage, plus a single overall cumulative once crises span two or more ages.
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
