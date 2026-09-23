[h1]Demographics[/h1]
[b]New in 2.7.3: the screen fits your resolution[/b]
The dashboard is now drawn to the size of the display it is played on, so 1080p, 1440p and 4K get the layout 2880x1800 always had: all three podium cards on screen, tab labels on one line, the war timeline inside its plot. The same sweep restored the screen's gold borders and every line of italic text, which the game's UI engine had been dropping. Plus a hardening pass over saved data and shared settings. For Civilization VII 1.5.0.
[b]History and the Hall of Fame[/b]
History & Rankings is part of Demographics: a [b]History[/b] tab that tells the story of your campaign, and a [b]Hall of Fame[/b] that ranks every campaign you have played, in game and from the main menu. Special thanks to [b]Slothoth[/b] for the keys to data persistence; a co-author credit is gladly offered.
Demographics adds graphs, civilization rankings, global relations, war history, campaign history and a Hall of Fame to Civilization VII, recording per-civ data every turn as charts, rankings and relationship views, so you can see how the world changes over a game. A spiritual successor to robk's InfoAddict (Civ V) and Gedemon's CivGraphs (Civ VI), extending Slothoth's Global Relations (Civ VII) with added diplomacy and filtering.
[h2]The Mod Includes[/h2]
[list]
[*]Historical charts, continuous across ages, for economy, power, knowledge, influence, resources, conflicts and Triumph progress.
[*]World Rankings: an All Civilizations matrix of current values and world rank for every metric, your civ pinned first. Click a metric to sort; flip each cell between Value and Rank.
[*]Global Relations: met civilizations and city-states in a ring layout.
[*]Copy-to-CSV, plus options for smoothing, unmet-name masking, eliminated civs, colorblind mode, and font size.
[*]Readable, un-minified source.
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
[*]Opens from World Rankings, the main menu, and the end-of-game screen.
[*]Hide short games or show all, on every page, with a count of what is hidden.
[/list]
[h2]Conflicts[/h2]
[list]
[*]A Gantt timeline of every war from diplomacy events: the declarer, supporters, and opposers share one stable war ID, so coalitions and multi-front wars read as a single conflict.
[*]Each war's cost is the observed change in participants' military, settlements, population, and production, read from recorded per-turn samples, never estimated.
[*]A per-war Graphs view plots those metrics over just that war's window and belligerents, with consistent generated war names across ages.
[/list]
[h2]Crises[/h2]
[list]
[*]The current age's crisis split into its stages (Begins, Intensifies, Culminates, Ends) as severity-colored bars matching the line-chart markers.
[*]A permanent per-stage cost table of every civ's losses, plus a Crisis Graphs grid charting each crisis statistic per civ across the whole game.
[/list]
[h2]Top Settlements & Cinematic Flyby[/h2]
[list]
[*]A ranked board of the world's largest cities and towns with owner, population, output and gold/silver/bronze medals.
[*]“View on map” flies the camera to any settlement; “Cinematic view” orbits its districts and wonders and finishes with fireworks; camera style and length are configurable.
[/list]
[h2]Pairs with Emigration[/h2]
[list]
[*]With the [b]Emigration[/b] companion mod installed, Demographics hosts a dedicated Emigration tab and a Net Migration graph beside Population. The hooks stay inert when it is not installed, so the base mod is unchanged.
[/list]
[h2]Languages[/h2]
Fully localized in English, German, Spanish, French, Italian, Japanese, Korean, Portuguese (Brazil), Russian and Simplified Chinese, with each language's own number formatting. Polish is included and in progress.
[h2]Notes[/h2]
Read-only and additive: it does not change balance, alter opponents, or overwrite base-game files. Per-save data storage; the Hall of Fame is kept on your computer. Triumph card progress overlays ship as a separate companion mod: triumphs-progress-overlay.
At 1280x720, the smallest supported resolution, some pages are still tight: everything is readable, but column headings and long leader names can be cut off. Higher resolutions are unaffected; a fix is next on the list.
[h2]A Civilization VII bug, and the workaround for it[/h2]
Civilization VII 1.5.0 has a bug in the storage mods use for their settings: whenever a mod asks for its own saved data, the game returns whichever mod's entry sorts first. Only that one mod's data works; the entry most mod option panels share can never be read back, so their settings reset every launch and the Hall of Fame cannot save its list of past games (every game is still stored in its own save). It is Firaxis's bug to fix; a reproduction is written up for them. When it blocks the Hall of Fame, a notice box on that page names the bug and opens [b]Repair mod storage[/b]: a sheet that explains everything, then a two-click button with a Cancel. It empties the storage and leaves one entry, the shared settings entry most mods with an options panel use, so those mods save settings normally from then on. It deletes every separate entry, including the one that was sorting first and was therefore the only one working. Saves, the history inside them, the game's settings and every mod's files are untouched. Full explanation: https://github.com/tmtmiller1/civilizationvii-demographics/blob/main/docs/civ7-storage-bug.md
[h2]Source and documentation[/h2]
[list]
[*][b]What's new:[/b] [url=https://github.com/tmtmiller1/civilizationvii-demographics/releases/latest]the latest release notes and a download[/url]
[*][b]Full documentation:[/b] [url=https://github.com/tmtmiller1/civilizationvii-demographics/blob/main/README.md]every page and figure, and how each is calculated[/url]
[*][b]The same as a PDF:[/b] [url=https://github.com/tmtmiller1/civilizationvii-demographics/blob/main/README.pdf]README.pdf, typeset with the screenshots[/url]
[/list]
[h2]Credits[/h2]
[list]
[*][b]Tower[/b], for design and Civilization VII implementation, including the History and Hall of Fame carried over from History & Rankings.
[*][b]robk[/b], creator of InfoAddict for Civilization V.
[*][b]Gedemon[/b], creator of CivGraphs for Civilization VI.
[*][b]Slothoth[/b], creator of Global Relations for Civilization VII, and for the keys to data persistence across ages; co-author credit offered.
[/list]
[h2]Special Thanks[/h2]
[list]
[*][b]Potato McWhisky[/b], for teaching me to love again, Civilization-wise (Civ VI), after growing up as a Civilization II, IV, and V player. Making this mod is an act of faith that the community will eventually help make Civilization VII as good as the previous entries.
[/list]
