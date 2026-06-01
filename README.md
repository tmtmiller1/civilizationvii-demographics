# Demographics for Civilization VII

Demographics is a read-only analytics dashboard for Civilization VII. It samples every civilization each turn and presents the results as charts, factbook cards, a global-relations view, a conflicts timeline, and progress overlays for the native Triumphs cards.

The mod builds on ideas from robk's Demographics for Civilization V, Gedemon's CivGraphs for Civilization VI, and Slothoth's Global Relations for Civilization VII.

## Overview

Demographics organizes its interface into four main areas:

- Historical Data, with per-turn charts for the tracked metrics.
- World Factbook, with current values and rank comparisons for each civilization.
- Global Relations, with a concentric relationship view of met civilizations and city-states.
- Options, with settings for sampling, visibility, and display behavior.

## Historical Data

The Historical Data view presents time-series charts rendered with Chart.js and styled to match the game's interface. The tracked metrics are grouped into four pages:

- Economy: Score, GDP, Treasury, GPT, Production, Crops, and Trade Routes.
- Power: Military Power, Population, Settlements, Cap Utilization, Land Area, and Wonders.
- Knowledge and Influence: Techs, Civics, Science, Culture, Diplomatic Approval, Influence, Happiness, and Active Deals.
- Triumphs: Legacy Radar, Triumphs Over Time, and Crisis Stage.

The charts support civ-specific colors, time-range filters, year-aware axis labels, metric-specific formatting, hidden or focused civilizations, optional smoothing, optional elimination filtering, and CSV export.

## World Factbook

The World Factbook presents per-civilization cards with current metric values and ranks against the world. Unmet civilizations appear as generic placeholders unless name revelation is enabled in Options.

## Global Relations

The Global Relations view uses a concentric ring layout with the viewer civ at the center, met civilizations on the inner ring, and met city-states on the outer ring. Relationship edges use the diplomacy palette, city-state nodes display their type glyph, and colorblind mode switches the palette to a high-contrast alternative.

## Conflicts

The Conflicts view shows a Gantt chart of wars recorded through the game's diplomacy events. It tracks the declarer, supporting and opposing participants, and a stable war identifier. The default window is 50 years so the view opens on a usable slice of the timeline.

## Triumphs Overlay

A runtime decorator watches the native Legacies → Triumphs popup and adds a progress block to each triumph card. Each card shows one row per major civilization, with empty, active, or triggered progress states rendered at a consistent height.

## Behavior

- Persistent settings are stored per save game.
- History storage caps scale with game speed and can also be overridden manually.
- Performance mode reduces write frequency and hover work during longer games.
- Colorblind mode swaps the rotating palette and relationship colors to a colorblind-safe set.

## Installation

1. Download or subscribe to the mod.
2. Place the `demographics` folder in the Civilization VII Mods directory.
   - Windows: `%localappdata%/Firaxis Games/Sid Meier's Civilization VII/Mods/`
   - macOS: `~/Library/Application Support/Civilization VII/Mods/`
3. Enable Demographics from the in-game Additional Content menu.

## Usage

- Open the dashboard from the Demographics icon in the subsystem dock.
- Use the top tabs to switch between Historical Data, World Factbook, Global Relations, and Options.
- Use the second-row tabs in Historical Data to switch metric pages, then the third-row tabs to choose the metric.
- Open the native Legacies → Triumphs popup to view the injected progress bars.

## Compatibility

- No vanilla game files are overwritten.
- Per-save history data is stored in the local player's `Tutorial` property bag (within an age/session; it does not carry across age transitions).
- The Triumphs decorator only appends UI elements to existing cards.
- Defensive accessors are used throughout so schema drift produces missing data instead of crashes.
- Designed and tested for single-player. Diplomacy, influence, and relations figures for civilizations the local player has not yet met are withheld (the charts show a gap, not a value), so the dashboard does not reveal hidden information. In multiplayer the screen is not access-controlled by the mod — a host who wants to prevent any incidental information advantage should gate or disable it.

## Credits

- robk, for the original Demographics mod for Civilization V.
- Gedemon, for CivGraphs for Civilization VI.
- Slothoth, for Global Relations for Civilization VII.
- The Civilization modding community, for documentation, sample mods, and testing.
- Tower, for the Civilization VII rebuild and enhancements.

## License

MIT. See LICENSE for details.

## Scripting Limits

Civilization VII does not currently expose gameplay scripting hooks or 3D asset modding. Demographics works inside the available `Game.*`, `Players.*`, and `GameInfo.*` accessors and renders the results in Coherent GameFace UI. The mod is read-only and does not modify gameplay state.