# Where Demographics comes from

Demographics builds on two earlier mods: robk's InfoAddict for Civilization V and Slothoth's Global Relations Panel
for Civilization VII. This page compares Demographics 2.9.0 with InfoAddict v22 and Global Relations Panel v1.04
(Steam Workshop 3506996826) and shows what each one contributed. Every source file was read side by side with the
mod's, the code was scanned for shared runs of tokens, the text was scanned for shared runs of words, and each
function in the mod was sorted into one of four groups.

Here's the result, counted in lines of shipping code (JavaScript, CSS, HTML, SVG and the modinfo, with blank and
comment lines left out):

| Group | Lines | Share |
| --- | ---: | ---: |
| Copied or translated from InfoAddict or Slothoth's panel | 0 | 0% |
| Adapted: functions that follow a specific design from one of them | 379 | 0.9% |
| · of which follow InfoAddict | 226 | 0.6% |
| · of which follow Slothoth's panel | 153 | 0.4% |
| Own code for a feature one of them also had | 14,965 | 36.8% |
| Own code for features neither of them had | 25,362 | 62.3% |
| **Total** | **40,706** | **100%** |

The text is counted on its own: 30,667 lines across 11 languages, all written for this mod.

In short, the screen's design follows InfoAddict, the relations ring's placement math started from Slothoth's panel,
and the code and text are the mod's own.

The README also credits Gedemon's CivGraphs for Civilization VI as an inspiration for per-civ graphs. This mod doesn't
use any code from it.

## InfoAddict (robk, Civilization V)

InfoAddict is the model for the whole screen. It's a Lua mod for Civ V's interface, and Demographics rebuilt its
design in JavaScript for Civ VII's interface. The code is written fresh: InfoAddict's Lua functions, formulas and
constant tables don't show up in it. The debt is in how the screen is laid out and how it behaves.

The mod's earliest version stored its data under the key `"infoAddict"` before settling on `"demographics"`, and its
first README listed the same four sections InfoAddict has and quoted InfoAddict's "Demographics on steroids" line.

### The screen

| InfoAddict v22 | Demographics 2.9.0 |
| --- | --- |
| Four sections: Historical Data, World Factbook, Global Relations, Options (`XML/InfoAddictText_EN.xml:13-27`) | Top tabs Historical Data, Civilization Rank by Yield, Global Relations and Options (`text/en_us/ModText.xml:155-166`), plus tabs InfoAddict didn't have |
| Historical Data: a line per civ for each of 22 categories, click a civ in the key to highlight it, hover for every civ's value on that turn, zoom to recent turns | Chart.js line charts across 50 metrics, legend focus, hover tooltip, time-range filter, opt-in smoothing |
| World Factbook: world rankings per category, ranked only among civs you've met | Rankings matrix (`ui/screen-demographics/views/worldrankings-allcivs/`), with civs you haven't met hidden by default |
| Records every civ's values each turn into the save with `Modding.OpenSaveData` (`Lua/InfoAddictDataManager.lua:15`) | Records each turn into the save through its own sampler and storage (`ui/sampler/`, `ui/storage/`) |

Where the two compute a value, the formulas differ. InfoAddict's land area is plots × 10,000
(`Lua/InfoAddictFactBook.lua:117`), and the mod's is owned tiles × 7,000 km²
(`ui/metrics/demographics-metrics-helpers.js:370`).

### The Global Relations ring

InfoAddict's Global Relations screen set most of the conventions the mod's relations view follows.

