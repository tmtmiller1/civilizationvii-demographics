<p align="center">
  <img src="docs/workshop-preview.png" width="148" alt="Demographics logo">
</p>

<h1 align="center">Demographics</h1>

<p align="center">
  <em>The stats screen Civilization VII is missing.</em><br>
  Per-turn graphs, rankings, and diplomacy views for every civilization in the game.
</p>

<p align="center">
  <a href="https://github.com/tmtmiller1/civilizationvii-demographics/releases/latest"><img src="https://img.shields.io/github/v/release/tmtmiller1/civilizationvii-demographics?label=release&amp;color=c9a24a" alt="Latest release"></a>
  <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=3737200066"><img src="https://img.shields.io/badge/Steam%20Workshop-subscribe-1b2838?logo=steam" alt="Steam Workshop"></a>
  <img src="https://img.shields.io/badge/Civilization%20VII-1.5.0-1f2a44" alt="Civilization VII 1.5.0">
  <img src="https://img.shields.io/badge/languages-11-2e7d32" alt="11 languages">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-555555" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=3737200066"><strong>Subscribe on Steam</strong></a> ·
  <a href="https://github.com/tmtmiller1/civilizationvii-demographics/releases/latest"><strong>Download</strong></a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="README.pdf">Typeset PDF</a> ·
  <a href="#system-guide-and-feature-reference">Technical reference</a>
</p>

<p align="center">
  <a href="docs/screenshots/01-yields-gold-per-turn.jpg"><img src="docs/screenshots/01-yields-gold-per-turn.jpg" width="880" alt="Gold per turn for every civilization across Antiquity and Exploration, with crisis stages, wonders, and the age change marked on the timeline"></a>
</p>

*Demographics* samples every civilization each turn and turns what it records into charts, leaderboards, and diplomacy views. It reads the game and never changes it: no yields, balance, or AI behavior are touched.

## At a glance

- **Global Statistics:** per-turn line charts of yields, economy, resources, society, religion, land, and settlements, with every civilization on one plot and history carried across age changes.
- **Geopolitics:** a diplomacy ring of the civilizations and city-states you have met, agreements over time, each crisis broken down stage by stage, soft-power comparisons, and a full military record with a timeline of every war.
- **World Rankings:** civilization and settlement leaderboards, a sortable rank-by-yield table for each, and a Top 25 settlements board that can fly the camera to any city.
- **Real-world scale:** populations in the thousands to tens of millions by era, GDP in dollars, and territory in km².
- **Your view, your way:** per-civ colors, time-range filters, hide and focus, civ-or-leader labels, colorblind mode, CSV export, and a Basic mode that shows only the core pages.
- **Companion-ready:** the *Emigration* mod adds its own tab, and any mod can add metrics or pages through a small public API.

Built on the foundations of robk's InfoAddict (Civ V), Gedemon's CivGraphs (Civ VI), and Slothoth's Global Relations panel (Civ VII). Open source, with full readable source included.

## Screenshots

