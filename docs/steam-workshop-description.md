[h1]Demographics[/h1]

[b]★ Updated for Civilization VII 1.4.1 ★[/b]
Compatible with the 1.4.1 update, and now pairs with the new [b]Emigration[/b] companion mod for a dedicated Emigration tab and a Net Migration graph beside Population. History also stays continuous across the age boundary: economy, power, population, knowledge, conflicts, and Triumph progress carry from Antiquity into Exploration and beyond instead of resetting at each age transition. Special thanks to [b]Slothoth[/b], whose work provided the keys to data persistence across ages. A co-author credit is gladly offered.

Demographics adds graphs, civilization rankings, global relations, war history, and Triumph progress to Civilization VII. It records data for each civilization and presents it through charts, rankings, relationship views, war history, and Triumph progress overlays. Storytelling is a core purpose of this mod, and the goal is to make the world's shifts readable as a lived narrative.

It is intended to be the spiritual successor to robk's InfoAddict for Civilization V, Gedemon's CivGraphs for Civilization VI, and an extension of Slothoth's Global Relations for Civilization VII that adds additional diplomatic concerns and filtering.

[b]The Mod Includes:[/b]
[list]
[*]Historical charts, now continuous across the age boundary, for economy, power, knowledge, influence, resources, conflicts, and Triumph progress.
[*]A World Rankings view: an All Civilizations matrix of current values and world rank for every metric (detailed below).
[*]A Global Relations view with met civilizations and city-states arranged in a ring layout.
[*]A war timeline built from diplomacy events.
[*]Readable shipped source modules (release builds are not minified by default; the source is written in readable JS with JSDoc types and checked with tsc --noEmit).
[*]Copy-to-CSV for recorded history (true export is unavailable for modding).
[*]Options for smoothing, unmet-name handling, eliminated civilizations, performance mode, colorblind mode, and sample limits.
[/list]

[b]World Rankings:[/b]
[list]
[*]An "All Civilizations" matrix with every metric as a row and every met civilization as a column: your own civ pinned first with a gold border so comparisons are easy to read.
[*]Click any metric to sort every civilization by it, and flip each cell between its raw Value and its world Rank (for example "Rank 3/8") with the Rank / Value toggle.
[*]Spans the full metric set (score, economy, military power, population, knowledge, influence, resources, and more), so you can see at a glance who leads the world in each.
[*]Respects the same unmet-name masking, eliminated-civilization, and colorblind options as the rest of the mod, and lets you hide or show individual civilizations.
[/list]

[b]Triumphs Overlay:[/b]
[list]
[*]Triumph card progress overlays now ship as a separate companion mod: triumphs-progress-overlay.
[/list]

[b]Pairs with Emigration:[/b]
[list]
[*]With the [b]Emigration[/b] companion mod installed, Demographics hosts a dedicated [b]Emigration[/b] tab and a Net Migration graph beside Population, so migration flows, refugees, and their causes appear alongside the rest of the world's history. Emigration is updated for Civilization VII 1.4.1. When Emigration is not installed these hooks stay inert, so the base mod is unchanged.
[/list]

[b]Conflicts:[/b]
[list]
[*]A Gantt style timeline of every war, reconstructed from diplomacy events: the declarer, their supporters, and their opposers are grouped under one stable war ID, so coalitions and multi-front wars read as a single conflict.
[*]Each war reports its cost as the observed change in the participants' military, settlements, population, and production across the war, read straight from the recorded per-turn samples, never invented or estimated.
[*]Opens on a focused 50-year window, with generated war names that stay consistent and avoid repetitive or misleading labels across ages.
[*]A per-war Graphs view plots those same metrics over just that war's window for just its belligerents, so you can see exactly when a side's strength turned.
[/list]

[b]Crises:[/b]
[list]
[*]The current age's crisis broken into its stages (Begins, Intensifies, Culminates, Ends), shown as severity-colored bars that match the crisis markers on the line charts.
[*]Beneath each stage, a permanent cost table lists every civilization's losses accrued during that stage, so you can see who the crisis hit hardest and when.
[*]A Crisis Graphs view charts every crisis statistic per civilization across the whole game as a grid of small line charts, with one shared legend that toggles a civ in every graph at once.
[/list]

[b]Top Settlements & Cinematic Flyby:[/b]
[list]
[*]A ranked Top Settlements board of the largest cities and towns in the world, each with its owner, population, and output strip, plus gold / silver / bronze medals for the leaders.
[*]"View on map" flies the camera straight to any settlement so you can see it on the map.
[*]"Cinematic view" is a celebratory flyby of the city: a short aerial tour that orbits the settlement, its districts, special districts, and wonders, finishing with a fireworks send-off.
[*]The flyby mounts an on-screen card naming the city, its world rank (gold/silver/bronze laurels), and its notable districts and wonders.
[*]Everything restores cleanly on Back / ESC: camera, zoom, and the Demographics screen all return to where you left them. Camera style (instant, cinematic, or flyby), subtle rotation, and flyby length are all configurable in Options.
[/list]

[b]Recent UI Polish:[/b]
[list]
[*]Global Relations: the Major Civilizations ring is now centered on the window, and the viewer dropdown and filter legend align cleanly with the panel framing instead of clashing with it. Both relations tabs (Major Civilizations and City States) carry clear legend titles.
[*]Line charts: civilizations with near-black or near-identical banner colors are now drawn in a readable, hue-preserving tone (preferring their secondary banner color when it reads better against the dark background), and a global pass keeps every civ's line visually distinct so lines never blur together or disappear.
[*]War timeline: labels for near-white-bannered civilizations now render in red so they stay legible, and long-war naming uses realistic, accurate spans.
[*]Clearer, more consistent tooltips across the chart and relations views.
[/list]

[b]What The Mod Does Not Do:[/b]
[list]
[*]It does not change gameplay balance.
[*]It does not alter opponent behavior.
[*]It does not overwrite base-game files.
[/list]

[b]Compatibility:[/b]
[list]
[*]Read-only presentation layer.
[*]No base-game file replacement.
[*]Per-save data storage.
[/list]

[b]Installation:[/b]
[list=1]
[*]Download or subscribe to the mod.
[*]Place the [b]demographics[/b] folder in the Civilization VII Mods directory.
[*]Enable Demographics from Additional Content in-game.
[/list]

[b]Source:[/b]
[list]
[*]Open source on GitHub: https://github.com/tmtmiller1/civilizationvii-demographics
[/list]

[b]Credits:[/b]
[list]
[*]robk for InfoAddict for Civilization V.
[*]Gedemon for CivGraphs for Civilization VI.
[*]Slothoth for Global Relations for Civilization VII, and for the keys to data persistence across ages: co-author credit offered.
[*]Tower for the Civilization VII implementation and expansion work.
[/list]

[b]Special Thanks[/b]
[list]
[*]Potato McWhisky: for teaching me to love again (Civilization VI) after being a Civilization II, IV, V player. Making this mod was an act of faith that they'll eventually make this game as good as the previous entries.
[/list]
