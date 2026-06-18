# Demographics for Civilization VII

A read-only analytics dashboard that samples data for every civilization each turn (the sample rate is changeable) and displays it as filterable graphs, charts, and rankings. It does not change gameplay.

## At a glance (for players)

The in-game stats screen Civilization VII is missing: per-turn graphs, leaderboards, and a diplomacy map for every civilization you've met, all read-only.

- **Historical Data:** per-turn line charts for economy, power, knowledge, resources, and more, with every civ on one plot.
- **World Rankings:** civilization and settlement leaderboards, per-civ profile cards, and a Top 25 settlements board with map fly-to.
- **Global Relations:** a diplomacy ring of the civilizations and city-states you've met.
- **Wars and crises:** a timeline of every war with real, sampled costs, plus an age-by-age breakdown of each crisis's toll.
- **Real-world scale:** figures rendered as representative populations (millions), GDP ($billions), and territory (km²).
- **Yours to tune:** per-civ colors, time-range filters, hide/focus, smoothing, colorblind mode, CSV export, and adjustable sampling.

Everything below is the full reference. New to the mod? Open it from the subsystem dock and explore the tabs; the bullets above are all you need to start.

---

Intended to be the spiritual successor to robk's InfoAddict (Civ V) and Gedemon's CivGraphs (Civ VI), and an extension of Slothoth's Global Relations panel with added filters (Civ VII). Open source, with full readable source included.

---

## System Guide and Feature Reference

## Contents