| InfoAddict v22 | Demographics 2.9.0 |
| --- | --- |
| 22 fixed icon slots on a circle of radius 225, the first at the top (`0,-225`) and the rest clockwise (`XML/InfoAddictCivRelations.xml:1584-1689`) | `seatsOnEllipse` computes the seats: first at the top, the rest clockwise (`ui/screen-demographics/views/relations/relations-ring-svg.js:66-76`) |
| Walks each pair once, `targetPid = thisPid + 1`, among met, living civs (`Lua/InfoAddictCivRelations.lua:382-393`) | Walks each pair once, `j = i + 1`, among met majors (`relations-edges.js:599-622`) |
| Three views: Political, Economic, Attitude (`Lua/InfoAddictCivRelations.lua:1469-1481`) | The earliest version had the same three; now two groups, Politics & Relationship and Agreements (`relations-filters.js:52-55`) |
| Political: war, defensive pact, friendship, open borders, denouncement | War, alliance, open borders, denounced, fitted to Civ VII's diplomacy |
| Economic: gold per turn, research, resources, trade routes | Trade routes, with research and other endeavors under Agreements |
| Attitude: five levels from `GetApproachTowardsUsGuess` (`Lua/InfoAddictCivRelations.lua:1165`) | Seven levels from `getRelationshipEnum` (`relations-edges.js:86-129`) |
| Up to five parallel lines per pair, at offsets 0, ±5 and ±10, drawn from 1,155 lines laid out in advance in the XML | Curves fanned out per pair when two civs share several relationships (`relations-ring-svg-edges.js`) |
| Click a civ to show only its lines, click a key entry to show only that type, and a Reset Selections button (`Lua/InfoAddictCivRelations.lua:314`, `:1327-1366`, `:1427`) | Click a civ to focus it, filter pills per type, and a clear-focus button |
| War red, denouncement orange, friendship green | War red, hostile orange, friendly green, in different shades, with a colorblind set as well |

The 226 adapted lines are the functions that carry these behaviors: the political and economic edge builders in
`relations-edges.js` (`hasAlliance`, `isAtWar`, `buildAllianceEdges`, `buildWarEdges`, `buildActionTypeEdges`,
`buildPoliticalEdges`, `tradeRouteCount`, `pushTradeEdgesForSource`, `buildEconomicEdges`), the select-to-filter code
(`pruneSelectionToRing` and `filterEdgesBySelectedNodes` in `view-relations.js`, `computeFocus` in
`relations-ring-svg.js`, `wireNodeClick` and `applyFocusDim` in `relations-ring-svg-nodes.js`) and the type toggles in
`relations-filters.js` (`wireFilterPill`, `buildFilterPill`, `makeFilterPillRow`). They're written fresh for Civ VII's
engine and UI. They're counted as adapted because the behavior they implement is InfoAddict's.

## Global Relations Panel (Slothoth, Civilization VII)

Slothoth's panel is the Civ VII mod the relations ring started from. It puts leader portraits on a ring, draws a line
between each pair of majors colored by their relationship, lets you toggle each relationship type, isolates a leader's
lines on hover and shows each leader's strategic resources. Version 1.04 has 631 lines in
`ui/global-relations-panel/global-relations-panel.js`, plus a dock-button script, a hotkey script, two compatibility
scripts, an HTML file, a CSS file and its text.

### The ring placement

His panel places each leader in `setupLeaderPortraits()`, lines 503-505:

```js
const angle = -Math.PI/2 + (2 * Math.PI * i / this.player_diplo.length);
const xPercent = 50 + (this.polygonRadiusRem / this.polygonContainer.style.width.replace('rem', '') * 100) * Math.cos(angle);
const yPercent = 50 + (this.polygonRadiusRem / this.polygonContainer.style.height.replace('rem', '') * 100) * Math.sin(angle);
```

The mod's `seatsOnEllipse` (`ui/screen-demographics/views/relations/relations-ring-svg.js:66-76`):

```js
function seatsOnEllipse(ids, rx, ry, cx, cy) {
  const seats = new Map();
  const count = ids.length;
  const firstAngle = count === 1 ? 0 : -Math.PI / 2;
  const fullTurn = 2 * Math.PI;
  ids.forEach((id, i) => {
    const angle = firstAngle + (fullTurn * i) / count;
    seats.set(id, { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  });
  return seats;
}
```