<table>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/02-economy-gdp.jpg"><img src="docs/screenshots/02-economy-gdp.jpg" alt="GDP over time for every civilization"></a><br><sub>GDP over time, shown in real-world dollars</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/03-resources-stacked.jpg"><img src="docs/screenshots/03-resources-stacked.jpg" alt="Resources stacked by type for one civilization"></a><br><sub>Resources held, stacked by type</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/04-wonder-races.jpg"><img src="docs/screenshots/04-wonder-races.jpg" alt="Wonder Races: the first civilization to build each wonder"></a><br><sub>Wonder Races: who built each wonder first, and when</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/05-triumphs-radar.jpg"><img src="docs/screenshots/05-triumphs-radar.jpg" alt="Triumphs radar comparing Legacy Path progress"></a><br><sub>Triumphs radar: Legacy Path progress side by side</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/06-land-area-share.jpg"><img src="docs/screenshots/06-land-area-share.jpg" alt="Each civilization's share of the world's land over time"></a><br><sub>Share of the world's land over time</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/07-settlement-sizes.jpg"><img src="docs/screenshots/07-settlement-sizes.jpg" alt="Settlement size distribution and the most urbanized settlements"></a><br><sub>Settlement sizes and the most urbanized settlements</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/08-global-relations.jpg"><img src="docs/screenshots/08-global-relations.jpg" alt="Global Relations ring of met civilizations"></a><br><sub>Global Relations: wars, alliances, and attitudes between met civilizations</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/09-crisis-impact.jpg"><img src="docs/screenshots/09-crisis-impact.jpg" alt="Crisis Impact: per-civilization cost of each crisis stage"></a><br><sub>Crisis Impact: what each stage of the crisis cost every civilization</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/10-crisis-impact-graphs.jpg"><img src="docs/screenshots/10-crisis-impact-graphs.jpg" alt="Crisis Impact Graphs: each crisis statistic per civilization"></a><br><sub>Crisis Impact Graphs: each loss charted across the crisis</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/11-power-race.jpg"><img src="docs/screenshots/11-power-race.jpg" alt="Power Race: rank by score over time"></a><br><sub>Power Race: every civilization's score rank, turn by turn</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/12-power-archetype.jpg"><img src="docs/screenshots/12-power-archetype.jpg" alt="Power Archetype radar comparing every civilization"></a><br><sub>Archetype: science, military, economy, culture, people, and land compared</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/13-military-power.jpg"><img src="docs/screenshots/13-military-power.jpg" alt="Military power over time"></a><br><sub>Military power over time</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/14-war-timeline.jpg"><img src="docs/screenshots/14-war-timeline.jpg" alt="War Timeline: every war of the game on one chart"></a><br><sub>War Timeline: every war this game, with its generated name</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/15-civilization-ranking.jpg"><img src="docs/screenshots/15-civilization-ranking.jpg" alt="Civilization Ranking podium and full list"></a><br><sub>Civilization Ranking</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/16-civilization-rank-by-yield.jpg"><img src="docs/screenshots/16-civilization-rank-by-yield.jpg" alt="Civilization Rank by Yield: category leaders and a sortable rank table"></a><br><sub>Civilization Rank by Yield: category leaders and a sortable table</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/17-top-25-settlements.jpg"><img src="docs/screenshots/17-top-25-settlements.jpg" alt="Top 25 Settlements board with map fly-to buttons"></a><br><sub>Top 25 Settlements, with View on map and Cinematic view</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/18-settlement-rank-by-yield.jpg"><img src="docs/screenshots/18-settlement-rank-by-yield.jpg" alt="Settlement Rank by Yield table"></a><br><sub>Settlement Rank by Yield, filterable to cities or towns</sub></td><td width="50%"></td></tr>
</table>