1. [Tabs](#1-tabs)
2. [Historical Data](#2-historical-data)
3. [World Rankings](#3-world-rankings)
4. [Global Relations](#4-global-relations)
5. [Conflicts and crises](#5-conflicts-and-crises)
6. [How the figures are calculated](#6-how-the-figures-are-calculated)
7. [Behavior and persistence](#7-behavior-and-persistence)
8. [Companion-mod integration](#8-companion-mod-integration)
9. [Install and run](#9-install-and-run)
10. [Usage](#10-usage)
11. [Compatibility](#11-compatibility)

---

## 1. Tabs

- **Historical Data**: per-turn time-series charts and dashboards.
- **World Rankings**: civilization and settlement leaderboards, per-civ All Civilizations profiles, and a Top 25 settlements board with map fly-to.
- **Global Relations**: concentric relationship ring of met civilizations and city-states.
- **Options**: sampling, visibility, and display settings.

## 2. Historical Data

Chart.js time-series and dashboards, grouped into seven metric pages (in-game metric names in parentheses where they differ):

- **Economy**: Score, GDP, Treasury, GPT, Production (PPT), Crops (Crop Yield), Trade Routes.
- **Power**: Military Power, Population, Settlements, Cap Utilization, Land Area, Wonders.
- **Knowledge & Influence**: Techs, Civics, Science, Culture, Diplomatic Approval, Influence (IPT), Happiness (HPT), Ongoing Deals.
- **Triumphs**: Legacy Radar (Test of Time legacy dashboard).
- **Resources**: per-category resource counts over time (Total, Bonus, Empire, City, Factory, Treasure), plus a stacked overview.
- **Conflicts**: Gantt chart of every war this game, with per-war cost graphs and a glossary (§5).
- **Crises**: each age's crisis broken into stages, with per-civ cost tables, a per-crisis cumulative-impact table, and a cross-age overall total (§5).

Supports per-civ colors, time-range filters, year axis labels, per-metric formatting, hide/focus civs, smoothing, elimination filtering, and CSV export.

## 3. World Rankings

Four sub-tabs:

- **Civilization Ranking**: civilizations ordered by cumulative settlement score.
- **All Civilizations**: per-civ cards with current metric values and world ranks (the All Civilizations table). Unmet civilizations show as placeholders unless name revelation is enabled in Options.
- **Top 25 Settlements**: a podium-and-ranked-list board of the strongest settlements. Each card can snap the camera to the city (**View on map**), play a smooth **Cinematic view**, or, with the experimental settlement flyby enabled in Options, run a short keyframed flyby.
- **All Settlements**: a dense, sortable table filterable by All / Cities / Towns.

## 4. Global Relations

Concentric ring: the viewer civ at center, met civilizations on the inner ring, met city-states on the outer. Edges use the diplomacy palette; city-state nodes show their type glyph; colorblind mode switches to a high-contrast palette.

## 5. Conflicts and crises

The **Conflicts** page is a Gantt chart of wars from diplomacy events (declarer, supporters, opposers, and a stable war ID). War cost is the observed change in each side's military, settlements, population, and production across the war, derived from the recorded samples (not invented), and it comes with per-war cost graphs and a glossary explaining each figure.

The **Crises** page breaks each age's crisis into its stages (Begins, Intensifies, Culminates, Ends), each with a per-civ cost table, then a per-crisis cumulative-impact table and, once crises span more than one age, a cross-age overall total. Because the loss figures are sums of per-turn declines (which need dense samples), each finished age's cumulative cost is captured when that age ends, so it stays accurate even after old samples are thinned to cap the save.

## 6. How the figures are calculated

Every number is **derived from what the mod can observe by sampling the game each turn**, not read from a hidden engine ledger. Each turn it records a snapshot of every met civilization's raw figures; the charts and tables compute everything from those snapshots. Two consequences follow: a figure can only be as fine-grained as the sampling (see §7), and "loss"-type figures are inferred from how a value moved over time rather than from an authoritative casualty log.

### Direct reads

Most metrics are read straight off the player each turn with no transform: the per-turn yields (Gold/Production/Science/Culture/Influence/Happiness per turn, net), and the counts (Settlements, Techs, Civics, Wonders, Trade Routes, Ongoing Deals). These plot as-is.

### Derived and rescaled figures

A few figures apply a deterministic transform so the raw game number reads at a believable real-world scale. These are **cosmetic** and never affect gameplay:

- **Population (scaled):** `raw_population ^ 1.11 × 90,000 × 1.009 ^ turn`, rendered in millions. The exponent spreads small early populations; the `1.009 ^ turn` growth keeps later eras from looking flat. (Migration "people" counts use the same shape with a smaller base, which is how the Emigration companion mod stays aligned.)
- **GDP:** a weighted sum of the per-turn yields, `× turn × 1,000,000`, shown in `$M`/`$B`. Weights: Gold 1.0, Production 1.0, Food 0.5, Science 1.2, Culture 1.2, Influence 1.5. Multiplying by the turn count approximates a cumulative economy rather than a single turn's output.
- **Land Area:** `owned_tiles × 7,000 km²` (a hex's nominal real-world area).
- **Military Power:** the summed combat strength of the civ's military units, totaled in the sampler (there is no clean player-level engine accessor).
- **Diplomatic Approval:** a reputation aggregate. Each met major civ contributes by relationship (Allied +5, Helpful +3, Friendly +2, Neutral 0, Unfriendly -2, Hostile -3, At War -5); suzerained city-states contribute the same weights at `× 0.3`.
- **Settlement Cap Utilization:** `settlements ÷ settlement_cap × 100`.
- **Crisis Stage:** the engine's internal stage (pre-crisis -1 through 3) shifted up by one so it reads "Stage 1" to "Stage 4" and plots cleanly as a step.

### War and crisis cost

War costs (the per-combatant tables) and crisis costs (the per-civ stage and cumulative tables) share one engine: each figure is a participant's metric series reduced over its **active window** (`[join turn, leave turn or war/age end]`) by a mode chosen per figure:

- **Losses** (Strength Lost, Population/Crop/Production Lost): the **sum of every turn-over-turn decline** in the series, with rises ignored so ordinary growth can never mask a loss. This needs reasonably dense samples to catch each dip (see the caveat below). Population Lost reads **raw** population, not the rescaled chart value, so the growth multiplier can't hide real drops.
- **Net** (Settlements, Land): `last − first` over the window, signed (`+gained` / `-lost`). These are event-based (cities/territory that actually changed hands by capture), so they read "-" for wars that predate the tracking rather than a misleading 0.
- **Accrued / Spent** (Settlements Razed, Production Directed to War, Refugees): the increase of a cumulative event counter over the window (`last − first`).
- **Level** (current Military Power): the last sampled value, a standing figure rather than a flow.
- **Casualties** (Military Strength Lost) prefer the engine's cumulative units-killed counter when present (true kills), falling back to the standing-army decline for older saves.

A crisis's cumulative impact sums these across its stages, and a finished age's cumulative is **snapshotted when that age ends** so it survives later sample thinning (§5).

### Caveat: sampling resolution

Because losses are summed from per-turn dips, coarse sampling (or the decimation of old samples that caps long games, §7) can **under-count** a loss, and on a heavily thinned window a loss figure drops to "-" rather than guess. Standing figures (current Military Power, counts) survive on a single sample. This is why the loss math reads raw, ignores rises, and why crisis cumulatives are snapshotted at their age boundary.

## 7. Behavior and persistence

- Settings persist in `localStorage`. Recorded history persists per save game via the GameConfiguration store, carrying across quit/load and age transitions.
- History sample caps scale with game speed and can be overridden in Options. Lower the sample frequency there to cut per-turn work on slow machines or long games.
- Colorblind mode swaps chart and relationship colors to a colorblind-safe set.
- Single-player by default: diplomacy, influence, and relations figures for civilizations you haven't met are withheld (the charts show a gap; toggle in Options). The mod does not access-control the screen in multiplayer, so a host should gate or disable it.

## 8. Companion-mod integration

Other mods can contribute to the Historical Data screen through an optional, order-independent API on `globalThis.DemographicsMetricsAPI` (inert unless called, so the base mod is unchanged):

- **`registerMetric(spec)`**: add a per-civ line-chart metric that flows through the normal sample, store, and chart pipeline. A spec may include a `tooltipAttribution(ctx)` callback whose returned string is shown as a source-attribution line in that metric's tooltip.
- **`registerMetricToPage(pageId, metricId, afterMetricId?)`**: place the metric's tab on an existing page (for example, next to Population on **Power**).
- **`registerPanel(spec)`**: contribute a whole **page** whose body the companion renders itself. The screen adds it as its own tab and calls `spec.render(container, ctx)` to fill it (the time-range filter and CSV toolbar are suppressed for these custom pages). Demographics gains no dependency on the companion.

The handshake is load-order-independent: registrations made before this screen loads are queued and drained when it initializes. The companion **Emigration** mod uses all three, contributing net-migration, emigration, and immigration graphs with per-cause source attribution plus a dedicated **Migration** dashboard page.

### Performance on large saves (with Emigration installed)

If late-game turns feel heavy with both mods active, two safe levers help — in this order:

1. **Lower Demographics' sampling frequency first** (Options → sampling): this mod samples every met civilization's metrics each turn, so a coarser cadence is the bigger per-turn win. It only changes how *often* the charts gain a data point, never the figures themselves.
2. **Then raise Emigration's `turnInterval`** (Options → Mods → Emigration - Advanced) so its migration pass runs less often.

Both are pure cadence levers — they change update frequency, not behavior or graph semantics.

**Measuring the combined cost** (developer recipe, not gameplay): on a turn where both mods fire, the debug logs report Emigration's pass duration and Demographics' sample duration; opening the **Migration** page exercises the shared render core. Comparing those three tells you whether a turn spike is the Emigration pass, the Demographics sample, or the embedded page — the cross-mod bridge itself is a thin read-only layer over each mod's existing tallies.

## 9. Install and run

1. Subscribe, or place the `demographics` folder in the Mods directory:
   - Windows: `%localappdata%/Firaxis Games/Sid Meier's Civilization VII/Mods/`
   - macOS: `~/Library/Application Support/Civilization VII/Mods/`
2. Enable Demographics in Additional Content.

## 10. Usage

- Open from the Demographics icon in the subsystem dock.
- Top tabs switch views. In Historical Data, the second row picks a metric page and the third picks the metric; in World Rankings, the second row switches between the rankings, All Civilizations, and settlement boards.

## 11. Compatibility

- Does not overwrite base-game files.
- All engine reads are defensive: schema drift yields missing data, not crashes.
- Persistence uses the GameConfiguration store (`Configuration.editGame()` / `getGame()`). If that API is unavailable, history is kept in memory for the session only.

## Credits & license

- robk: Demographics (Civ V).
- Gedemon: CivGraphs (Civ VI).
- Slothoth: Global Relations (Civ VII).
- The Civilization modding community for documentation, samples, and testing.
- Tower: Civilization VII rebuild.

MIT. See [LICENSE](LICENSE).
