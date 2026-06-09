# Demographics for Civilization VII

A read-only analytics dashboard that samples data for every civilization each turn (default setting, sample rate is changeable) and displays it as filterable graphs, charts, and rankings. It does not change gameplay.

Intended to be the spiritual successor to robk's InfoAddict (Civ V) and Gedemon's CivGraphs (Civ VI), and an extension of Slothoth's Global Relations panel with added filters (Civ VII). Open source, with full readable source included.

## Tabs

- **Historical Data**: per-turn time-series charts and dashboards.
- **World Rankings**: civilization and settlement leaderboards, per-civ All Civilizations profiles, and a Top 25 settlements board with map fly-to.
- **Global Relations**: concentric relationship ring of met civilizations and city-states.
- **Options**: sampling, visibility, and display settings.

## Historical Data

Chart.js time-series and dashboards, grouped into seven metric pages (in-game metric names in parentheses where they differ):

- **Economy**: Score, GDP, Treasury, GPT, Production (PPT), Crops (Crop Yield), Trade Routes.
- **Power**: Military Power, Population, Settlements, Cap Utilization, Land Area, Wonders.
- **Knowledge & Influence**: Techs, Civics, Science, Culture, Diplomatic Approval, Influence (IPT), Happiness (HPT), Ongoing Deals.
- **Triumphs**: Legacy Radar (Test of Time legacy dashboard).
- **Resources**: per-category resource counts over time (Total, Bonus, Empire, City, Factory, Treasure), plus a stacked overview.
- **Conflicts**: Gantt chart of every war this game, with per-war cost graphs and a glossary (see below).
- **Crises**: the current age's crisis broken into stages, each with a per-civ cost table.

Supports per-civ colors, time-range filters, year axis labels, per-metric formatting, hide/focus civs, smoothing, elimination filtering, and CSV export.

## World Rankings

Four sub-tabs:

- **Civilization Ranking**: civilizations ordered by cumulative settlement score.
- **All Civilizations**: per-civ cards with current metric values and world ranks (the All Civilizations table). Unmet civilizations show as placeholders unless name revelation is enabled in Options.
- **Top 25 Settlements**: a podium-and-ranked-list board of the strongest settlements. Each card can snap the camera to the city (**View on map**), play a smooth **Cinematic view**, or — with the experimental settlement flyby enabled in Options — run a short keyframed flyby.
- **All Settlements**: a dense, sortable table filterable by All / Cities / Towns.

## Global Relations

Concentric ring: viewer civ at center, met civilizations on the inner ring, met city-states on the outer. Edges use the diplomacy palette; city-state nodes show their type glyph; colorblind mode switches to a high-contrast palette.

## Conflicts

The Conflicts page in Historical Data is a Gantt chart of wars from diplomacy events (declarer, supporters, opposers, and a stable war ID). War cost is the observed change in each side's military, settlements, population, and production across the war, derived from the recorded samples (not invented).

## Behavior

- Settings persist in `localStorage`. Recorded history persists per save game via the GameConfiguration store, carrying across quit/load and age transitions.
- History sample caps scale with game speed and can be overridden in Options. Lower the sample frequency there to cut per-turn work on slow machines or long games.
- Colorblind mode swaps chart and relationship colors to a colorblind-safe set.
- Single-player by default: diplomacy, influence, and relations figures for civilizations you haven't met are withheld (the charts show a gap; toggle in Options). The mod does not access-control the screen in multiplayer, so a host should gate or disable it.

## Installation

1. Subscribe, or place the `demographics` folder in the Mods directory:
   - Windows: `%localappdata%/Firaxis Games/Sid Meier's Civilization VII/Mods/`
   - macOS: `~/Library/Application Support/Civilization VII/Mods/`
2. Enable Demographics in Additional Content.

## Usage

- Open from the Demographics icon in the subsystem dock.
- Top tabs switch views. In Historical Data, the second row picks a metric page and the third picks the metric; in World Rankings, the second row switches between the rankings, All Civilizations, and settlement boards.

## Compatibility

- Does not overwrite base-game files.
- All engine reads are defensive: schema drift yields missing data, not crashes.
- Persistence uses the GameConfiguration store (`Configuration.editGame()` / `getGame()`). If that API is unavailable, history is kept in memory for the session only.

## Credits

- robk: Demographics (Civ V).
- Gedemon: CivGraphs (Civ VI).
- Slothoth: Global Relations (Civ VII).
- The Civilization modding community for documentation, samples, testing.
- Tower: Civilization VII rebuild.

## License

MIT. See LICENSE.
