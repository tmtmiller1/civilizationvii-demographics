[h1]Demographics[/h1]

[b]New: History and the Hall of Fame[/b]
History & Rankings is now part of Demographics. A new [b]History[/b] tab tells the story of your campaign: a chronicle age by age, an interactive timeline with a territory map that replays your expansion, and a lineage of every leader. A [b]Hall of Fame[/b] ranks every campaign you have played, in game and from the main menu. Works on Civilization VII 1.5.0. Special thanks to [b]Slothoth[/b] for the keys to data persistence; a co-author credit is gladly offered.

Demographics adds graphs, civilization rankings, global relations, war history, campaign history, and a Hall of Fame to Civilization VII, recording per-civ data every turn as charts, rankings, and relationship views, so you can see how the world changes over the course of a game. A spiritual successor to robk's InfoAddict (Civ V) and Gedemon's CivGraphs (Civ VI), and an extension of Slothoth's Global Relations (Civ VII) with added diplomacy and filtering.

[b]The Mod Includes:[/b]
[list]
[*]Historical charts, continuous across ages, for economy, power, knowledge, influence, resources, conflicts, and Triumph progress.
[*]World Rankings: an All Civilizations matrix of current values and world rank for every metric, your civ pinned first. Click a metric to sort; flip each cell between its Value and its Rank.
[*]Global Relations: met civilizations and city-states arranged in a ring layout.
[*]Copy-to-CSV, plus options for smoothing, unmet-name masking, eliminated civs, performance mode, colorblind mode, and sample limits.
[*]Readable, un-minified source (JS with JSDoc types, checked with tsc).
[/list]

[b]History:[/b]
[list]
[*]Chronicle: your campaign told age by age, from settlements founded and taken to wonders, wars, religions, Triumphs, crises, natural disasters, new ages and victories.
[*]Timeline: the whole game on one chart, with lanes for wars, crises, wonders, Triumphs, religion, conquests, settlements, disasters, migration and population, drawn with the game's own icons. Zoom, pick an age, or press Play to watch the game unfold.
[*]Territory map: a hex map of the world, drawn like the game's minimap, that follows the timeline, so playback replays each empire's expansion and your exploration.
[*]Civilizations filter: the timeline opens on your own story; add any civilization you met to compare.
[*]Lineage: every leader and the civilization they led in each age.
[/list]

[b]Hall of Fame:[/b]
[list]
[*]Opens on your best games: a podium of your top three, the rest of your top ten, and the game you are playing at its rank.
[*]Every campaign you have played, ranked by result, Triumphs and speed, each with an honorific from Augustus Caesar down to Ethelred the Unready.
[*]Leader and civilization tallies with a win-rate bar, records, and a page for each game with its map, rivals, timeline and highlights, where every Triumph says what it was earned for and what it gave.
[*]Opens from World Rankings, from the main menu, and from the end-of-game screen.
[/list]

[b]Conflicts:[/b]
[list]
[*]A Gantt timeline of every war from diplomacy events: the declarer, supporters, and opposers share one stable war ID, so coalitions and multi-front wars read as a single conflict.
[*]Each war's cost is the observed change in participants' military, settlements, population, and production, read from recorded per-turn samples, never estimated.
[*]A per-war Graphs view plots those metrics over just that war's window and belligerents, with consistent generated war names across ages.
[/list]

[b]Crises:[/b]
[list]
[*]The current age's crisis split into its stages (Begins, Intensifies, Culminates, Ends) as severity-colored bars matching the line-chart markers.
[*]A permanent per-stage cost table of every civ's losses, plus a Crisis Graphs grid charting each crisis statistic per civ across the whole game.
[/list]

[b]Top Settlements & Cinematic Flyby:[/b]
[list]
[*]A ranked board of the world's largest cities and towns with owner, population, output, and gold/silver/bronze medals.
[*]“View on map” flies the camera to any settlement; “Cinematic view” orbits its districts and wonders and finishes with fireworks; camera style and length are configurable.
[/list]

[b]Pairs with Emigration:[/b]
[list]
[*]With the [b]Emigration[/b] companion mod installed, Demographics hosts a dedicated Emigration tab and a Net Migration graph beside Population. The hooks stay inert when it is not installed, so the base mod is unchanged.
[/list]

[b]Triumphs Overlay:[/b]
[list]
[*]Triumph card progress overlays now ship as a separate companion mod: triumphs-progress-overlay.
[/list]

[b]Languages:[/b] Fully localized in English, German, Spanish, French, Italian, Japanese, Korean, Portuguese (Brazil), Russian and Simplified Chinese, and using the game's own number formatting per language. Polish is included and in progress. Numbers, tables, and chart titles read in your language.

[b]Notes:[/b] Read-only and additive: it does not change balance, alter opponents, or overwrite base-game files. Per-save data storage; the Hall of Fame is kept on your computer.

[b]Compatibility:[/b] Because of a game storage bug, another mod's saved data can keep the Hall of Fame from storing past games. When that happens, Demographics leaves stored games alone so no mod's settings are disturbed, still shows the current game and any save you load, and says so under the Hall of Fame.

[h2]Source and documentation[/h2]
[list]
[*][url=https://github.com/tmtmiller1/civilizationvii-demographics]Open source on GitHub[/url]
[*][url=https://github.com/tmtmiller1/civilizationvii-demographics/blob/main/README.md]Full documentation: every page, every figure, and how each one is calculated[/url]
[*][url=https://github.com/tmtmiller1/civilizationvii-demographics/blob/main/README.pdf]The same document as a typeset PDF, with the screenshots[/url]
[/list]

[h2]Credits[/h2]
[list]
[*][b]Tower[/b], for design and Civilization VII implementation, including the History and Hall of Fame carried over from Tower's History & Rankings.
[*][b]robk[/b], creator of InfoAddict for Civilization V.
[*][b]Gedemon[/b], creator of CivGraphs for Civilization VI.
[*][b]Slothoth[/b], creator of Global Relations for Civilization VII, and for the keys to data persistence across ages; co-author credit offered.
[/list]

[h2]Special Thanks[/h2]
[list]
[*][b]Potato McWhisky[/b], for teaching me to love again, Civilization-wise (Civ VI), after growing up as a Civilization II, IV, and V player. Making this mod is an act of faith that the community will eventually help make Civilization VII as good as the previous entries.
[/list]