Both start at −π/2 so the first civ sits at the top, step around in equal slices of a full turn, and use cos for x
and sin for y, which runs clockwise on screen. His positions are percentages of the panel around a center of 50, with
one radius in rem converted for each axis, so his ring stays a circle. The mod's takes separate x and y radii and a
center in SVG units, handles a lone civ, and its caller (`computeRingGeometry`, same file) stretches the ring into an
oval once there are more than 12 civs. The mod's first version of this function used the same angle expression and a
default center of 50, and it was marked as adapted from his file. The comment above `seatsOnEllipse` credits his
panel today.

The formula is the standard way to space points evenly around a circle, and InfoAddict's ring already ran from the
top clockwise. The credit stands because this mod's version started from his.

### The lines between pairs

His `setupLines()` (lines 123-162) loops over every living major the player has met, against every other one, and
draws a straight SVG `<line>` between their portraits with the endpoints given as percentages and a stroke width of 2.
It colors the line red for war, `#9933ff` for an alliance, and otherwise by relationship: `#009900` friendly,
`#5555ff` helpful, white neutral, yellow unfriendly, orange hostile.

The mod uses the same engine calls (`Players.getAliveIds`, `Diplomacy.hasMet`, `getRelationshipEnum`) and also limits
the ring to majors the player has met, but the drawing is its own. It visits each pair once, draws each relationship
as a quadratic curve (`<path>`) fanned out from the others on the same pair, draws dashes and dots by hand because
the game's renderer ignores `stroke-dasharray`, and adds chevrons for one-way actions like denouncing
(`relations-ring-svg-edges.js`). Its colors come from its own palette (`ui/core/demographics-palette.js`), and his
hex values don't appear anywhere in the mod's `ui/` folder. Both color by the same categories, the game's five
relationship levels plus war and alliance, because those are the states Civ VII reports.

The 153 lines counted as adapted from his panel are `seatsOnEllipse` (11), the attitude lookup in
`relations-edges.js` (45), the met-major and living-player lookups in `relations-queries.js` (64), `collectMet` and
`readHasMet` in `ui/sampler/sampler-collectors-core.js` (18) and the pair curve `appendSolidCurve` (15). Apart from
the ring placement, these are uses of engine calls the game's own UI scripts make too: `Players.getAliveIds` shows up
in 5 of the game's script files, `getRelationshipEnum` in 11 and `Diplomacy.hasMet` in 15. They're counted here
because notes in the mod's first version pointed to his panel for them.

### Whole-source scans

Every JavaScript, CSS, HTML, SQL and XML file in his panel was compared with all 217 JavaScript and 9 CSS files the mod
ships, and with all of the mod's text.

| Scan | Result |
| --- | --- |
| JavaScript, runs of 25 tokens, exact | 0 |
| CSS, runs of 25 tokens, exact | 0 |
| JavaScript, runs of 15 tokens, exact | 1: `= new Map(); for (let i = 0; i <`, his lines 498-500 and `charts/wars/chart-wars-merge.js:91-92`, a map and a counting loop that line up by chance |
| JavaScript, runs of 25 tokens with every name, string and number replaced by a placeholder | 111 runs in 46 files, the longest 47 tokens (about seven lines). Every one is the shape of everyday UI code: create an element, set its class and style, append it; chains of `setAttribute`; the import list for the game's core modules; short arrays of object literals; and the dock-button call |
| Text, runs of six words, his XML, SQL, HTML and readme against the mod's text in every language, README, Workshop text and changelog | 0 |

The longest exact runs after the one above are 14 tokens: the `{ singleton: true, createMouseGuard: true }` options
for opening a screen and `this.enableOpenSound = true; this.enableCloseSound = true;`, which 63 and 86 of the game's
own script files use. Both mods add their dock button with the `addButton({ tooltip, modifierClass, callback })` call
the game's own `panel-sub-system-dock.js` uses for its buttons.

His hotkey script, compatibility scripts, strategic-resource display and text stayed with his mod.

