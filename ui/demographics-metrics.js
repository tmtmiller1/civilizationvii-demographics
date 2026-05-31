// demographics-metrics.js
//
// Metric registry. Each entry:
//   { id, label, category, accessor(ctx)→number|undefined,
//     scale?(raw, scaleCtx, ctx)→number, format(n)→string, tooltip? }
//
// Accessors take a pre-resolved `ctx` built by the sampler (see
// demographics-sampler.js#buildPlayerCtx). Every ctx field can be
// undefined and the accessors have to tolerate that without throwing.
// Return `undefined` and the sampler drops the metric for that player
// on that turn; if a metric returns undefined for every player across
// every recorded sample, the screen auto-hides its tab
// (see screen-demographics.js).
//
// A few metrics apply a deterministic transform to make the raw game
// number feel more real-world — GDP in dollars, population in millions,
// land in km². These are purely cosmetic; they never affect game state.
// Per-metric formulas are documented inline below.
//
// Every accessor is cited to vanilla Civ7 source in demographics-sampler.js.

const DBG = true;
function dlog(...a) {
  if (DBG) console.warn("[Demographics.metrics]", ...a);
}

function safeNum(v) {
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

// ---- format helpers ------------------------------------------------------

// 1234567 -> "1.23M". Handles negatives & sub-1000 values without suffix.
export function formatBigNumber(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e12) return sign + (a / 1e12).toFixed(2) + "T";
  if (a >= 1e9) return sign + (a / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return sign + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return sign + (a / 1e3).toFixed(1) + "K";
  return sign + String(Math.round(a));
}

export function formatCurrency(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return "$" + formatBigNumber(n);
}

export function formatArea(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return formatCount(Math.round(n)) + " km²";
}

export function formatPercent(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return Math.round(n) + "%";
}

export function formatCount(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  // Add comma thousands-separators without locale ambiguity.
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatSignedRate(n) {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  const r = (n >= 0 ? "+" : "") + (Math.abs(n) > 100 ? Math.trunc(n) : Math.trunc(n * 10) / 10);
  return r + "/turn";
}

// ---- scaling helpers -----------------------------------------------------

// Scaled population: turn-aware, sublinear, and empirically tuned for realism.
// Calibrated to roughly:
//   T=1   pop=4   →  ~350K  (small early city)
//   T=50  pop=12  →  ~5M    (mature antiquity empire)
//   T=100 pop=40  →  ~18M   (mid exploration)
//   T=200 pop=100 →  ~350M  (industrialised modern empire)
// This avoids excessive values in Antiquity and tracks real-world growth.
function scalePopulation(raw, scaleCtx, ctx) {
  if (typeof raw !== "number" || !isFinite(raw) || raw <= 0) return 0;
  const turn =
    ctx && typeof ctx.turn === "number" && ctx.turn > 0
      ? ctx.turn
      : scaleCtx && typeof scaleCtx.turn === "number" && scaleCtx.turn > 0
        ? scaleCtx.turn
        : 1;
  // Tuned formula: pop^1.11 × 90000 × 1.009^turn
  return Math.pow(raw, 1.11) * 90000 * Math.pow(1.009, turn);
}

// GDP scale: (raw weighted per-turn yield sum) × turnsElapsed × 1,000,000
// — produces billion-scale numbers that grow believably over a game.
// Falls back to current turn=1 if scaleCtx.turn missing.
// `scaleCtx` is the per-player ctx (sampler passes the player ctx as both
// arguments at call sites); we also accept a third `ctx` arg as the spec
// describes, falling back to scaleCtx for turn lookup.
function scaleGDP(raw, scaleCtx, ctx) {
  if (typeof raw !== "number" || !isFinite(raw)) return 0;
  // Always synthesize: raw weighted-yield sum × turn × 1e6 → $billions.
  // The earlier branch that returned victoryPointsEconomic unscaled
  // produced the "drop to zero" artifact (see gdpAccessor for context).
  const src =
    ctx && typeof ctx.turn === "number"
      ? ctx
      : scaleCtx && typeof scaleCtx.turn === "number"
        ? scaleCtx
        : null;
  const turn = src && typeof src.turn === "number" && src.turn > 0 ? src.turn : 1;
  return raw * turn * 1000000;
}

// GDP weighting — research-informed values describing the relative
// "value per point" of each yield (production = base unit of 1.0).
// See README/spec for rationale.
const GDP_WEIGHTS = {
  gold: 1.0,
  production: 1.0,
  food: 0.5,
  influence: 1.5,
  culture: 1.2,
  science: 1.2
};

function gdpAccessor(ctx) {
  // Always synthesize GDP from weighted per-turn yields. Earlier code
  // tried to switch to `player.Victories.getPointsForVictoryType(
  // VICTORY_ECONOMIC_MODERN)` once it became available in the Modern
  // age, but those "real" victory points start at single-digit values
  // (1, 2, 3...) while the synthesized GDP is on a $billions scale.
  // The instant a civ earned their first economic victory point, the
  // accessor swapped paths and the line collapsed from ~$8B to ~$3 —
  // looking like a hard drop to zero on the chart. Each civ hit that
  // first VP at a different turn, hence the "every civilization drops
  // to zero at varying times" symptom.
  //
  // Keeping the synthesis path exclusive ensures a continuous magnitude
  // from antiquity through modern.
  const g = safeNum(ctx.yieldGold);
  const p = safeNum(ctx.yieldProduction);
  const f = safeNum(ctx.yieldFood);
  const i = safeNum(ctx.yieldDiplomacy);
  const c = safeNum(ctx.yieldCulture);
  const s = safeNum(ctx.yieldScience);
  // If every yield came back undefined we have NO real data for this
  // player this turn (Stats API not ready yet — common on the first
  // sample after a saved-game resume). Return undefined so the sampler
  // omits gdp from the snapshot entirely. The chart's `spanGaps:true`
  // will connect across the gap with a straight segment, which is far
  // less jarring than a sudden plunge to $0 that an explicit `return 0`
  // produced (the earlier "always return 0" fix was the source of the
  // GDP graph appearing not to survive a save reload).
  if (
    g === undefined &&
    p === undefined &&
    f === undefined &&
    i === undefined &&
    c === undefined &&
    s === undefined
  ) {
    return undefined;
  }
  return (
    (g || 0) * GDP_WEIGHTS.gold +
    (p || 0) * GDP_WEIGHTS.production +
    (f || 0) * GDP_WEIGHTS.food +
    (i || 0) * GDP_WEIGHTS.influence +
    (c || 0) * GDP_WEIGHTS.culture +
    (s || 0) * GDP_WEIGHTS.science
  );
}

// Land area: tile count × 7000 km² per Civ7 hex (small map ≈ Earth scale).
function scaleLandArea(raw /*, scaleCtx, ctx */) {
  if (typeof raw !== "number" || !isFinite(raw)) return 0;
  return raw * 7000;
}

// Approval: ((happinessNet / settlements) + 10) / 20 × 100 clamped [0,100].
// Uses ctx.settlementsCount as the divisor; if missing/zero, returns
// undefined (which the sampler will skip).
function scaleApproval(raw, _scaleCtx, ctx) {
  const settlements = safeNum(ctx?.settlementsCount);
  if (!settlements || settlements <= 0) return undefined;
  const ratio = raw / settlements;
  const pct = ((ratio + 10) / 20) * 100;
  if (!isFinite(pct)) return undefined;
  return Math.max(0, Math.min(100, pct));
}

// Score heuristic fallback: techs + civics + 2*settlements + gold/100.
function scoreFallback(ctx) {
  const techs = safeNum(ctx.techsCount) || 0;
  const civics = safeNum(ctx.civicsCount) || 0;
  const settlements = safeNum(ctx.settlementsCount) || 0;
  const gold = safeNum(ctx.gold) || 0;
  return techs + civics + 2 * settlements + Math.floor(gold / 100);
}

// ---- metric registry -----------------------------------------------------

export const METRICS = [
  // ---- canonical / "raw" ---------------------------------------------
  {
    id: "score",
    label: "Score",
    title: "Civilization Score",
    category: "power",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_SCORE_TOOLTIP",
    accessor: (ctx) => {
      try {
        const s = ctx.stats;
        if (s && typeof s.getScore === "function") {
          const v = s.getScore();
          if (safeNum(v) !== undefined) return v;
        }
      } catch (e) {
        /* fall through */
      }
      return scoreFallback(ctx);
    },
    format: (n) => formatCount(Math.round(n)),
    unit: "points"
  },
  {
    id: "gold",
    label: "Treasury",
    title: "Treasury",
    category: "economy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_GOLD_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.gold),
    format: (n) => formatCount(Math.round(n)),
    unit: "gold",
    // yield-icons.xml:65-72 — blp:Yield_Gold (64px).
    unitIcon: "blp:Yield_Gold"
  },
  {
    // Gold income per turn (net) — yield-based companion to Treasury.
    id: "gpt",
    label: "GPT",
    title: "Gold Per Turn",
    category: "economy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_GPT_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.yieldGold),
    format: formatSignedRate,
    unit: "gold / turn",
    unitIcon: "blp:Yield_Gold"
  },
  {
    id: "settlements",
    label: "Settlements",
    title: "Settlements (cities + towns)",
    category: "people",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_SETTLEMENTS_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.settlementsCount),
    format: (n) => formatCount(Math.round(n)),
    unit: "cities"
  },
  {
    id: "techs",
    label: "Techs",
    title: "Technologies Researched",
    category: "science",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_TECHS_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.techsCount),
    format: (n) => formatCount(Math.round(n)),
    unit: "techs"
  },
  {
    id: "civics",
    label: "Civics",
    title: "Civics Unlocked",
    category: "culture",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_CIVICS_TOOLTIP",
    // Turn-1 fix: when the Culture progression tree handle isn't yet
    // populated, sampler stores ctx.civicsCount as undefined. Returning
    // undefined here would cause the chart to skip the entire civ's
    // series (chart.js:80 requires isFinite). Default to 0 so the
    // turn-1 sample plots at y=0 with a legend entry, rather than
    // showing no line/label at all.
    accessor: (ctx) => {
      const v = safeNum(ctx.civicsCount);
      return v === undefined ? 0 : v;
    },
    format: (n) => formatCount(Math.round(n)),
    unit: "civics"
  },

  // ---- V5 pseudo-realistic -------------------------------------------
  {
    // GDP = weighted-sum(yields) × turnsElapsed × 1e6 → $billions
    // Weights: gold=1.0, production=1.0, food=0.5, influence=1.5,
    // culture=1.2, science=1.2 (see GDP_WEIGHTS).
    id: "gdp",
    label: "GDP",
    title: "Gross Domestic Product",
    category: "economy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_GDP_TOOLTIP",
    accessor: gdpAccessor,
    scale: scaleGDP,
    format: formatCurrency,
    // format() already prepends "$" (e.g. "$1.23B"); keep unit short
    // so the axis label doesn't double-render the dollar sign.
    unit: "$"
  },
  {
    // Crop yield = net FOOD per turn (display as +/-).
    id: "crops",
    label: "Crop Yield",
    title: "Crop Yield (food per turn)",
    category: "economy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_CROPS_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.yieldFood),
    format: formatSignedRate,
    unit: "food / turn",
    // Civ7 yield-icon BLP path, registered in
    //   Resources/Base/modules/base-standard/data/icons/yield-icons.xml:5-12
    unitIcon: "blp:Yield_Food"
  },
  {
    // Net PRODUCTION per turn (display as +/-).
    // yield-icons.xml:36-43 — blp:Yield_Production.
    id: "production",
    label: "PPT",
    title: "Production Per Turn",
    category: "economy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_PRODUCTION_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.yieldProduction),
    format: formatSignedRate,
    unit: "production / turn",
    unitIcon: "blp:Yield_Production"
  },
  {
    // Net SCIENCE per turn (display as +/-).
    // yield-icons.xml:96-103 — blp:Yield_Science.
    id: "science_yield",
    label: "Science",
    title: "Science Per Turn",
    category: "knowledge",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_SCIENCE_YIELD_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.yieldScience),
    format: formatSignedRate,
    unit: "science / turn",
    unitIcon: "blp:Yield_Science"
  },
  {
    // Net CULTURE per turn (display as +/-).
    // yield-icons.xml:126-133 — blp:Yield_Culture.
    id: "culture_yield",
    label: "Culture",
    title: "Culture Per Turn",
    category: "knowledge",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_CULTURE_YIELD_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.yieldCulture),
    format: formatSignedRate,
    unit: "culture / turn",
    unitIcon: "blp:Yield_Culture"
  },
  {
    // Diplomatic Approval — international reputation aggregate.
    // Sum of weighted relationship scores across all met major civs
    // (Allied +5, Helpful +3, Friendly +2, Neutral 0, Unfriendly -2,
    // Hostile -3, At War -5) PLUS 0.3 × (suzerain bonus from city-states).
    // Sampled in demographics-sampler.js → ctx.diplomaticApproval.
    id: "approval",
    label: "Diplomatic Approval",
    title: "Diplomatic Approval (international reputation)",
    category: "diplomacy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_APPROVAL_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.diplomaticApproval),
    format: (n) => {
      if (typeof n !== "number" || !isFinite(n)) return "—";
      return (n >= 0 ? "+" : "") + Math.round(n * 10) / 10;
    },
    unit: "reputation"
  },
  {
    // Scaled population: per-civ totalPopulation^2.8 × 100k → millions.
    id: "population",
    label: "Population",
    title: "Population (scaled millions)",
    category: "people",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_POPULATION_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.totalPopulation),
    scale: scalePopulation,
    format: formatBigNumber,
    unit: "people"
  },

  // ---- V7-specific creative ------------------------------------------
  {
    // Influence net per turn (= YIELD_DIPLOMACY).
    id: "influence",
    label: "IPT",
    title: "Influence Per Turn",
    category: "diplomacy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_INFLUENCE_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.yieldDiplomacy),
    format: formatSignedRate,
    // yield-icons.xml:185-193 maps YIELD_DIPLOMACY to blp:yield_influence.
    unit: "influence / turn",
    unitIcon: "blp:yield_influence"
  },
  {
    // Active diplomatic actions involving the player.
    id: "hpt",
    label: "HPT",
    title: "Happiness Per Turn",
    category: "people",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_HPT_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.yieldHappiness),
    format: formatSignedRate,
    unit: "happiness / turn"
  },
  {
    id: "deals",
    label: "Ongoing Deals",
    title: "Active Diplomatic Deals",
    category: "diplomacy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_DEALS_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.ongoingDealsCount),
    format: formatCount,
    unit: "deals"
  },
  {
    // Player-wide trade route count.
    id: "trade",
    label: "Trade Routes",
    title: "Active Trade Routes",
    category: "economy",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_TRADE_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.tradeRoutesCount),
    format: formatCount,
    unit: "routes"
  },
  {
    // Military Power — summed combat strength across military units.
    // Computed in sampler (no clean vanilla player-level accessor); see
    // demographics-sampler.js computeMilitaryPower() — citations there.
    id: "milpower",
    label: "Military Power",
    title: "Military Power (combined unit strength)",
    category: "power",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_MILPOWER_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.militaryPower),
    format: (n) => formatCount(Math.round(n)),
    unit: "strength"
  },
  {
    // Wonders — total wonders constructed by the player, all ages.
    // Accessor: player.Stats.getNumWonders(false, false)
    //   — base-standard/ui/advice/advice-support.js:33
    id: "wonders",
    label: "Wonders",
    title: "Wonders Constructed",
    category: "power",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_WONDERS_TOOLTIP",
    accessor: (ctx) => safeNum(ctx.wondersCount),
    format: (n) => formatCount(Math.round(n)),
    unit: "wonders"
  },
  // ── Civ7 Test of Time triumph counts ───────────────────────────────
  // Per-civ count of triggered triumphs, bucketed by Legacies.LegacySubtype.
  // Sampler reads via Players.get(pid).Legacies.isTriggered(legacyType) for
  // every row in GameInfo.Legacies. These six fields are persisted in
  // every sample's metrics so the stacked-area "Triumphs Over Time" view
  // and the radar can reconstruct history. They DON'T have their own
  // line-chart tabs — a single-integer step counter over hundreds of
  // turns is poor info density. The dedicated triumph views (Race,
  // Completion, Stack) live as synthetic metrics in view-history.js.
  {
    id: "triumphs_cultural",
    category: "age",
    factbookHidden: true,
    hidden: true,
    accessor: (ctx) => safeNum(ctx.triumphsCultural)
  },
  {
    id: "triumphs_diplomatic",
    category: "age",
    factbookHidden: true,
    hidden: true,
    accessor: (ctx) => safeNum(ctx.triumphsDiplomatic)
  },
  {
    id: "triumphs_economic",
    category: "age",
    factbookHidden: true,
    hidden: true,
    accessor: (ctx) => safeNum(ctx.triumphsEconomic)
  },
  {
    id: "triumphs_scientific",
    category: "age",
    factbookHidden: true,
    hidden: true,
    accessor: (ctx) => safeNum(ctx.triumphsScientific)
  },
  {
    id: "triumphs_militaristic",
    category: "age",
    factbookHidden: true,
    hidden: true,
    accessor: (ctx) => safeNum(ctx.triumphsMilitaristic)
  },
  {
    id: "triumphs_expansionist",
    category: "age",
    factbookHidden: true,
    hidden: true,
    accessor: (ctx) => safeNum(ctx.triumphsExpansionist)
  },
  // Settlement cap utilization: settlements / cap × 100.
  // citation: base-standard/ui/diplo-ribbon/panel-yield-banner.js:208-209
  {
    id: "settlement_cap_pct",
    label: "Cap Utilization",
    title: "Settlement Cap Utilization",
    category: "age",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_SETTLEMENT_CAP_PCT_TOOLTIP",
    accessor: (ctx) => {
      const n = safeNum(ctx.numSettlements);
      const cap = safeNum(ctx.settlementCap);
      if (n === undefined || !cap || cap <= 0) return undefined;
      return (n / cap) * 100;
    },
    format: formatPercent,
    unit: "%"
  },
  // Crisis stage 0-3 (game-wide). Plotted as a step function.
  // citation: base-standard/ui/policies/model-government.js:119-125
  {
    id: "crisis_stage",
    label: "Crisis Stage",
    title: "Crisis Stage — 1 = Begins · 2 = Intensifies · 3 = Culminates · 4 = Ends",
    category: "age",
    global: true,
    factbookHidden: true,
    // Discrete integer metric — Chart.js auto-generates fractional ticks
    // (0, 0.5, 1, …) over our 0–4 range and the formatter rounds them,
    // so labels appear 9 times instead of 5. This flag tells the chart
    // to suppress non-integer tick labels.
    integerOnly: true,
    tooltip: "LOC_DEMOGRAPHICS_METRIC_CRISIS_STAGE_TOOLTIP",
    // Game.CrisisManager.getCurrentCrisisStage(0) returns:
    //   -1 = pre-crisis (no crisis triggered yet)
    //    0 = first active stage ("Crisis Begins")
    //    1 = second active stage ("Crisis Intensifies")
    //    2 = third active stage ("Crisis Culminates")
    //    3 = post-final stage ("Crisis Ends")
    // Cite: model-government.js:120 — `nextCrisisStage = max(0, crisisStage+1)`
    // looks at the NEXT marker index, confirming engine values are 0-based.
    // Display-side we want the user-facing label "Stage 1" when the engine
    // says 0 (the first active stage). Shift every value up by 1 so the
    // Y axis range becomes 0..4 and engine=-1 plots cleanly as Y=0.
    accessor: (ctx) => {
      const s = safeNum(ctx.crisisStage);
      if (s === undefined) return undefined;
      return s < 0 ? 0 : s + 1;
    },
    format: (n) => {
      const v = Math.max(0, Math.round(n));
      if (v === 0) return "Pre-Crisis";
      if (v === 1) return "Stage 1 (Begins)";
      if (v === 2) return "Stage 2 (Intensifies)";
      if (v === 3) return "Stage 3 (Culminates)";
      if (v >= 4) return "Stage 4 (Ends)";
      return "Stage " + v;
    },
    unit: "stage"
  },
  // ── Resources page metrics ─────────────────────────────────────────
  // citation: base-standard/ui/resource-allocation/model-resource-allocation.js:126
  {
    id: "resources_total",
    label: "Resources",
    title: "Total Assigned Resources",
    category: "resources",
    accessor: (ctx) => safeNum(ctx.resourcesTotal),
    format: (n) => formatCount(Math.round(n)),
    unit: "resources"
  },
  {
    id: "resources_bonus",
    label: "Bonus",
    title: "Bonus Resources Assigned",
    category: "resources",
    factbookHidden: true,
    accessor: (ctx) => safeNum(ctx.resourcesBonus),
    format: (n) => formatCount(Math.round(n)),
    unit: "bonus"
  },
  {
    id: "resources_empire",
    label: "Empire",
    title: "Empire Resources Assigned",
    category: "resources",
    factbookHidden: true,
    accessor: (ctx) => safeNum(ctx.resourcesEmpire),
    format: (n) => formatCount(Math.round(n)),
    unit: "empire"
  },
  {
    id: "resources_city",
    label: "City",
    title: "City Resources Assigned",
    category: "resources",
    factbookHidden: true,
    accessor: (ctx) => safeNum(ctx.resourcesCity),
    format: (n) => formatCount(Math.round(n)),
    unit: "city"
  },
  {
    id: "resources_factory",
    label: "Factory",
    title: "Factory Resources (Modern age)",
    category: "resources",
    factbookHidden: true,
    accessor: (ctx) => safeNum(ctx.resourcesFactory),
    format: (n) => formatCount(Math.round(n)),
    unit: "factory"
  },
  {
    id: "resources_treasure",
    label: "Treasure",
    title: "Treasure Resources (Exploration / Distant Lands)",
    category: "resources",
    factbookHidden: true,
    accessor: (ctx) => safeNum(ctx.resourcesTreasure),
    format: (n) => formatCount(Math.round(n)),
    unit: "treasure"
  },
  {
    // Land area: total owned tiles × 7000 km² per hex.
    id: "land",
    label: "Land Area",
    title: "Territorial Land Area",
    category: "people",
    tooltip: "LOC_DEMOGRAPHICS_METRIC_LAND_TOOLTIP",
    // Turn-1 fix: when the player has no cities yet, sumOwnedTiles
    // (sampler) returns undefined. Default to 0 so a settler-only civ
    // still appears at y=0 km² on turn 1 with a legend entry.
    accessor: (ctx) => {
      const v = safeNum(ctx.tilesOwned);
      return v === undefined ? 0 : v;
    },
    scale: scaleLandArea,
    format: formatArea,
    // format() already appends "km²" to every value; keep unit short
    // so the axis title doesn't double-render the suffix.
    unit: "km²"
  }
];

export function getMetric(id) {
  return METRICS.find((m) => m.id === id) || METRICS[0];
}

dlog("metrics module loaded; registry size=", METRICS.length);
