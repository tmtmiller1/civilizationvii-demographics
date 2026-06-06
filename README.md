# Demographics for Civilization VII

A read-only analytics dashboard. It samples data for every civilization and displays as graphs and charts with filters as well as progress overlays on the native Triumphs cards. It does not change gameplay.

Intended as the natural successor to robk's InfoAddict (Civ V), Gedemon's CivGraphs (Civ VI), and as an extension of Slothoth's Global Relations panel with added filters (Civ VII).

## Tabs

- **Historical Data**  -  per-turn time-series charts.
- **World Factbook**  -  current values and world ranks per civilization.
- **Global Relations**  -  concentric relationship ring of met civilizations and city-states.
- **Options**  -  sampling, visibility, and display settings.

## Historical Data

Chart.js time-series, grouped into four metric pages:

- **Economy**  -  Score, GDP, Treasury, GPT, Production, Crops, Trade Routes.
- **Power**  -  Military Power, Population, Settlements, Cap Utilization, Land Area, Wonders.
- **Knowledge & Influence**  -  Techs, Civics, Science, Culture, Diplomatic Approval, Influence, Happiness, Active Deals.
- **Triumphs**  -  Legacy Radar, Triumphs Over Time, Crisis Stage.

Supports per-civ colors, time-range filters, year axis labels, per-metric formatting, hide/focus civs, smoothing, elimination filtering, and CSV export.

## World Factbook

Per-civilization cards with current metric values and world ranks. Unmet civilizations show as placeholders unless name revelation is enabled in Options.

## Global Relations

Concentric ring: viewer civ at center, met civilizations on the inner ring, met city-states on the outer. Edges use the diplomacy palette; city-state nodes show their type glyph; colorblind mode switches to a high-contrast palette.

## Conflicts

Gantt chart of wars from diplomacy events  -  declarer, supporters, opposers, and a stable war ID. War cost is the observed change in each side's military, settlements, population, and production across the war, derived from the recorded samples (not invented). Opens on a 50-year window.

## Triumphs Overlay

A runtime decorator adds a per-civilization progress block to each card in the native Legacies → Triumphs popup.

## Behavior

- Settings persist in `localStorage`. Recorded history persists per save game, within an age  -  it does not carry across age transitions.
- History sample caps scale with game speed and can be overridden in Options. Lower the sample frequency there to cut per-turn work on slow machines or long games.
- Colorblind mode swaps chart and relationship colors to a colorblind-safe set.
- Single-player by default: diplomacy, influence, and relations figures for civilizations you haven't met are withheld (the charts show a gap; toggle in Options). The mod does not access-control the screen in multiplayer  -  a host should gate or disable it.

## Installation

1. Subscribe, or place the `demographics` folder in the Mods directory:
   - Windows: `%localappdata%/Firaxis Games/Sid Meier's Civilization VII/Mods/`
   - macOS: `~/Library/Application Support/Civilization VII/Mods/`
2. Enable Demographics in Additional Content.

## Usage

- Open from the Demographics icon in the subsystem dock.
- Top tabs switch views. In Historical Data, the second row picks a metric page and the third picks the metric.
- Open the Legacies → Triumphs popup to see the injected progress bars.

## Compatibility

- Overwrites no base-game files; the Triumphs overlay only appends to existing cards.
- All engine reads are defensive: schema drift yields missing data, not crashes.
- Persistence needs the engine hash API. If it is absent, history persistence is disabled (in-memory only for the session) rather than written under a guessed key.

## Credits

- robk  -  Demographics (Civ V).
- Gedemon  -  CivGraphs (Civ VI).
- Slothoth  -  Global Relations (Civ VII).
- The Civilization modding community  -  documentation, samples, testing.
- Tower  -  Civilization VII rebuild.

## License

MIT. See LICENSE.

## Scripting limits

Civ VII exposes no gameplay scripting or 3D-asset hooks. Demographics works within the `Game.*`, `Players.*`, and `GameInfo.*` accessors, renders in Coherent GameFace, and is read-only.
