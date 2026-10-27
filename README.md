<p align="center">
  <img src="docs/workshop-preview.png" width="148" alt="Demographics logo">
</p>

# Demographics

A Civilization VII mod. Open the Demographics screen at any point in a game and see how every civilization has done
since the first turn: per-turn graphs of yields, economy, land and military, rankings of civilizations and
settlements, the diplomacy between them, every war and crisis, and the story of your campaign told age by age. A Hall
of Fame ranks every campaign you have played, and opens from the main menu too.

The mod samples every civilization each turn and builds everything it shows from those samples. It only reads the
game, so yields, balance and the AI play exactly as they would without it.

<p align="center">
  <a href="docs/screenshots/01-yields-gold-per-turn.jpg"><img src="docs/screenshots/01-yields-gold-per-turn.jpg" width="880" alt="Gold per turn for every civilization across Antiquity and Exploration, with crisis stages, wonders, and the age change marked on the timeline"></a>
</p>

*Gold per turn for every civilization across Antiquity and Exploration, with the crisis stages, the wonders and the
age change marked on the timeline.*

[Subscribe on Steam](https://steamcommunity.com/sharedfiles/filedetails/?id=3737200066) ·
[Download the latest release](https://github.com/tmtmiller1/civilizationvii-demographics/releases/latest) ·
[Changelog](CHANGELOG.md) · [This page as a PDF](README.pdf)

---

## What the player does

Open the screen from the Demographics button in the subsystem dock, from the pause menu, or from the end-of-game
screen, where it opens on the Hall of Fame. The **Hall of Fame** button on the main menu shows past campaigns with no
game loaded. **Escape** closes either one.

The screen has three rows of navigation. The top tabs pick a hub: **Global Statistics**, **Geopolitics**,
**History** and **World Rankings**, plus **Emigration** when that companion mod is installed. The page tabs under
them pick a page, such as *Yields Per Turn* or *Military Power*, and the metric pills pick the chart on that page.

Every chart page shares one toolbar: a time range (25 to 1000 years, the current age, a single age, or all time), the
label order (**Civ → Leader** or **Leader → Civ**), the time-axis mode, wonder markers on or off, and **Copy as
CSV**. Charts mark each crisis stage and age change with a vertical line, and each wonder with its icon on the line
of the civilization that built it. Clicking a civilization in the legend hides or shows it.

The **Options** button and the active analytics policy sit together at the top right of every tab, level with the
title. The button opens the game's own Options screen at **Mods → Demographics**, where every setting lives.

## Global Statistics

Per-turn history for every civilization you have met, on five pages:

- **Yields Per Turn:** Gold, Production, Food, Science, Culture, Influence and Happiness per turn.
- **Economy & Resources:** GDP, Treasury, Trade Routes, Total Resources, a stacked chart of one civilization's
  resources by type, and separate Bonus, Empire and City resource counts, plus Treasure resources in Exploration and
  Factory resources in the Modern age.
- **Society:** Great Works, Techs, Civics, Wonders, a **Wonders Board** listing each civilization's wonders with the
  turn they were built, **Wonder Races** showing who built each wonder first, Natural Wonders Discovered, and a
  **Triumphs Radar** of Legacy Path progress. Faith, Tourism and Great People appear once any civilization has
  recorded a value for them.
- **Religion:** in Antiquity, the pantheons each civilization chose and their yields; from Exploration on, religion
  standings (settlements following each religion), religious spread over time, and followers by population.
- **Land & Settlements:** Land Area, each civilization's share of the world's land, settlements over time, a
  settlement-size distribution with the most urbanized settlements, settlement-cap use and the cap over time, city
  and town counts, and boards of quarters and buildings constructed by type.

Without *Emigration*, **Population** sits on the Society page. With it, Population and Population Share move to the
Emigration tab's first page, beside the migration charts.

## Geopolitics

- **Global Relations:** a ring of your civilization and the civilizations you have met, switchable to **City
  States**. Its lines show wars, alliances, open borders, denouncements and attitudes; a second view, **Agreements**,
  draws the active agreements between civilizations.
- **Agreements:** Diplomatic Approval and Ongoing Deals over time.
- **Crises:** **Crisis Impact**, the cost of each crisis stage per civilization, and **Crisis Impact Graphs**, each
  crisis statistic charted per civilization.
- **Soft Power:** Score, the **Power Race** (every civilization's score rank, turn by turn), three scatter plots
  (Power & Science, Wealth & Culture, Happiness & Influence), and an **Archetype** radar comparing science, military,
  economy, culture, people and land.
- **Military Power:** Military Power, Units Killed, Units Lost, Battles, Wars Declared, Wars Received, Settlements
  Conquered, Conquest %, the **War Timeline**, **War Impact**, and boards of units trained, kills and losses by unit
  type.

### Wars and crises

The **War Timeline** is a Gantt chart of every war, built from diplomacy events: the declarer, the supporters and the
opposers share one war, so a coalition reads as a single conflict, and each war gets a generated name. **War Impact**
picks one war and charts each side through it: military strength, units lost, production directed to war,
settlements and land lost or gained, settlements razed, population lost, and more.

**Crisis Impact** splits each age's crisis into its stages (Begins, Intensifies, Culminates, Ends), each with a cost
table per civilization, then a cumulative table for the whole crisis and, once crises span more than one age, a
total across ages.

## History

Three pages, recorded from the moment Demographics is active in a game. When the mod is added to a game already in
progress, the chronicle starts from that turn and the first age's summary says so.

**Chronicle** tells the campaign's history age by age. Each age opens with a summary of your civilization's deeds
(settlements founded, captured and lost, wonders, Triumphs, wars, the religion you founded, civilizations
destroyed), followed by every recorded event in order: settlements founded, taken or lost, wonders completed, wars
and peace, religions founded, Triumphs earned, crisis stages, natural disasters that struck a civilization's land,
first contacts, eliminations, new ages and victories. Pills filter by age and by kind of event, and the order can run
newest or oldest first. Events involving civilizations you have not met are hidden and counted, following the
analytics policy.

**Timeline** puts the whole game on one scrolling chart. A banner for each age carries your civilization's emblem and
the age's dates. Below it run lanes for your wars (in the enemy's color, with their emblem) and the age crises stage by
stage, then one lane per kind of milestone (**Wonders**, **Triumphs**, **Religion**, **Conquests**, **Victory &
falls**) drawn with the game's own icons, then every settlement founded, natural disasters, migration in and out (with
the *Emigration* mod), the population curve with its milestones, and a turn ruler.

Pills show all ages or one, zoom runs from 1× to 8× with pan buttons, clicking the ruler moves the cursor, and
**Play** sweeps through the game, naming each event as it passes. Everything on the chart has a tooltip, and hovering
the population lane or the ruler reads out the turn and population under the mouse.

The row above the timeline picks whose story it shows. Every game opens on your own civilization; add any
civilization you met, or **All**, to put their milestones, settlements, wars with each other, disasters on their land
and population line on the same lanes.

Above the timeline, a territory map lays the world out like the game's own minimap, one cell per tile: terrain by
biome, each civilization's land tinted in its color, independent land in gray, settlements marked, and land you had
not yet explored left blank. It follows the timeline's cursor, so playback replays both the expansion and your
exploration. Civilizations you have not met stay off the map.

**Lineage** has one row per leader and one column per age: each cell is the civilization that leader led in that
age, in the leader's color, with the turn a line ended.

## World Rankings

- **Civilization Ranking:** a podium of the three strongest civilizations, each with its capital and **View on map**
  / **Cinematic view** buttons, and the full list ordered by cumulative settlement score, with population and
  settlement counts.
- **Civilization Rank by Yield:** every civilization's rank, or its value with **Rank / Value**, in each tracked
  figure, in two tables that share one sort: the rates and yields first, then **Totals & Tallies** (land, cities and
  towns, conquests, units, great works, migration). Click any column to sort both.
- **Top 25 Settlements:** a podium and ranked list of the strongest settlements. Each row shows the settlement's
  wonders (hover one for the year it was completed), a **Holy City** badge with the religion's icon when it is a
  religion's holy city, and small icons under the rank for every output it leads the world in. **View on map** snaps
  the camera to the city and **Cinematic view** orbits it; the experimental flyby, on by default in Options, adds a
  short keyframed flight. Once an age ends, a pill for it (for example **End of Antiquity**) shows that age's final
  top ten.
- **Settlement Rank by Yield:** a sortable table of every settlement's population and yields, filterable to **All**,
  **Cities** or **Towns**.
- **Hall of Fame:** the campaigns played on this computer (below).

Across the first four, places 1–3 carry a gold, silver or bronze wash, your own civilization and settlements are
outlined in gold, and in the two tables the cell of whoever leads each column is highlighted in gold (hover it for the
category). Civilizations you have not met show as placeholders unless name revelation is enabled in Options.

### Hall of Fame

The Hall of Fame lists the campaigns played on this computer, the current one included as it is played: every
finished game, and your 20 most recent unfinished ones. An unfinished game under 20 turns is cleared once you start
another; load its save and play on, and it comes back. The line at the foot of the list says how many of each it
holds. The same view opens from the **Hall of Fame** button on the main menu, with no game loaded.

**Best Games** opens first: your totals, a podium of your three best games, the rest of your top ten, and the game you
are playing at its rank between the games just above and below it (from the main menu, your most recent game), with
victories by type. **Rankings** orders the games by result (victories first), then Triumphs earned across every age,
then fewest turns, and gives each an honorific from Augustus Caesar down to Ethelred the Unready.

**Leaders** and **Civilizations** give each one a win rate over finished games, drawn as a bar that is green for the
games won and red for the rest, with the attempts, most Triumphs and average length beside it. **Records** names the
game that holds each record: most Triumphs, most wonders, largest empire, most settlements taken, fastest victory,
longest game.

Any game opens a page with its lineage and figures, the territory map beside its rivals, the game's timeline with
playback, and its highlights age by age, where each Triumph says what it was earned for and what it gave. **Game
options** at the foot of that page removes the game from the Hall of Fame.

**Hide short games / Show all games** sits under the section tabs on every page. Unfinished games under 20 turns are
hidden by default as test loads, and the row says how many it is hiding.

## Screenshots

<table>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/02-economy-gdp.jpg"><img src="docs/screenshots/02-economy-gdp.jpg" alt="GDP over time for every civilization"></a><br><sub>GDP over time, shown in real-world dollars</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/03-resources-stacked.jpg"><img src="docs/screenshots/03-resources-stacked.jpg" alt="Resources stacked by type for one civilization"></a><br><sub>Resources held, stacked by type</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/04-wonder-races.jpg"><img src="docs/screenshots/04-wonder-races.jpg" alt="Wonder Races: the first civilization to build each wonder"></a><br><sub>Wonder Races: who built each wonder first, and when</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/05-triumphs-radar.jpg"><img src="docs/screenshots/05-triumphs-radar.jpg" alt="Triumphs radar comparing Legacy Path progress"></a><br><sub>Triumphs radar: Legacy Path progress side by side</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/06-land-area-share.jpg"><img src="docs/screenshots/06-land-area-share.jpg" alt="Each civilization's share of the world's land over time"></a><br><sub>Share of the world's land over time</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/07-settlement-sizes.jpg"><img src="docs/screenshots/07-settlement-sizes.jpg" alt="Settlement size distribution and the most urbanized settlements"></a><br><sub>Settlement sizes and the most urbanized settlements</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/08-global-relations.jpg"><img src="docs/screenshots/08-global-relations.jpg" alt="Global Relations ring of met civilizations"></a><br><sub>Global Relations: wars, alliances and attitudes between met civilizations</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/09-crisis-impact.jpg"><img src="docs/screenshots/09-crisis-impact.jpg" alt="Crisis Impact: per-civilization cost of each crisis stage"></a><br><sub>Crisis Impact: what each stage of the crisis cost every civilization</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/11-power-race.jpg"><img src="docs/screenshots/11-power-race.jpg" alt="Power Race: rank by score over time"></a><br><sub>Power Race: every civilization's score rank, turn by turn</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/12-power-archetype.jpg"><img src="docs/screenshots/12-power-archetype.jpg" alt="Power Archetype radar comparing every civilization"></a><br><sub>Archetype: science, military, economy, culture, people and land compared</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/14-war-timeline.jpg"><img src="docs/screenshots/14-war-timeline.jpg" alt="War Timeline: every war of the game on one chart"></a><br><sub>War Timeline: every war this game, with its generated name</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/15-civilization-ranking.jpg"><img src="docs/screenshots/15-civilization-ranking.jpg" alt="Civilization Ranking podium and full list"></a><br><sub>Civilization Ranking</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/16-civilization-rank-by-yield.jpg"><img src="docs/screenshots/16-civilization-rank-by-yield.jpg" alt="Civilization Rank by Yield: a sortable rank table with each column's leader highlighted"></a><br><sub>Civilization Rank by Yield, with Totals &amp; Tallies below</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/17-top-25-settlements.jpg"><img src="docs/screenshots/17-top-25-settlements.jpg" alt="Top 25 Settlements board with holy-city badges and map fly-to buttons"></a><br><sub>Top 25 Settlements: holy cities, world leaders and map fly-to</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/21-history-chronicle.jpg"><img src="docs/screenshots/21-history-chronicle.jpg" alt="History: the Chronicle of a campaign, age by age"></a><br><sub>Chronicle: your campaign told age by age</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/22-history-timeline.jpg"><img src="docs/screenshots/22-history-timeline.jpg" alt="History: the Timeline with every civilization shown, and the territory map"></a><br><sub>Timeline: wars, crises, wonders, Triumphs, settlements, disasters and population, with the territory map</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/23-history-timeline-playback.jpg"><img src="docs/screenshots/23-history-timeline-playback.jpg" alt="History: Timeline playback paused mid-game, with the map rewound to that turn"></a><br><sub>Play replays the game: the map and caption follow the cursor</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/24-history-lineage.jpg"><img src="docs/screenshots/24-history-lineage.jpg" alt="History: Lineage of every leader and the civilization they led in each age"></a><br><sub>Lineage: every leader and the civilizations they led</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/27-hall-of-fame-best-games.jpg"><img src="docs/screenshots/27-hall-of-fame-best-games.jpg" alt="Hall of Fame: Best Games, a podium of the three best games, the rest of the top ten, and this game at its rank"></a><br><sub>Best Games: your finest playthroughs, and this game in context</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/25-hall-of-fame-game.jpg"><img src="docs/screenshots/25-hall-of-fame-game.jpg" alt="Hall of Fame: a game's page in game, with figures, map, rivals, timeline and highlights"></a><br><sub>A game's page in the Hall of Fame</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/28-hall-of-fame-rankings.jpg"><img src="docs/screenshots/28-hall-of-fame-rankings.jpg" alt="Hall of Fame rankings with honorifics"></a><br><sub>Rankings, each game with its honorific</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/29-hall-of-fame-leaders.jpg"><img src="docs/screenshots/29-hall-of-fame-leaders.jpg" alt="Hall of Fame: leader cards"></a><br><sub>Leaders you have played</sub></td></tr>
  <tr><td width="50%" align="center" valign="top"><a href="docs/screenshots/31-hall-of-fame-records.jpg"><img src="docs/screenshots/31-hall-of-fame-records.jpg" alt="Hall of Fame records"></a><br><sub>Records: the game that holds each one</sub></td><td width="50%" align="center" valign="top"><a href="docs/screenshots/38-cinematic-flyby.jpg"><img src="docs/screenshots/38-cinematic-flyby.jpg" alt="The cinematic flyby orbiting the world's greatest settlement, with its info panel at the bottom of the screen"></a><br><sub>Cinematic view: the camera tours a settlement's wonders and quarters</sub></td></tr>
</table>

Every view of the screen, the ones above and the rest, is in [docs/screenshots](docs/screenshots) and attached to
each [GitHub release](https://github.com/tmtmiller1/civilizationvii-demographics/releases/latest).

## Settings

Every setting is in the game's Options screen under **Mods → Demographics**.

- **Spoiler guard** (on by default) hides the names, charts, and diplomacy and relations figures of civilizations you
  have not met: they show as placeholders, and their lines show a gap. **History on first contact** chooses whether
  meeting a civilization reveals its whole history or only what follows the meeting. A banner below the views states
  the analytics policy in force.
- **Complexity** sets how much of the screen is shown. **Basic** shows the core pages: Yields Per Turn, Economy &
  Resources, Society, Land & Settlements, Population, Global Relations and Military Power. **Standard** (the
  default) shows every page, adding Religion, Agreements, Crises and Soft Power.
- **Colorblind mode** swaps chart and relationship colors for a colorblind-safe set.
- **Smooth chart lines** draws history lines as a 3-turn moving average; the recorded data is unchanged.
- Show eliminated civilizations; wonder, war and disaster markers on the charts; and the cinematic view, the flyby,
  its length and whether the camera may rotate.

The game's own **Font Size** setting scales every page of the screen.

### Display scaling

The screen is drawn as one uniformly scaled frame against a 2880x1800 reference, so the same layout reaches every
display rather than filling the screen at one resolution and crowding it at another. The scale has a lower bound and
text has its own, higher one, so nothing shrinks past reading size. 2880x1800 renders at full size; 3840x2160,
2560x1440, 1920x1080 and 1600x900 approximate it. 1366x768 and 1280x720, the smallest supported size, get a
small-screen layout that makes room for names on the ranking boards (see Known limits).

## Compatibility

- Adds its own screen and reads the game from there; base-game files and gameplay data stay as they are.
- Every read from the game is defensive: a missing or changed field means missing data, not a crash. A view that
  fails says "Chart failed to render" in its own panel, and the rest of the screen keeps working.
- The mod's CSS custom properties start with `--dg-`, so it styles only its own screen and leaves other mods'
  variables alone.
- Recorded history is saved in each save game, through the game configuration store, and carries across quitting,
  loading and age transitions. If that store is unavailable, history is kept for the session only.
- Multiplayer: the host's analytics policy is a ceiling for every player in the game, and the banner says when the
  host's policy, rather than your own setting, is what hides a civilization. In an internet, LAN or cloud game only
  the host writes the History campaign into the shared game configuration; guests keep it in memory and, on loading,
  take the host's copy with their own civilization as the viewpoint. Hotseat and single-player games store it as
  usual.
- With *Emigration*: Demographics hosts its tab and charts. If late-game turns feel heavy with both mods on, raise
  Emigration's *How often migration runs* (Options → Mods → Emigration → Advanced, Pacing group). It changes how
  often migration updates, not what it does. Demographics' own sampling adapts to the machine and the game by itself.
- With *Partisans*: each rising shows on the War Timeline as a thinner, hatched bar in the color of the civilization
  the people rose against, named for its settlement, with a tooltip that says why it began and how it ended. The
  Chronicle notes when a rising breaks out and when it ends, under its own **Risings** filter. Risings follow the same
  spoiler rules as wars, and your own always show. Demographics keeps its own record of them, so past risings stay on
  the timeline if you later remove Partisans.
- Carries the [Tower Settings Keeper](https://github.com/tmtmiller1/civilizationvii_tower-settings-keeper), so its
  settings, and other mods' settings in the shared entry, survive a restart (below).
- Translated into German, Spanish, French, Italian, Japanese, Korean, Polish, Brazilian Portuguese, Russian and
  Simplified Chinese, with each language's own number formatting.

### The Civilization VII storage bug

Civilization VII 1.5.0 has a bug in the storage mods use for their settings: whatever entry a mod asks for, the game
returns whichever mod's entry sorts first. Only that one mod's data works. The entry that Demographics and most mod
option panels share is never read back, so settings reset every launch. It is a game bug for Firaxis to fix, and a
reproduction is written up for their support portal.

The Hall of Fame's list of past games is kept out of that storage, in a file of its own,
`demographics-halloffame.sqlite`, in the game's user folder (`~/Library/Application Support/Civilization VII/` on a
Mac, `%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\` on Windows), so the bug doesn't reach it. The mod
finds that folder from the path of your newest save. If you have no save yet, or the file can't be opened or
written, the list goes in the shared entry as it did up to 2.10.0, and the next launch tries the file again.

Since 2.8.1 the mod carries the Tower Settings Keeper, which keeps every mod's settings inside the one entry the game
reads correctly and puts a store another mod has disturbed back in order, without deleting anything.

If the storage still can't be read, the Hall of Fame page says so: a notice box when its own list is blocked (only
when the file can't be used), or a note that your settings aren't being saved. Either one leads to **Repair mod
storage**. The repair empties the storage and starts it again with one entry, the shared settings entry most mod
option panels use, holding this mod's settings (and its past games, when they aren't in their own file). Being the
only entry, it is what the game returns, so the mods that keep their settings there load and save them normally from
then on. A mod with a separate entry of its own isn't helped: it couldn't read that entry before and still can't.

The repair permanently deletes the saved data of the one mod the game was reading for everyone, and clears what other
mods had written but could never read back. Saved games, the history inside them, the game's own settings and every
mod's files are untouched. The sheet says all of this before the button, the button says what it deletes, and it
takes two clicks with a Cancel. It is offered again if a mod later writes its own first-sorting entry. The whole
story: [docs/civ7-storage-bug.md](docs/civ7-storage-bug.md).

## Installation

1. Subscribe on the Steam Workshop, or download the zip from the
   [latest release](https://github.com/tmtmiller1/civilizationvii-demographics/releases/latest).
2. Unzip it so the `demographics` folder sits in the Civilization VII Mods directory:
   - Windows: `%localappdata%/Firaxis Games/Sid Meier's Civilization VII/Mods/`
   - macOS: `~/Library/Application Support/Civilization VII/Mods/`
3. Enable **Demographics** from Additional Content in-game.

---

## How the figures are calculated

Every number comes from what the mod can see by sampling the game each turn, not from a hidden engine ledger. Each
turn it records every civilization's raw figures, and the charts and tables compute everything from those snapshots.
Two things follow: a figure is only as fine-grained as the sampling, and losses are inferred from how a value moved
over time rather than read from a casualty log.

### Direct reads

Most figures are read straight off the player each turn and plotted as they are: the per-turn yields (Gold,
Production, Science, Culture, Influence and Happiness per turn, net) and the counts (Settlements, Techs, Civics,
Wonders, Trade Routes, Ongoing Deals).

### Derived and rescaled figures

A few figures apply a fixed transform so the game's number reads at a believable real-world scale. These are
cosmetic and never affect play.

- **Population (scaled):** derived from Civilization VII's own per-age growth formula (the food cost of growing a
  settlement, which differs by age) and turned into a count of people by one calibration constant. Each settlement
  is valued for the age it is in: towns in the thousands, great cities up to about a million before the Modern age,
  and megacities of 10 to 38 million only in the Modern age. The hand-off across an age change is continuous, and
  there is an upper safety bound. A small variation per settlement, drawn from its happiness, urban and rural mix
  and growth trend, keeps two settlements of the same size from reading identically. A civilization's figure is the
  sum of its settlements, so "empire" and "sum of cities" agree. The *Emigration* mod uses the same curve.
- **GDP:** a weighted sum of the per-turn yields, `× turn × 1,000,000`, shown in `$M` / `$B`. Weights: Gold 1.0,
  Production 1.0, Food 0.5, Science 1.2, Culture 1.2, Influence 1.5. Multiplying by the turn approximates a
  cumulative economy rather than one turn's output; the turn factor is capped at 300 so very long games and slow
  speeds keep a comparable scale.
- **Score:** `techs + civics + 2 × settlements + floor(gold ÷ 100)`, with techs and civics counted across ages so the
  line never drops at an age change. The **Power Race** plots each civilization's rank by this score.
- **Land Area:** `owned tiles × 7,000 km²`, a hex's nominal real-world area.
- **Military Power:** the summed combat strength of the civilization's military units.
- **Diplomatic Approval:** each met major civilization counts by relationship (Allied +5, Helpful +3, Friendly +2,
  Neutral 0, Unfriendly -2, Hostile -3, At War -5); city-states you are suzerain of count the same weights `× 0.3`.
- **Settlement Cap Utilization:** `settlements ÷ settlement cap × 100`.
- **Land Area Share** and **Population Share:** each civilization's land, or population, as a share of the total
  held by every charted civilization that turn, stacked to 100%.
- **Conquest %:** settlements a civilization has conquered, as a percentage of the settlements it holds now.
- **Crisis Stage:** the engine's stage (pre-crisis -1 through 3) shifted up by one, so it reads Stage 1 to Stage 4
  and plots as a step.

### War and crisis cost

War costs (the tables per combatant) and crisis costs (the stage and cumulative tables per civilization) are worked
out the same way: each figure is one participant's series over its active window, from the turn it joined to the turn
it left or the war or age ended, reduced by a mode chosen per figure.

- **Losses** (Population, Crop and Production Lost): the sum of every turn-over-turn decline, with rises ignored so
  ordinary growth never hides a loss. Population Lost reads raw population, not the scaled chart value, so neither
  the people scaling nor the age-change smoothing on the Population chart can hide a real drop.
- **Net** (Settlements, Land): `last − first` over the window, signed (`+gained` / `-lost`). These count cities and
  territory that changed hands by capture, so a war from before the tracking began reads "-" rather than a
  misleading 0.
- **Accrued / Spent** (Settlements Razed, Production Directed to War, Refugees): the increase of a running counter
  over the window.
- **Level** (current Military Power): the last sampled value, a standing figure rather than a flow.
- **Casualties** (Strength Lost): the combat strength of every unit killed in combat, which the mod adds up itself as
  the game reports each kill, so rebuilding the army doesn't hide a loss. A unit built and killed within one turn is
  missed, because the mod never saw its strength. History recorded before the mod counted kills falls back to the
  decline of the standing army.

A crisis's cumulative cost sums its stages. Because losses are sums of per-turn dips, they need dense samples, so each
finished age's cumulative cost is captured when that age ends and stays accurate after old samples are thinned.

### Sampling and the size of the save

Recorded history is capped automatically. The caps scale with game speed and adapt to the machine (processor cores,
memory) and to the number of players, with a floor so history is never starved. Old samples are thinned first, and
the history is thinned further once its saved size passes 3 MB, so a long game with many civilizations cannot grow the
save without limit. Charts also draw at most a set number of points per line, so a marathon game plots quickly.

Thinning is why a loss figure on a heavily thinned stretch can read "-" rather than a guess, while standing figures
(current Military Power, counts) survive on a single sample.

A value written by a newer Demographics, or one this build cannot parse, is kept beside its key and restored the next
time a build that can read it loads the save, so a save is safe to open in either build.

### The Hall of Fame record

The Hall of Fame keeps one compact record per campaign in `demographics-halloffame.sqlite`, its own file in the
game's user folder, so it can be read from the main menu (or in the shared `modSettings` entry when the file can't be
used; see the storage bug above). The first launch with a version that has the file moves the list there from
`modSettings`. Each save also carries its own campaign's record, which is added back to the Hall of
Fame whenever that save is played, and recording the same game again updates its one entry rather than adding
another.

Names are stored once for the whole archive rather than inside each game, so a full Hall of Fame keeps every game's
timeline. Territory maps are the largest part, so they are kept for the most recently played games. Past that, older
games give up their maps, then the other civilizations' timeline tracks, then their timelines, before any game is
dropped; the game being played is always kept whole.

## Known limits

- At 1366x768 and smaller, down to 1280x720, the smallest supported size, text stays as large as at 1920x1080, so the
  ranking boards switch to a small-screen layout to fit it. Names and headings there are one size smaller, the
  portraits beside names in the ranked lists and tables give their room to the names, Settlement Rank by Yield drops
  its Type column (the All, Cities and Towns buttons still split them), and table column headings wrap onto two
  lines. A long name can still end in "...", and hovering it shows it in full. 1600x900 and larger look the same as
  before.
- History starts when the mod is first active in a game. A game it is added to part-way through has no record of the
  turns before.
- Population, Crop and Production losses are inferred from how sampled figures moved, not read from the game, so a
  loss on a heavily thinned stretch of a long game can be under-counted or read "-". Strength Lost counts units as
  they're killed, so thinning doesn't under-count it.

---

## For mod authors: the companion API

Other mods can add to the screen through an optional, load-order-independent API on
`globalThis.DemographicsMetricsAPI`. It only acts when another mod calls it, and Demographics runs the same with or
without that mod installed.

- **`registerMetric(spec)`**: add a per-civilization line-chart metric that is sampled, stored and charted like the
  mod's own. A spec may include a `tooltipAttribution(ctx)` callback whose returned string is shown as a source line
  in that metric's tooltip.
- **`registerMetricToPage(pageId, metricId, afterMetricId?)`**: put the metric's tab on an existing page, for example
  next to Population.
- **`registerMetricGroup(spec)`**: show several related metrics behind one tab with up to two rows of pills (a metric
  row and a view or units row), charting one member at a time. Each member stays registered and sampled on its own.
- **`registerPanel(spec)`**: add a whole page, optionally with its own sub-tabs, whose body the other mod draws. The
  screen adds it as its own top-level tab and calls `spec.render(container, ctx, subId)` to fill it; the chart title,
  time range and CSV toolbar are left off these pages.
- **`registerHubPages(hubId, pages, opts?)`**: add pages to one of the hubs named in `HUB_IDS` (`statistics`,
  `migration`, `geopolitics`), after a given page or at the end.

Registrations made before the screen loads are queued on `DemographicsMetricsAPI.pending` and run when it starts.
*Emigration* uses all of these: its **Emigration** tab's **Population & Migration** page charts Population,
Population Share, Net Migration, Emigration, Immigration and Refugees, in scaled people or the game's own population
numbers, with tooltips that break each flow down by cause and markers for wars and disasters, beside its own Network,
Causes, My Cities, Diversity, Policies, Notifications and Guide pages.

## Layout

```
demographics.modinfo           scripts, screens and text, in a main-menu group and a game group
ui/demographics-bootstrap.js   entry script: loads the dock button and the sampler
ui/demographics-options.js     the settings in Options, Mods → Demographics
ui/core/                       settings, text, palette, font scale, tiers, storage repair
ui/core/settings-keeper.js     the Tower Settings Keeper, as in the standalone mod
ui/metrics/                    the metric registry, formatting and the companion API
ui/sampler/                    the per-turn sample of every civilization, wars, age changes
ui/storage/                    recorded history in the save: format, loading, thinning, budget
ui/screen-demographics/        the screen: charts, views, rankings, camera, stylesheets
ui/history/                    the History tab, the Hall of Fame and its main-menu screen
text/<lang>/ModText.xml        the text in each of 11 languages (see text/README.md)
images/demographics-icon.svg   the dock button icon
tests/                         the tests `npm run verify` runs (tests/run-all.mjs)
types/                         type declarations for the engine and the mod
devtools/                      development-only views and probes, never shipped
docs/civ7-storage-bug.md       the game's storage bug and what Repair mod storage does
docs/screenshots/              the screenshots above, and the rest of the views
docs/steam-workshop-*.md       the Workshop page text, long and short (.txt copies to paste)
docs/workshop-preview.png      the mod icon and Workshop preview (from the .svg)
scripts/build_readme_pdf.sh    builds README.pdf from this file
scripts/deploy.mjs             copies the files that ship into the game's Mods folder
scripts/steam-changelog.mjs    renders CHANGELOG.md into CHANGELOG.steam.txt
release.sh                     checks the build, then writes the release zip into dist/
CHANGELOG.md                   what changed in each version
CONTRIBUTING.md                setup, the checks to run and the code conventions
README.pdf                     this file, typeset
```

## Civilopedia History Corrections

This mod also carries Civilopedia History Corrections, a text patch for
[Civilopedia Expanded: Independents](https://steamcommunity.com/sharedfiles/filedetails/?id=3815309882). With that mod
on, six East Asian history pages (Goguryeo, the Oirat, two Ryukyu pages, Nanzhao and Balhae) give each side where
historians in different countries disagree, and a few factual errors are fixed. With it off, the game's pages stay as
they are. The text is in `history-corrections/`, in English, Simplified Chinese and Traditional Chinese. Every Tower mod
that carries it writes the same text, so running several of them together is fine.

Those paragraphs were replaced because they didn't hold up. Some repeated Chinese state historiography as settled
fact, or recast a question most historians consider answered as still open. Some got basic dates and places wrong. And
the Oirat page called a genocide, the Qing destruction of most of the Dzungar people in 1755-1757, a "pacification."
I'm not leaving that in place. More corrections to Civilopedia Expanded may be added at any time, in any update.
Corrections may also be added for any other mod whose text I judge, in my sole discretion, to be bigoted,
genocide-denying or otherwise historically inaccurate. Running this mod alongside any of them means you accept those
replacements, including any added later. Switch this mod off and their pages read as their authors wrote them.

## Credits

Built by Tower. The History tab and the Hall of Fame come from Tower's History & Rankings mod.

Demographics follows robk's InfoAddict for Civilization V and Gedemon's CivGraphs for Civilization VI, and builds on
Slothoth's Global Relations panel for Civilization VII. Thanks to Slothoth also for the keys to data persistence
across ages, to AndySafik for the Polish translation and playtest feedback, to renouf for bug reports, and to the
Civilization modding community for documentation, samples and testing.

## License

Up to version 2.9.0 this mod was MIT, and copies of those versions stay MIT. Versions after 2.9.0 are under the Tower
Mod License 1.0 in [LICENSE](LICENSE), written in plain English.

You're welcome to play it, read the code to see how it works, and change your own copy for your own games. If you'd
like to reupload it, put parts of it in your own mod, or use it some other way, ask me first: open an issue here or
message Tower on Steam. `ui/core/settings-keeper.js` stays MIT so other mods can keep embedding it.

I don't want this mod's code, text or art used to train AI models, collected into AI training sets, or handed to AI
tools to copy into other projects, and the license doesn't allow it without my written permission. I also reserve the
rights to text and data mining of this work under Article 4(3) of the EU's Directive 2019/790.

Where this mod's design comes from, and exactly what it shares with the mods that inspired it, is written up in
[docs/provenance.md](docs/provenance.md).

Because the source is on GitHub, GitHub and its affiliates (Microsoft included) have their own license to it under
GitHub's Terms of Service, and since April 2026 that covers training their AI. Valve and Take-Two have the rights
their own terms give them. Sid Meier's Civilization VII and its assets belong to Firaxis Games and 2K. Material from
other people is listed in [LICENSE](LICENSE).
