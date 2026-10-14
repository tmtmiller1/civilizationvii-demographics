[h1]Demographics[/h1]
[b]Version 2.8.3. For Civilization VII 1.5.0.[/b] Settings now survive a restart: the mod carries the Tower Settings Keeper.
Demographics adds graphs, civilization rankings, global relations, war history, campaign history and a Hall of Fame to Civilization VII. It records every civilization's figures each turn, so you can see how the world changes over a game. It only reads the game: balance, opponents and base-game files are untouched.
It follows robk's InfoAddict (Civ V) and Gedemon's CivGraphs (Civ VI), and builds on Slothoth's Global Relations panel (Civ VII) with more diplomacy and filtering.
[h2]Graphs and rankings[/h2]
[list]
[*]Per-turn charts, continuous across ages, for yields, economy, resources, society, religion, land, settlements and military, with crisis stages, age changes and wonders marked on the timeline.
[*]World Rankings: a podium and full list of civilizations, a sortable rank-by-yield table for civilizations and another for settlements (flip each cell between Rank and Value), and a Top 25 Settlements board with holy cities, world leaders and each finished age's top ten.
[*]Global Relations: the civilizations and city-states you have met in a ring, with wars, alliances, attitudes and agreements between them.
[*]Real-world scale: populations from thousands to tens of millions by age, GDP in dollars, territory in km².
[*]Copy as CSV, a spoiler guard for civilizations you have not met, colorblind mode, smoothed lines, and a Basic mode that shows only the core pages.
[/list]
[h2]History[/h2]
[list]
[*]Chronicle: your campaign told age by age, from settlements founded and taken to wonders, wars, religions, Triumphs, crises, natural disasters, new ages and victories.
[*]Timeline: the whole game on one chart, with lanes for wars, crises, wonders, Triumphs, religion, conquests, settlements, disasters, migration and population, drawn with the game's own icons. Zoom, pick an age, or press Play to watch the game unfold.
[*]Territory map: a hex map of the world, drawn like the game's minimap, that follows the timeline, so playback replays each empire's expansion and your exploration.
[*]Civilizations filter: the timeline opens on your own story; add any civilization you met to compare.
[*]Lineage: every leader and the civilization they led, age by age.
[/list]
[h2]Hall of Fame[/h2]
[list]
[*]Opens on your best games: a podium of your top three, the rest of your top ten, and the game you are playing at its rank.
[*]Every campaign you played, ranked by result, Triumphs and speed, each with an honorific from Augustus Caesar down to Ethelred the Unready.
[*]Leader and civilization tallies with a win-rate bar, records, and a page per game with its map, rivals, timeline and highlights, where every Triumph says what it was earned for and what it gave.
[*]Opens from World Rankings, the main menu and the end-of-game screen.
[*]Hide short games or show all, on every page, with a count of what is hidden.
[/list]
[h2]Wars and crises[/h2]
[list]
[*]A timeline of every war, built from diplomacy events: the declarer, supporters and opposers share one war, so a coalition reads as a single conflict, and each war gets a generated name.
[*]Each war's cost is the observed change in its participants' military, settlements, population and production, read from the per-turn samples.
[*]War Impact charts those figures over one war and its belligerents.
[*]Crisis Impact splits each age's crisis into its stages (Begins, Intensifies, Culminates, Ends), with every civilization's losses per stage, and Crisis Impact Graphs chart each crisis statistic per civilization.
[/list]
[h2]Top settlements and the cinematic view[/h2]
[list]
[*]A ranked board of the world's largest cities and towns with owner, population, output, wonders and gold, silver and bronze medals.
[*]View on map flies the camera to any settlement; Cinematic view orbits its quarters and wonders and finishes with fireworks. The camera style and length are set in Options.
[/list]
[h2]Pairs with Emigration[/h2]
[list]
[*]With the [b]Emigration[/b] companion mod installed, Demographics hosts its Emigration tab and migration charts beside Population. Without it nothing changes.
[/list]
[h2]Languages[/h2]
English, German, Spanish, French, Italian, Japanese, Korean, Polish, Brazilian Portuguese, Russian and Simplified Chinese, each with its own number formatting.
[h2]Notes[/h2]
[list]
[*]Recorded history is kept in each save; the Hall of Fame is kept on your computer.
[*]The screen scales to the resolution it is played at. At 1280x720, the smallest supported resolution, some pages are tight: everything is readable, but column headings and long leader names can be cut off.
[*]Triumph card progress overlays are a separate companion mod: triumphs-progress-overlay.
[*]Readable, unminified source.
[/list]
[h2]A Civilization VII bug, and the workaround for it[/h2]
Civilization VII 1.5.0 has a bug in the storage mods use for their settings: whenever a mod asks for its own saved data, the game returns whichever mod's entry sorts first. Only that one mod's data works; the entry most mod option panels share can never be read back, so their settings reset every launch and the Hall of Fame cannot save its list of past games (every game is still stored in its own save). It is Firaxis's bug to fix; a reproduction is written up for them.
Demographics carries the [url=https://steamcommunity.com/sharedfiles/filedetails/?id=3815023570]Tower Settings Keeper[/url], which keeps every mod's settings in the one entry the game reads correctly, without deleting anything. If the Hall of Fame still cannot read its list, a notice box on that page names the bug and opens [b]Repair mod storage[/b]: a sheet that explains everything, then a two-click button with a Cancel. It empties the storage and leaves one entry, the shared settings entry most mods with an options panel use, so those mods save settings normally from then on. It deletes every separate entry, including the one that was sorting first and was therefore the only one working. Saves, the history inside them, the game's settings and every mod's files are untouched. Full explanation: https://github.com/tmtmiller1/civilizationvii-demographics/blob/main/docs/civ7-storage-bug.md
[h2]Source and documentation[/h2]
[list]
[*][b]What's new:[/b] [url=https://github.com/tmtmiller1/civilizationvii-demographics/releases/latest]the latest release notes and a download[/url]
[*][b]Full documentation:[/b] [url=https://github.com/tmtmiller1/civilizationvii-demographics/blob/main/README.md]every page and figure, and how each is calculated[/url]
[*][b]The same as a PDF:[/b] [url=https://github.com/tmtmiller1/civilizationvii-demographics/blob/main/README.pdf]README.pdf, typeset with the screenshots[/url]
[/list]
[h2]For modders[/h2]
This mod is developed with [url=https://github.com/tmtmiller1/civilizationvii_tower-bench]Tower Bench[/url], a free, open-source test bench for macOS to make it easier to create Civilization VII mods.
[h2]Credits[/h2]
[list]
[*][b]Tower[/b], for design and Civilization VII implementation, including the History and Hall of Fame carried over from History & Rankings.
[*][b]robk[/b], creator of InfoAddict for Civilization V.
[*][b]Gedemon[/b], creator of CivGraphs for Civilization VI.
[*][b]Slothoth[/b], creator of Global Relations for Civilization VII, and for the keys to data persistence across ages.
[/list]
[h2]Special Thanks[/h2]
[list]
[*][b]Potato McWhisky[/b], for teaching me to love again, Civilization-wise (Civ VI), after growing up as a Civilization II, IV, and V player. Making this mod is an act of faith that the community will eventually help make Civilization VII as good as the previous entries.
[/list]