Every view of the dashboard, 64 screenshots in all, is attached to each [GitHub release](https://github.com/tmtmiller1/civilizationvii-demographics/releases/latest).

---

## System Guide and Feature Reference

## Contents

1. [Layout](#1-layout)
2. [Global Statistics](#2-global-statistics)
3. [Geopolitics](#3-geopolitics)
4. [World Rankings](#4-world-rankings)
5. [Conflicts and crises](#5-conflicts-and-crises)
6. [How the figures are calculated](#6-how-the-figures-are-calculated)
7. [Behavior and persistence](#7-behavior-and-persistence)
8. [Companion-mod integration](#8-companion-mod-integration)
9. [Install and run](#9-install-and-run)
10. [Usage](#10-usage)
11. [Compatibility](#11-compatibility)

---

## 1. Layout

The dashboard has three rows of navigation:

- **Top tabs** pick a hub: **Global Statistics**, **Geopolitics**, and **World Rankings**. When the *Emigration* companion mod is installed, an **Emigration** tab appears beside them.
- **Page tabs** pick a page within the hub (for example *Yields Per Turn* or *Military Power*).
- **Metric pills** pick the chart on that page.

Every chart page shares one toolbar: a time-range filter (25 to 1000 years, current age, a single age, or all time), a **Civ → Leader** / **Leader → Civ** label order, a time-axis mode, wonder markers on or off, **Copy as CSV**, and an **Options** button. Charts mark each crisis stage and age change as a vertical line, and wonders as icons on the line of the civilization that built them. The legend toggles civilizations on and off.

Settings live in the game's own **Options** screen, under **Mods → Demographics**. The **Options** button opens it directly on top of the dashboard.

## 2. Global Statistics

Per-turn history for every met civilization, on five pages:

- **Yields Per Turn:** Gold, Production, Food, Science, Culture, Influence, and Happiness per turn.
- **Economy & Resources:** GDP, Treasury, Trade Routes, Total Resources, a stacked chart of one civilization's resources by type, and separate Bonus, Empire, and City resource counts, plus Treasure resources in Exploration and Factory resources in the Modern age.
- **Society:** Great Works, Techs, Civics, Wonders, a **Wonders Board** listing each civilization's wonders with the turn they were built, **Wonder Races** showing who built each wonder first, Natural Wonders Discovered, and a **Triumphs Radar** of Legacy Path progress. Faith, Tourism, and Great People appear once any civilization has recorded a value for them.
- **Religion:** in Antiquity, the pantheons each civilization chose and their yields; from Exploration on, religion standings (settlements following each religion), religious spread over time, and followers by population.
- **Land & Settlements:** Land Area, each civilization's share of the world's land, settlements over time, a settlement-size distribution with the most urbanized settlements, settlement-cap use and the cap over time, city and town counts, and boards of quarters and buildings constructed by type.

Without *Emigration*, **Population** sits on the Society page. With it, Population and Population Share move to the Emigration tab's first page, beside the migration charts.

## 3. Geopolitics

- **Global Relations:** a ring with your civilization and the civilizations you have met, switchable to **City States**. Edges show wars, alliances, open borders, denouncements, and attitudes; a second view, **Agreements**, draws the active agreements between civilizations. Colorblind mode switches to a high-contrast palette.
- **Agreements:** Diplomatic Approval and Ongoing Deals over time.
- **Crises:** **Crisis Impact** (per-stage cost tables, see §5) and **Crisis Impact Graphs** (each crisis statistic charted per civilization).
- **Soft Power:** Score, the **Power Race** (every civilization's score rank, turn by turn), three scatter plots (Power & Science, Wealth & Culture, Happiness & Influence), and an **Archetype** radar comparing science, military, economy, culture, people, and land.
- **Military Power:** Military Power, Units Killed, Units Lost, Battles, Wars Declared, Wars Received, Settlements Conquered, Conquest %, the **War Timeline**, **War Impact** (see §5), and boards of units trained, kills, and losses by unit type.

## 4. World Rankings

Four pages:

- **Civilization Ranking:** a podium of the three strongest civilizations and the full list ordered by cumulative settlement score, with population and settlement counts.
- **Civilization Rank by Yield:** category leaders for every tracked figure, then a table of every civilization's rank in each; click a column to sort, and switch between **Rank** and **Value**.
- **Top 25 Settlements:** a podium and ranked list of the strongest settlements. **View on map** snaps the camera to the city and **Cinematic view** plays a smooth orbit of it; with the experimental flyby enabled in Options, a short keyframed flyby is also available.
- **Settlement Rank by Yield:** category leaders and a sortable table of every settlement's population and yields, filterable to **All**, **Cities**, or **Towns**.

Civilizations you have not met show as placeholders unless name revelation is enabled in Options.

## 5. Conflicts and crises

The **War Timeline** is a Gantt chart of wars from diplomacy events (declarer, supporters, opposers, and a stable war ID), each with a generated name. **War Impact** picks one war and charts each combatant's trajectory through it: military strength, units lost, production directed to war, settlements and land lost or gained, settlements razed, population lost, and more. War cost is the observed change in each side's figures across the war, derived from the recorded samples (not invented).

**Crisis Impact** breaks each age's crisis into its stages (Begins, Intensifies, Culminates, Ends), each with a per-civ cost table, then a per-crisis cumulative-impact table and, once crises span more than one age, a cross-age overall total. Because the loss figures are sums of per-turn declines (which need dense samples), each finished age's cumulative cost is captured when that age ends, so it stays accurate even after old samples are thinned to cap the save.

---

## 6. How the figures are calculated

Every number is **derived from what the mod can observe by sampling the game each turn**, not read from a hidden engine ledger. Each turn it records a snapshot of every met civilization's raw figures; the charts and tables compute everything from those snapshots. Two consequences follow: a figure can only be as fine-grained as the sampling (see §7), and "loss"-type figures are inferred from how a value moved over time rather than from an authoritative casualty log.

### Direct reads

Most metrics are read straight off the player each turn with no transform: the per-turn yields (Gold/Production/Science/Culture/Influence/Happiness per turn, net), and the counts (Settlements, Techs, Civics, Wonders, Trade Routes, Ongoing Deals). These plot as-is.

### Derived and rescaled figures

A few figures apply a deterministic transform so the raw game number reads at a believable real-world scale. These are **cosmetic** and never affect gameplay:

- **Population (scaled):** derived from **Civilization VII's own per-era growth formula** (the food cost the game charges to grow a settlement, which differs by age), turned into a representative people count by a single calibration constant. Each settlement is valued for *whatever age it's in* — towns in the thousands, great cities up to ~1M pre-modern, and 10–38M megacities only in the Modern age — with a smooth, continuous hand-off across age boundaries (no jump at an age change) and an upper safety bound. A small per-settlement variation, drawn from real signals (happiness, urban/rural mix, growth trend), keeps any two same-size settlements from reading identically. The **civ-wide** figure is the **sum of its settlements'** estimates (not a separate, hotter aggregate), so "empire" and "sum of cities" agree. (The Emigration companion mod shares this exact curve, pinned by a cross-mod test.)
- **GDP:** a weighted sum of the per-turn yields, `× turn × 1,000,000`, shown in `$M`/`$B`. Weights: Gold 1.0, Production 1.0, Food 0.5, Science 1.2, Culture 1.2, Influence 1.5. Multiplying by the turn count approximates a cumulative economy rather than a single turn's output; the turn factor is capped at 300 so very long games and slow speeds keep a comparable scale.
- **Score:** `techs + civics + 2 × settlements + ⌊gold ÷ 100⌋`, with techs and civics counted cumulatively across ages so the line never drops at an age change. The **Power Race** plots each civilization's rank by this score.
- **Land Area:** `owned_tiles × 7,000 km²` (a hex's nominal real-world area).
- **Military Power:** the summed combat strength of the civ's military units, totaled in the sampler (there is no clean player-level engine accessor).
- **Diplomatic Approval:** a reputation aggregate. Each met major civ contributes by relationship (Allied +5, Helpful +3, Friendly +2, Neutral 0, Unfriendly -2, Hostile -3, At War -5); suzerained city-states contribute the same weights at `× 0.3`.
- **Settlement Cap Utilization:** `settlements ÷ settlement_cap × 100`.
- **Land Area Share** and **Population Share:** each civilization's land (or population) as a share of the total held by all charted civilizations that turn, stacked to 100%.
- **Conquest %:** settlements a civilization has conquered, as a percentage of the settlements it holds now.
- **Crisis Stage:** the engine's internal stage (pre-crisis -1 through 3) shifted up by one so it reads "Stage 1" to "Stage 4" and plots cleanly as a step.

### War and crisis cost

War costs (the per-combatant tables) and crisis costs (the per-civ stage and cumulative tables) share one engine: each figure is a participant's metric series reduced over its **active window** (`[join turn, leave turn or war/age end]`) by a mode chosen per figure:

- **Losses** (Strength Lost, Population/Crop/Production Lost): the **sum of every turn-over-turn decline** in the series, with rises ignored so ordinary growth can never mask a loss. This needs reasonably dense samples to catch each dip (see the caveat below). Population Lost reads **raw** population, not the rescaled chart value, so neither the people-scaling nor the age-reset bridge on the Population chart can hide real drops.
- **Net** (Settlements, Land): `last − first` over the window, signed (`+gained` / `-lost`). These are event-based (cities/territory that actually changed hands by capture), so they read "-" for wars that predate the tracking rather than a misleading 0.
- **Accrued / Spent** (Settlements Razed, Production Directed to War, Refugees): the increase of a cumulative event counter over the window (`last − first`).
- **Level** (current Military Power): the last sampled value, a standing figure rather than a flow.
- **Casualties** (Military Strength Lost) prefer the engine's cumulative units-killed counter when present (true kills), falling back to the standing-army decline for older saves.

A crisis's cumulative impact sums these across its stages, and a finished age's cumulative is **snapshotted when that age ends** so it survives later sample thinning (§5).

### Caveat: sampling resolution

Because losses are summed from per-turn dips, coarse sampling (or the decimation of old samples that caps long games, §7) can **under-count** a loss, and on a heavily thinned window a loss figure drops to "-" rather than guess. Standing figures (current Military Power, counts) survive on a single sample. This is why the loss math reads raw, ignores rises, and why crisis cumulatives are snapshotted at their age boundary.

## 7. Behavior and persistence

- Settings persist in `localStorage`. Recorded history persists per save game via the GameConfiguration store, carrying across quit/load and age transitions.
- History sample caps are **automatic**: they scale with game speed and adapt to hardware (CPU cores / device memory / mobile) and game size (player count), shrinking retention on weak machines and many-civ games (floored so history is never starved). Chart rendering is additionally clamped to a per-series point budget scaled by the same capability factor, so a marathon-length line plots a bounded number of points after the visible-range filter.
- **Complexity** (game Options → Mods → Demographics) sets how much of the dashboard is shown: **Basic** shows the core pages (Yields Per Turn, Economy & Resources, Society, Land & Settlements, Population, Global Relations, Military Power); **Standard** (default) and **Analyst** show every page, adding Religion, Agreements, Crises, and Soft Power.
- Colorblind mode swaps chart and relationship colors to a colorblind-safe set.
- **Spoiler guard** (on by default, Options → Mods → Demographics) hides the names, charts, and diplomacy and relations stats of civilizations you haven't met, so unmet civilizations render as placeholders and their lines show a gap. **History on first contact** chooses whether meeting a civilization reveals its full back-history or tracks it only from first contact. A banner below the views states the active analytics policy.
- Multiplayer governance: an analytics policy stored in the shared `GameConfiguration` is enforced as a ceiling for every player that game — clients drop any civ the host's policy hides, and the banner notes when the host (rather than a local preference) is the binding constraint.

## 8. Companion-mod integration

Other mods can contribute to the dashboard through an optional, order-independent API on `globalThis.DemographicsMetricsAPI` (inert unless called, so the base mod is unchanged):

- **`registerMetric(spec)`**: add a per-civ line-chart metric that flows through the normal sample, store, and chart pipeline. A spec may include a `tooltipAttribution(ctx)` callback whose returned string is shown as a source-attribution line in that metric's tooltip.
- **`registerMetricToPage(pageId, metricId, afterMetricId?)`**: place the metric's tab on an existing page (for example, next to Population).
- **`registerMetricGroup(spec)`**: collapse several related metrics behind one tab with up to two pill-row toggles (a metric row and a view/units row), charting one member at a time. Member metrics stay individually registered (and sampled); the group just picks which one is shown.
- **`registerPanel(spec)`**: contribute a whole **page** (optionally with its own sub-tabs) whose body the companion renders itself. The screen adds it as its own top-level tab and calls `spec.render(container, ctx, subId)` to fill it (the chart title, time-range filter, and CSV toolbar are suppressed for these custom pages). Demographics gains no dependency on the companion.

The handshake is load-order-independent: registrations made before this screen loads are queued and drained when it initializes. The companion **Emigration** mod uses all of these, contributing an **Emigration** tab whose **Population & Migration** page charts Population, Population Share, Net Migration, Emigration, Immigration, and Refugees in either scaled "people" or raw Civ population numbers, with cause-breakdown tooltips and war/disaster event markers — alongside its own Network, Causes, My Cities, Diversity, Policies, Notifications, and Guide pages.

### Performance on large saves (with Emigration installed)

If late-game turns feel heavy with both mods active, **raise Emigration's *How often migration runs*** (game Options → Mods → Emigration → Advanced, Pacing group) so its migration pass runs less often. This is a pure cadence lever: it changes how often migration updates, not behavior or graph semantics. (Demographics' own sampling cadence is automatic and adapts to hardware/game size, so there's no manual frequency knob to tune.)

**Measuring the combined cost** (developer recipe, not gameplay): on a turn where both mods fire, the debug logs report Emigration's pass duration and Demographics' sample duration; opening the **Emigration** tab exercises the shared render core. Comparing those three tells you whether a turn spike is the Emigration pass, the Demographics sample, or the embedded page: the cross-mod bridge itself is a thin read-only layer over each mod's existing tallies.

## 9. Install and run

1. Subscribe, or place the `demographics` folder in the Mods directory:
   - Windows: `%localappdata%/Firaxis Games/Sid Meier's Civilization VII/Mods/`
   - macOS: `~/Library/Application Support/Civilization VII/Mods/`
2. Enable Demographics in Additional Content.

## 10. Usage

- Open from the Demographics button in the subsystem dock, the pause menu, or the end-of-game screen.
- The top tabs pick a hub (Global Statistics, Geopolitics, World Rankings, plus **Emigration** when that companion mod is installed), the second row picks a page, and the pill row picks the chart.
- The **Options** button (in the chart toolbar, and at the top right of Global Relations and World Rankings) opens the game's Options screen at **Mods → Demographics**.

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