The README also thanks Slothoth for the keys to data persistence across ages. That credit is for know-how rather than
code: his panel doesn't store anything between sessions, and the mod's storage (`ui/storage/`) is its own.

## What's new

Most of the mod is features neither InfoAddict nor Slothoth's panel had:

| System | Where | Lines |
| --- | --- | ---: |
| History tab and Hall of Fame: chronicle, timeline and territory map, leader lineage | `ui/history/` | 4,903 |
| Wars and conflicts: a Gantt chart of every war, who declared it and who joined, war cost, war names, risings | `ui/screen-demographics/charts/wars/`, `charts/conflicts/` | 3,297 |
| Settlements: top cities, showcase, town histories | `ui/screen-demographics/settlements/`, `views/settlements/` | 2,122 |
| Boards: Power Race chart, share areas, quarters board, religion lines, pantheons | `ui/screen-demographics/charts/boards/` | 1,699 |
| City flyby camera | `ui/screen-demographics/camera/` | 1,538 |
| Crises: each age's crisis stages and what they cost | `ui/screen-demographics/charts/crises/` | 1,078 |
| Legacy progress radar | `ui/screen-demographics/charts/triumphs/` | 499 |
| Resources by class | `ui/screen-demographics/charts/resources/` | 313 |

The History tab and Hall of Fame came from Tower's own History & Rankings mod. The rest of the 25,362 lines are the
screen shell, the core helpers (translations and font fallbacks, settings, storage repair, palettes, CSV export) and
the CSS for these systems.

Inside the features that do have a counterpart, much of the code is new ground too: the city-state ring with
suzerainty and a dropdown for seeing any civ's ties to the city-states, agreements, directed edges, continuity across
ages in every chart, colorblind palettes, and 50 metrics against InfoAddict's 22 graph categories.

## Text

Runs of six or more words were checked between the mod's text (all 11 languages, the README, the Workshop
descriptions and the changelog) and InfoAddict's text in all six of its languages, its readme and modinfo, and
Slothoth's text, readme and HTML. Neither comparison turned up a shared run.

The wording the mod shares with InfoAddict is short titles: "Historical Data" and "Global Relations"
(`text/en_us/ModText.xml:156`, `:162`), "World Rankings" (`:2140`, InfoAddict's Factbook menu title) and "Options",
plus game terms like Open Borders, Trade Routes and Land Area. The 1,174 English text rows and their ten translations
were written for this mod.

## Credits and licensing

InfoAddict v22 and Global Relations Panel v1.04 don't carry a license or permission text in any of their files.
Demographics builds on their design rather than their code or text, and credits them in the modinfo's Special Thanks,
in the README's Credits section, in [LICENSE](../LICENSE), and, for the ring placement, in the comment above
`seatsOnEllipse`.

Versions up to and including 2.9.0 were released under MIT, and later versions are under the Tower Mod License 1.0 in
[LICENSE](../LICENSE). The Civilopedia corrections in `history-corrections/` follow some wording from Maple_Leaves'
Civilopedia Expanded: Independents, and LICENSE credits that separately.

## How this was checked

- **Sources.** InfoAddict v22 in full, with all 31 files matching the checksums in its modinfo. Global Relations Panel
  v1.04 in full, as distributed on Steam Workshop. Demographics 2.9.0: the 244 files its modinfo lists, plus the modinfo itself.
- **Line counts.** Blank lines and comments are left out. The adapted group counts whole functions, from `function` to
  the closing brace. Where both sources had an idea, the function goes to the one the mod's own notes named.
- **Code scans.** JavaScript and CSS were split into tokens and compared in runs of 25 and 15 tokens, once exactly and
  once with every name, string and number swapped for a placeholder so renamed copies would still match. Every run
  found was extended to its full length and read.
- **Across languages.** InfoAddict's Lua was read function by function against the mod's JavaScript, with shared
  identifiers, formulas and constants checked.
- **Text.** Markup was stripped and the text lowercased, then compared in runs of six words, with four-word runs read
  for context.
