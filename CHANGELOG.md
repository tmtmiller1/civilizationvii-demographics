# Changelog

All notable changes to the **Demographics** mod for Civilization VII. Loosely
follows [Keep a Changelog](https://keepachangelog.com/) and Semantic Versioning.
The Steam Workshop change note for each release is generated from the matching
section below by `release.sh`.

## [2.7.3] - 2026-09-23

Two passes in one release, and no new graphs.

The screen now fits the resolution it is played at. Before this, the same layout occupied about 1% of the screen's
height at 2880x1800 and about 2% at 1280x720, so on smaller displays the menus filled half the screen, only one of the
top-three settlement cards was visible, tab labels wrapped onto two lines and the timeline ran off the right edge.
2880x1800 renders exactly as it did; every other resolution now approximates that layout. Along the way a sweep of the
stylesheets found a class of styling this UI engine silently drops, which had been costing the screen its gold borders
and all of its italic text.

Alongside that is a consistency pass over how the screen reads. The Options button and the analytics-policy note
share one header row on every tab instead of costing a row of their own on some pages. Every page now draws from one
type scale, including the compact History boards that had been laid out in fixed pixels and ignored the Font Size
setting. The Hall of Fame's short-games filter is a single button on the sections line rather than two buttons on a
row of their own. Clicking a filter, a column header or a metric pill no longer throws away and rebuilds the parts of
the page that did not change, so headings, flourishes, yield icons and leader portraits stop blinking, and the page
tabs stop flicking back to their first entry.

The cinematic tour got the same treatment: its info panel is back in its own frame at the bottom of the screen, and a
flyby can no longer be clicked or hovered through to the game underneath. The sentence that panel writes about a
settlement also reads correctly again for every wonder in the game. It names each one in prose, so each needs to be
right about "the", and the list it checked against had fallen behind the game: wonders and natural wonders added since
that text was written all collected a wrong article, and one was listed under a spelling the game does not use. All 48
wonders and 19 natural wonders are now matched on their internal id rather than their name.

The rest is hardening: every change closes a way the mod could lose data, blank a panel, or step on another mod, found
by a code audit after the shared-storage bug in 2.7.1. Nothing there changes for a player whose game was already
working; the notes say what each change protects.

### Added
- **Resolution scaling.** The whole screen is drawn as one uniformly scaled frame against a 2880x1800 reference, with
  the scale bounded so text never drops below a readable size; text keeps its own, higher floor. Verified at 3840x2160,
  2560x1440, 1920x1080, 1600x900, 1366x768 and 1280x720: all three podium cards visible, both tab bars on one line,
  the ranked settlement list filling its column, and the war timeline fitting the plot with its end-of-age labels intact.
- **One header row for status and settings.** The Options button and the analytics-policy note now sit together at the
  top right, level with the title, on every tab. They used to cost a row of their own under the ranking and relations
  sub-tabs and at the foot of the chart pages.

### Fixed
- **Every framed box drew a white hairline instead of a gold one.** Cards, tables, stat chips, podium cards and the
  game pages all asked for the mod's copper, through the one-line `border-color` property. That property is a
  shorthand that writes four per-side values, and this UI engine silently drops a shorthand whose value uses a
  variable, so all 41 of those borders fell back to the body-text grey. They are written as four per-side properties
  now and draw the colour they always named. The stylesheet gate that was meant to catch exactly this did not list
  `border-color` among the shorthands; it does now.
- **Italic text was invisible everywhere it was used.** Thirteen stylesheet rules and three chart labels asked for
  italics, which draw nothing on this engine while `getComputedStyle` still reports the style that was asked for, so
  nothing warned. The affected text is now upright and visible: the "no settlements", "no wonders" and "no data"
  placeholders, the civ-ranking score note, a settlement's founding year, the "(formerly ...)" line on a renamed
  civilization's column, the parenthetical subtitle under a chart title, the war-tooltip and glossary notes, the
  adjacency and conditional-yield lines on the Quarters and Pantheon boards, and the map overlay's type and flavour
  lines. The stylesheet gate now fails on `font-style: italic` or `oblique`, in a sheet or in an inline style.
- **Border and background styling that never rendered.** Thirty declarations across three stylesheets used a
  variable inside a shorthand, which the game's UI engine silently drops: the time-range pills had no border or fill,
  and the ranked settlement rows never showed their civilization colour stripe. The stylesheet gate now sweeps every
  sheet for this, and for other constructs the engine drops (`clamp()`, `min()`, `max()`, `max-width: none`).
- **The second-place card was missing its left edge.** Its border was a shade under one pixel wide, which rounds away
  on whichever edge falls badly once the screen is scaled. It is a whole pixel, as the section cards already were.
- **The short-games filter collided with the section tabs.** "Hide short games" sat at the right end of the tab row and
  overlapped the bar's frame. It qualifies every section, so it now sits on the Hall of Fame's own title line.
- **A stray info icon under the Civilization Rank by Yield tabs.** The page carried a one-line hint about clicking a
  column to sort and using the Rank / Value toggle. Its text was styled italic, which this UI engine lays out at zero
  height and does not draw, so all that reached the screen was the hint's info icon, hanging on its own between the tab
  row and the buttons. The hint is gone; the toggle beneath it already says what it does.
- **The page tabs jumped to their first entry on every click.** On Global Statistics, Migration and Geopolitics,
  every metric pill and every filter (the year range, Civ / Leader, Wonders on/off) redrew the whole page, and the
  row of page tabs was rebuilt with it. A freshly built tab row shows its first tab for a frame before it takes the
  selection it was given, so "Yields per Turn" lit up and snapped back on each click, whatever page you were on. The
  row is now kept across those redraws and rebuilt only when its tabs or selection actually change. The Campaign
  History tab's own page row (Chronicle / Timeline / Lineage) did the same on every Chronicle pill, and the Hall of
  Fame's section tabs on its own screen did it whenever the short-games filter was toggled; both are kept the same
  way.
- **Icons and flourishes blinked on every click that redrew a page.** Choosing a filter, switching Rank / Value,
  sorting a column, picking an age, hiding a civilization or changing the timeline's zoom rebuilt the whole page, so
  headings, flourishes, yield icons and leader portraits were thrown away and re-made even though nothing about them
  had changed. Every one of those controls now keeps the parts that did not change and swaps only the parts that
  did:
  - **Settlement Rank by Yield** and **Civilization Rank by Yield** keep their chips, headings and column headers and
    swap only the rows beneath them. Switching Rank / Value rewrites the figures in the cells the civilizations
    already occupy, so the leader portraits stay put too.
  - **Top 25 Settlements** keeps its age pills, both headings and the list header when you switch between the live
    board and an end-of-age one.
  - **Civilization Rank by Yield** at narrow window sizes, where it draws as a grid of civilization columns, now
    rebuilds only the column you hid or restored. Hiding one civilization used to redraw every other civilization's
    portrait and the whole metric column beside them.
  - **Geopolitics** keeps every leader portrait on the relationship ring while you change the filters. The ring shows
    the same civilizations whichever filters are on, and only the lines between them change, so the portraits
    no longer flicker each time you toggle one.
  - **Campaign History's timeline** keeps its civilization filter and its legend while you change the age window or
    the zoom, which change neither. Its milestone medallions, disaster markers and age-band emblems are kept too: a
    zoom step moves nothing on the chart, only the width it is drawn across, and an age window keeps every event that
    appears in both.
- **The war timeline's crisis labels sat on the first war names.** The labels were drawn from the top of the plot,
  over the first two bars, which reads clear only at 2880x1800, where the war names happen to end well to the left of
  them. Text is held at a readable floor on smaller screens while the layout keeps shrinking, so at 1280x720 the first
  two names ran straight under "Crisis Begins" and "Crisis Intensifies". The plot now reserves a band at the top for
  the labels, sized to the type scale in use, and the bars start below it.
- **The war timeline was clipped on the right at every resolution.** Its minimum density made a long game wider than
  the plot without a way to scroll; it now fills the plot, keeps the deliberate tail room after the present turn, and
  moves a label that would overrun the edge to the other side of its line.
- **Line charts stopped short of the right edge on narrow plots.** The room reserved for the widest crisis label is
  now capped at 12% of the data span, so the series reach the axis instead of leaving a quarter of the plot empty.
- **War tooltip text collided at the Large font size.** The row-label and value columns are sized against the type
  scale and widened; an ongoing war's duration no longer shows a negative turn count; and on scaled (smaller)
  resolutions the tooltip is placed at the cursor instead of past the edge of the frame.
- **War tooltip lost its lower rows on small screens.** A six-belligerent tooltip is taller than the whole timeline
  area at 1280x720, and the timeline's scroll box cut off everything below "Prod. Directed to War". The tooltip now
  sits on the screen frame, so it can use the full frame height, and scales itself down (to a floor) if even that is
  too short.
- **A wonder tooltip near the right of a chart was cut off by the panel edge.** Hovering a wonder marker there drew
  its tooltip to the icon's right whatever room was left, so the description was clipped mid-word. The tooltip already
  knew to flip to the icon's left when it would not fit, but it measured itself on the same frame it was revealed, and
  this UI engine reports a freshly shown element as zero wide until the next one: with no width, the flip could never
  trigger and the edge clamp did nothing. The tooltip now settles its position on the following frame, and remembers
  the size it last measured so the next hover is placed correctly straight away.
- **A wonder's description showed the game's own formatting codes.** Hovering a wonder marker on a graph printed the
  raw text the game stores around the words: `[B]`, `[icon:YIELD_GOLD]`, `[TIP:...]` and their closing tags,
  because the mod asked the game for the text but never for its formatting. Wonder descriptions now render the
  way they do everywhere else in the game, with bold text and real yield icons. The unique-quarter line in the
  city cinematic had the same source and now reads as plain words.
- **Wonders and natural wonders added since this text was last revised read correctly.** The cinematic's prose
  names each wonder in a sentence, so each one needs to be right about "the": "the Hanging Gardens" but "Petra".
  The exception list had been matching on the displayed name and had fallen behind the game, so the wonders and
  natural wonders added since it was written all collected a wrong "the" - and one it did list was listed under a
  spelling the game does not use, so "the Machu Pikchu" slipped through. Every wonder and natural wonder in the
  game is now checked against its internal id instead of its name, which cannot drift with spelling or language:
  Erdene Zuu, Himeji Castle, El Escorial, Machu Pikchu, Nan Madol, Mount Fuji, Torres del Paine, Thanh Hue and the
  rest read as plain names, while the Byrsa, the Colosseum, the Grand Canyon and the Valley of Flowers keep their
  article.
- **Compact History pages ignored the Font Size setting.** The Wonders, Religion, Quarters and Buildings boards were
  laid out in fixed pixels with their own literal font sizes; they now use the shared type scale like every other page.
- **Shared settings storage can no longer be emptied by a failed read.** When the game's storage throws on a read, or
  returns nothing from a store that holds other mods' entries, Demographics now refuses to write for the rest of the
  session instead of writing back a store holding only its own entry. After every write it reads the store back and
  stops writing if its own entry is not what comes back, so a foreign entry is never copied into the shared entry on
  every option change. The Hall of Fame archive follows the same rules (it previously wrote on a single empty read,
  every turn).
- **The Hall of Fame page says when settings are not being saved.** Its storage note now also covers the mod's
  settings: when settings changed in the session are kept in memory only, the note says so and why, with Repair
  storage as the fix, instead of a console line nobody sees.
- **Loading a save from a newer Demographics no longer destroys its data.** A history, campaign or settings entry
  written by a newer build, or one that fails to parse, used to be replaced by an empty one on the next turn. The
  unreadable value is now parked beside its key and restored when a build that can read it loads the save; a newer
  settings schema keeps its version stamp.
- **Chart history has a size budget.** The per-save history is thinned further when its serialised size passes 3 MB
  and a warning is logged past 6 MB, so a long twelve-civilization game cannot grow the save without limit. The
  in-memory history is also no longer written into a different game's empty save.
- **Blank panels now say so.** A throw inside any view (Rankings, Relations, History, the Hall of Fame, every chart
  re-render from a click, hover or resize) shows "Chart failed to render" in place instead of an empty panel, and the
  Hall of Fame detail page keeps its Back button when the page fails. Records and samples with missing or null parts,
  as an older build or another mod may leave them, no longer throw in any view.
- **The unused in-screen Options view left the shipped mod.** Its player settings moved to the game's Options screen
  in June; what remained on it (Clear history, Reset war history, a forced sample, storage tuning knobs, a session
  readout) was development instrumentation no screen mounted, and not something a player should be able to do. It now
  lives under `devtools/` with its own harness.
- **Recording no longer stops for good after three scattered errors.** The sampler's kill switch counts consecutive failures, not the session total, so
  three stale-handle errors over a long game no longer stop recording for good. A second transition into the same age
  in one session (replaying an autosave, a second game) is no longer skipped. City founding stamps and capture
  listeners are cleared on a new game or a UI reload. Chart.js instances are destroyed when the screen closes.
- **Multiplayer: a guest can no longer change what the host's companion mods show.** Each seat publishes its effective analytics policy under its own key; the shared key is written only
  by the host or in a single-machine game, so a guest can no longer change what the host's companion mods show.
  Emigration 3.1.2 reads the per-seat key.
- **The cinematic tour's info panel is back at the bottom of the screen, in its own frame.** The panel that
  names the settlement and tells its story - the laurel and rank, the city's name and leader, the prose, the
  population and wonder row, the flyby counter and the Back button - had come loose: it drew as a bare black band
  across the top of the screen with no padding and no plate. Its size rules were written against a unit that is
  published on the Demographics screen, and the panel is mounted over the map rather than inside that screen, so
  every one of those rules was dropped: it lost the offset holding it to the bottom, both width bounds and all of
  its padding. It is a compact, padded, bottom-centred plate again, and it now scales with the resolution like
  every other surface.
- **The cinematic tour cannot be clicked or hovered through.** For the length of a flyby the only things that
  respond are Back and Escape. Previously the game's own interface stayed live behind the tour, so a leader
  portrait opened diplomacy and a tile raised its tooltip over the shot.
- **The cinematic tour ends cleanly when something else interrupts it.** An interface-mode change caused by
  something else (End Turn, a diplomacy screen) ends the tour without reopening Demographics on top of it.
- **Escape closes the Demographics screen**, as it already closed the Hall of Fame.
- **Endgame button: a missing anchor row is named in UI.log.** When the end-of-game screen mounts without the row the button goes into, one error line in
  UI.log names the missing selector instead of the button silently not appearing.
- CSS custom properties are now prefixed `--dg-ia-` so another mod's `--ia-*` variables cannot recolor the screen.

### Changed
- **The three best games wear their medals.** Each podium place now shows the gold, silver or bronze laurel wreath the
  in-game rankings use, with the place number inside it, and the card's whole frame carries that place's colour over
  the fade it already had. Triumph counts are marked with the same laurel the World Rankings score line uses.
- **The Hall of Fame's short-games filter is one button on the sections' line.** It was two buttons on a row of their
  own: "Hide short games" and "Show all games", with the active one lit, which reads as two commands where there is
  only one choice. There is now a single button naming the state you are not in, beside the count it hides, level with
  the section tabs. It disappears entirely when no game would be filtered. The sections stay centred on the full width;
  where there is not room for both on one line, at 1280x720, the filter drops to its own line rather than pushing them
  off centre.
- **The line-chart legend covered the data on short screens.** Below 1366x768 it lays out as a two-row strip along the
  top of the plot instead of a column down its left side.
- **Hall of Fame footer note removed.** "Games are saved on this computer" restated what the page already showed and
  rendered at the smallest type size; the storage-problem note that carries a repair action is unchanged.
- **The cinematic's info panel is very slightly more see-through**, so a little of the shot reads behind it.
- **Podium headings carry one flourish instead of two.** The flourish above "The Greatest Settlements" / "Civilizations" is gone; the one below stays.
- The type scale has one source in JavaScript and one declaration in CSS, and the test suite fails if they drift.

### Known issues
- **At 1280x720 some pages are still cramped: column headings and long leader names can be cut off.** The layout and the text have different lower bounds: the layout stops
  shrinking before the text does, so on the smallest supported screen the boxes are too small for the words in them. Top 25
  Settlements shows about two and a half podium cards, and Civilization Rank by Yield can cut its right-hand column at
  the frame edge and shorten long leader names. Everything is reachable and readable; it is tighter than it should be.
  Higher resolutions are unaffected. The fix is a design change to how the two bounds relate, and it is the next thing
  on this mod's list.

### Added (release gates, not shipped)
- `test:storage-invariants`: no file may write a top-level storage key other than the shared one, reset it, or clear
  the store outside the repair.
- `test:core-imports`: every base-game module the mod imports must exist in the installed game.
- `test:loc-keys`: every LOC key referenced in code must exist in the English text or the base-game registry.
- `test:control-assets`: every HTML/CSS asset a screen registers must exist and be declared in the modinfo.
- The stylesheet gate sweeps every sheet for constructs this UI engine silently drops: a variable inside a shorthand
  (`border-color`, `border`, `background`, `padding`, `margin`), `font-style: italic`, `clamp()`, `min()`, `max()` and
  `max-width: none`.
- The modinfo test now fails on a runtime import cycle.

## [2.7.2] - 2026-09-22

### Changed
- **Networked multiplayer: only the host stores the campaign.** In an internet, LAN or cloud game the host owns the
  shared game configuration, so only the host now writes the History campaign into it; guests keep the campaign in
  memory (History and the Hall of Fame keep working live) and, on loading, take the host's stored copy with their own
  civilization as the viewpoint. Samples are taken once per game turn, whichever seat starts it, so a hotseat game no
  longer records every seat's turn separately. Single-player and hotseat are unchanged (both watched). This is the one
  behaviour in the History capture that differed between single-player and a networked game, and the change is made in
  response to a report of a crash in multiplayer that could not be reproduced in hotseat; it has not yet been watched in
  a two-client networked game.

## [2.7.1] - 2026-09-22

A workaround for the Civilization VII storage bug that blocks the Hall of Fame, and the short-games filter on every
Hall of Fame page. All new text is localized across all 11 languages.

### Added
- **Repair mod storage.** Civilization VII 1.5.0 has a bug in the storage mods use for their settings: whenever a mod
  asks for its own saved data, the game returns whichever mod's entry sorts first. Only that one mod's data works; the
  entry Demographics and most mod option panels share can never be read back, so those mods' settings reset every
  launch and the Hall of Fame cannot read or save its list of past games (every game is still stored in its own save).
  It is Firaxis's bug to fix, and a reproduction is written up for their support portal. Until then, when it is blocking
  the Hall of Fame, a notice box on every Hall of Fame page says so; clicking it opens a sheet that explains the bug and
  what the button does, then a two-click **Repair storage** button with a Cancel. The repair empties the shared storage
  and leaves one entry in it, the shared settings entry used by most mods with an options panel, holding Demographics'
  settings and past game information; being the only entry, it is what the game returns, so the mods that use it load
  and save their settings normally from then on. It deletes every separate entry, including the one that was sorting
  first and was therefore the only one actually working. Saved games, the history inside them, the game's own settings
  and every mod's files are untouched. Nothing changes for anyone who never clicks it, and it is offered again if a mod
  writes its own entry later. The whole story is in `docs/civ7-storage-bug.md`.
- **Hide short games / Show all games on every Hall of Fame page.** The filter used to sit on Rankings only, so Best
  Games, Leaders, Civilizations and Records could look empty while unfinished games under 20 turns were hidden. It now
  sits under the section tabs on every page and says how many games it is hiding.

## [2.7.0] - 2026-09-22

A History release. The former History & Rankings mod is now part of Demographics: a new **History** tab tells the story
of your campaign, and a **Hall of Fame** under World Rankings, also reachable from the main menu, ranks every campaign
you have played. All new text is localized across all 11 languages.

### Added
- **History tab: Chronicle.** Your campaign's history, grouped by age. Each age opens with a summary of your
  civilization's deeds (settlements founded, captured and lost, wonders, Triumphs, wars, the religion you founded,
  civilizations destroyed), followed by every recorded event: settlements founded, taken or lost, wonders completed,
  wars and peace, religions founded, Triumphs earned, crisis stages, natural disasters that strike a civilization's
  land, first contacts, eliminations, new ages and victories. Filter by age or by kind of event, newest or oldest first.
  Events about civilizations you have not met stay hidden, following the analytics policy.
- **History tab: Timeline.** The whole game on one chart. A banner per age carries your civilization's emblem and the
  age's dates. Below it run lanes for your wars (in the enemy's color, with their emblem), each age crisis stage by
  stage, then one lane per kind of milestone (Wonders, Triumphs, Religion, Conquests, Victory & falls) drawn with the
  game's own icons, such as each wonder's art and each religion's symbol. Then come every settlement you founded,
  natural disasters, migration in and out (with the Emigration mod), your population curve with its milestones, and a
  turn ruler. Pick all ages or one, zoom from 1× to 8×, pan, click the ruler to move the cursor, or press **Play** to
  sweep through the game with each event named as it passes. Everything has a tooltip, and hovering the population lane
  reads out the population at that turn.
- **Civilization filter.** A **Civilizations** row above the timeline picks whose story it shows. Every game opens on
  your own; add any civilization you met, or **All**, to see their milestones, settlements, wars with each other,
  disasters on their land and population line on the same lanes.
- **Territory map.** A hex map of the world above the timeline, laid out like the game's own minimap with one cell per
  tile: terrain by biome, each civilization's land tinted in its color, settlements marked, and land you had not yet
  explored left blank. It follows the timeline's cursor, so playback replays each empire's expansion and your
  exploration. Civilizations you have not met stay off it.
- **History tab: Lineage.** Every leader you have met, with the civilization they led in each age in their color, and
  the turn a line ended.
- **Hall of Fame.** A fifth World Rankings page listing every campaign played on this computer, the current one
  included. It opens on **Best Games**: your totals, a podium of your three best games, the rest of your top ten, and
  the game you are playing at its rank between its neighbours (from the main menu, your most recent game). Then
  **Rankings** orders the games by result, then Triumphs across every age, then fewest turns, each with an honorific
  from Augustus Caesar down to Ethelred the Unready, followed by leader and civilization tallies and records. Each game
  opens a page with its leader, lineage and figures on one row, the territory map beside its rivals, its timeline with
  playback, and its highlights across the page, age by age. Population shows as **Scaled Pop** (Demographics' real-world
  figure) or **Civ Pop**. Any game can be removed under **Game options** at the foot of its page, and short unfinished
  games are hidden unless you ask for them.
- **Room for every game.** A Hall of Fame full of long games keeps every game's timeline: names are stored once for the
  whole archive instead of inside each game, and positions are rounded, so a game with its whole story costs about a
  third of what it did. Territory maps, being the largest part, are kept for the most recently played games; past that,
  the older games give up their maps and then the other civilizations' timeline tracks, and only then is a game dropped.
  The game being played is always kept whole. Recording the same game twice (a save from before Demographics was added,
  loaded again) updates its one entry.
- **Every Triumph explained.** In a game's highlights, each Triumph now says what it was earned for and what it gave, in
  the game's own words. They are saved as the Triumph is earned, so they still read at the main menu and in ages the
  game has moved on from.
- **Leaders and Civilizations read clearly.** Each card gives its win rate over finished games as a bar, green for the
  games won and red for the rest, with both parts named and given their share, and the attempts, most Triumphs and
  average length beside it. A leader you have not finished a game with shows a grey, empty bar.
- **Every Hall of Fame page is titled**, with a line saying what is on it, so a page opened from the main menu says what
  it is.
- **Hall of Fame on the main menu.** A **Hall of Fame** button on the main menu opens it with no game loaded.
- **Results screen lands on the Hall of Fame.** The Demographics button on the end-of-game screen now opens World
  Rankings on the Hall of Fame, so you see where the finished game ranks.

### Known issues
- **Another mod's saved data can keep the Hall of Fame from storing past games.** Because of a Civilization VII storage
  bug, when another mod has saved data under a name that sorts ahead of the shared mod-settings entry, the game returns
  that data in its place. Demographics then leaves stored games alone, so no mod's settings are disturbed: the Hall of
  Fame shows the game being played and the games whose saves you load, and a note under it explains why.

## [2.6.0] - 2026-09-22

A World Rankings release. Top 25 Settlements gains holy-city badges, world-leader icons, wonder completion dates, and
an end-of-age board that keeps each finished age's top ten; all four World Rankings tabs now share one look, with
podium-colored top rows and your own civilization or settlements outlined; category leaders are marked in the tables
themselves; and Civilization Rank by Yield is split into two readable tables. Founding years and population trends
now survive quitting the game. All new text is localized across all 11 languages.

### Added
- **End-of-age settlement standings.** Once an age ends, the Top 25 Settlements view shows a pill row: "Now" plus one
  pill per finished age, such as "End of Antiquity". Each archived board holds the top 10 settlements as last recorded
  in that age, with their owners, scores, yields and wonders as they stood then. Settlements owned by civilizations you
  have not met stay masked, and archived rows have no camera buttons, since the city may have been razed or captured
  since.
- **World-leader icons.** Under each rank number in the Top 25 list, small yield icons mark every output that
  settlement leads the whole world in, not just the rows shown.
- **Holy-city badge.** A settlement that is the holy city of a founded religion shows a "Holy City" badge with the
  religion's icon, and the religion's name on hover. The game only reports a holy city by name, so a settlement whose
  name is shared with another settlement gets no badge rather than a guessed one. For civilizations you have not met,
  the badge hides the religion.
- **Wonder completion dates.** Hovering a wonder icon in the Top 25 list shows the year it was completed, and the
  cinematic tour captions use the same date. A wonder is dated only when its completion was actually seen: one that
  already existed when the history began, or that changed hands by capture, stays undated.

### Fixed
- **Founding years and population trends now survive quitting the game.** Both were kept in the mod's settings, which
  Civilization VII does not reliably keep between launches, so every time the game started they began again from
  scratch: every settlement read as founded "around" the first turn you played after launching, and the rising and
  falling population arrows had no history to compare against. They are now saved inside the game file with the rest
  of the Demographics history, so they carry over when you load a save and across age transitions. Settlements
  founded before this update get an approximate founding year the first time they are seen.

### Changed
- **One look across all four World Rankings tabs.** In Civilization Ranking, Civilization Rank by Yield, Top 25
  Settlements and Settlement Rank by Yield, places 1-3 carry a faint gold, silver or bronze wash that echoes the podium
  medals, and your own civilization or settlements get the same gold outline so you can find them at a glance. In the
  two yield tables the wash follows whichever column you sort by. Civilization Ranking also shows the world-leader icons
  under each rank, like Top 25.
- **Category leaders are marked in the tables.** The rows of "Category Leaders" cards above both Rank by Yield
  tables are gone; instead the cell of whoever leads each column has a gold wash, and hovering it names the category
  ("World leader in Gold"). Ties are all marked, and a column where everyone is level (for example, no one has any net
  migration yet) marks no one. The tables now start at the top of the tab.
- **Civilization Rank by Yield is two tables instead of one.** The single sheet of about 40 columns is split: the
  columns with icons (score, treasury, the per-turn yields, GDP, population, wonders and the like) stay under
  Civilization Rank by Yield, and the counts (land, cities and towns, conquests, units, great works, migration) move
  to a second table below, Totals & Tallies. Each table has twice the room per column. Both share one sort, so
  clicking any column orders the civilizations the same way in both and their rows line up; the page scrolls once
  instead of each table scrolling on its own.
- **Civilization Rank by Yield headers are readable.** Every column label now uses one size, large enough to read,
  and wraps onto two lines; before, short names like "GDP" and "Faith" stayed large while longer ones shrank until
  they could not be read.
- **Your row in Civilization Rank by Yield no longer turns solid gold.** The highlight is the thin gold outline the
  other tables use, so the numbers in your row stay legible.
- **The two podiums match.** The Civilization Ranking podium cards now follow the Top 25 cards line for line and are
  the same size: civilization name, its capital, leader, population and settlement count, and View on map / Cinematic
  view buttons that go to the capital (unavailable for civilizations you have not met or whose capital you have not
  seen, as on Top 25). Long second lines stay on one line so all three cards keep one height.
- **Podium names are sized as intended.** On the Top 25 podium, the civilization and leader lines under each settlement
  name now step down in size as designed; both had been falling back to one default size.

## [2.5.2] - 2026-09-16

A compatibility and robustness release. Everything works unchanged on Civilization VII 1.5.0: the dock button,
dashboard, charts, and every data source were checked against the new patch, and the Babylon, England and Gaul
civilizations added with it are handled throughout. The release also fixes an end-of-game button that had never
actually worked, and stops the mod from writing unrelated data into the settings store that Options-page mods share.

### Fixed
- **War names use the right adjective for every shipped civilization, including the new Babylon, England and Gaul.**
  War names read a civilization's adjective from the game's own text and only fall back to a bundled list when a war
  record predates that field. Several entries in that list were keyed to names the game does not actually use, so the
  fallback invented adjectives instead: Gauls became "Gaulsan" and Babylon "Babylonan". Every shipped civilization was
  audited against the game's own name and adjective strings and the list corrected, which also fixes Great Britain,
  Achaemenid Persia, French Empire, Meiji Japan, Sengoku Japan, Hawai'i, Mongolia, Maya, Goryeo, Joseon and Nepal.
- **The Demographics button now appears on the end-of-game screen.** It had never appeared since shipping in 2.5.0.
  The check that recognised the screen compared the element's tag name in lowercase, but the game's UI layer reports
  tag names in uppercase, so the check never matched and the button was skipped with no error. The pause-menu button
  was unaffected. The button now also attaches to the separate results screen 1.5.0 introduced, and is placed in that
  screen's own button row rather than falling back to a corner of the display.

### Changed
- **The shared mod-settings store is no longer overwritten with unrelated data.** When the game's storage layer
  returns another mod's data in place of the settings store, Demographics now leaves the store untouched for the
  session instead of saving that data back into it. Settings keep working normally while you play. Nothing is ever
  deleted or rewritten.
- **Internal: the module graph is now acyclic.** The sampler's shared helpers and the Historical Data page catalogue
  moved into dedicated modules, clearing the circular imports the game reported on every load. No behaviour changes.

## [2.5.1] - 2026-07-17

### Changed
- Renamed the two scatter metrics for clarity across all 11 locales: "Fingerprint" → "Power & Science" and "Soft Power" → "Happiness & Influence" (titles simplified to match).
- Renamed the Society-page "Natural Wonders" pill to "Natural Wonders Discovered".
- Enlarged scatter-plot points (radius 7→9, hover 9→11) for readability.

## [2.5.0] - 2026-07-17

The largest data release since the mod launched, in two halves.

**New history to explore.** A new **Religion** page tracks pantheons, founded-religion
standings, spread and followers-by-population. **Wonders & Races** boards show the race for
each wonder, a **Settlements Atlas** charts empire footprint, and by-type breakdowns open up
units, buildings and districts. Fifteen new metrics — Faith, Tourism, Great People, Great
Works, Cities, Towns, Units Killed/Lost, Combats, Wars Declared/Received, Conquest and more —
join the existing graphs. The dashboard is now reachable from the **end-of-game screen and
the pause menu**, and pages with nothing to show hide themselves.

**World Rankings usability and consistency**, built from AndySafik's playtest feedback: the
**Civilization Rank by Yield** screen can once again be a sortable civs-as-rows table; several
screens now lead with the civilization rather than the leader; and the settlement showcase
makes ownership clearer.

All new labels are localized across all 11 languages.

### Added
- **A new Religion page.** In Antiquity it shows the pantheons each civilization chose and
  their yields; from Exploration onward it shows founded-religion standings, spread over time,
  and followers as a share of population. The page is age-gated, so only the set that applies
  to the current age is shown.
- **Wonders & Races boards.** A wonders board and a per-wonder race view on the Society page,
  built from wonder data the mod already samples.
- **Settlements Atlas.** A size-distribution and urbanization view of the empire footprint on
  the Settlements & Land page.
- **By-type breakdowns.** Units trained/killed/lost by unit type on the Military page, and
  buildings and districts by type (including a Quarters board) on Settlements & Land — with
  localized type names, stacked by civilization.
- **Fifteen new metrics.** Society gains Faith, Tourism, Great People and Great Works;
  Settlements & Land gains Cities, Towns and Settlement Cap; Military gains Units Killed,
  Units Lost, Combats, Wars Declared, Wars Received, Settlements Conquered and Conquest %;
  Natural Wonders joins the wonder group.
- **Reach the dashboard at the end of a game.** A Demographics button now appears on the
  end-of-game results screen and in the pause menu, so the history stays reachable once the
  subsystem dock is gone.
- **Empty pages and metrics hide themselves.** A metric with no data no longer shows an empty
  graph — it is hidden, and pages and hubs whose metrics are all empty are hidden too.
- **Civilization Rank by Yield is sortable again — responsively.** The screen now
  renders a civs-as-rows table with click-to-sort yield columns (Score, Food, Science,
  …) when there is width for readable headers, and automatically falls back to the
  wide civs-as-columns matrix at very large Interface Sizes (where the matrix's font-fit
  keeps ~22 columns readable, as the 2.3.2 rework intended). The local player's row is
  highlighted, unmet civilizations stay masked, and a `worldRankingsAllCivsLayout`
  setting (`auto`/`table`/`matrix`) can pin the layout.

### Changed
- **Civilization-first labels for consistency.** Graph legends and tooltips now read
  "Civilization (Leader)" instead of "Leader (Civilization)"; the Civilization Rank by
  Yield column headers and the All Settlements owner cell lead with the civilization,
  with the leader as the secondary line — matching the screens that already did so.
- **Clearer settlement ownership.** The Top 25 Settlements podium cards now show a
  Settlement / Civilization / Leader hierarchy, and each row of the full settlements
  list shows the owning civilization beneath the settlement name.

### Fixed
- **Two-word names stay on one line.** "Great Britain", "Achaemenid Persia" and long
  settlement names no longer wrap onto a second line in the Civilization Ranking and
  Top 25 Settlements podium cards — the cards were widened and the name is kept to a
  single line (with an ellipsis only when genuinely out of room).

## [2.4.5] - 2026-07-11

A localization release. Polish is now fully translated, the settlements cinematic
localizes rank words through the whole Top-25 ranking, and three diplomacy action
labels that always showed in English are now localizable. Also folds in two fixes
staged since 2.4.4. English renders exactly as before.

### Added
- **Polish (pl_PL) is now fully translated.** The Polish locale previously shipped as
  English placeholders; every string is now translated (contributed and tested in-game by
  AndySafik).
- **The settlements cinematic localizes rank words through the full Top-25.** `ORDINAL_TAG_MAX`
  was raised from 6 to 25 — the cinematic overlay drives the entire Top-25 ranking, not just
  the Top-6, so ranks 7–25 now draw their ordinal word from `LOC_DEMOGRAPHICS_SETTLEMENTS_ORDINAL_7..25`
  and can be grammatically inflected per language. English and every other locale render as
  before (English word / bare number fallback until translated).

### Fixed
- **Three diplomacy action labels now localize.** *Share Innovations*, *Pioneering*, and
  *Give Influence Token* do not resolve through `GameInfo.DiplomacyActions.lookup(...).Name`,
  so they always displayed in English (title-cased enum name). `diplomacyActionLabel` now
  checks `LOC_DEMOGRAPHICS_DIPLOMACY_ACTION_{SHARE_INNOVATIONS,PIONEERING,GIVE_INFLUENCE_TOKEN}`
  before the engine lookup / title-case fallback.
- **War cost figures no longer bleed across ages.** The War tooltip and War Graphs cost
  tables windowed the whole-game sample stream by age-local turn numbers (which reset each
  age), so a war fought after Antiquity mixed in same-numbered turns from earlier ages and
  showed inflated losses/net/casualties. The sample stream is now scoped to the war's own
  age before windowing, and an ongoing war is bounded by its age's last turn.
- **Population and storage-cap numbers respect the game language.** A couple of readouts
  used JavaScript number formatting (always English grouping in-engine) instead of the
  mod's locale-aware formatter.

## [2.4.4] - 2026-07-09

A localization release. The Top-6 Settlements cinematic now draws its rank word
from localization tags, so translators can supply grammatically-inflected forms
instead of the mod hardcoding English. English and every other language render
exactly as before.

### Added
- **The Top-6 cinematic rank word is now localizable.** The "Recognized as the
  _sixth_ greatest settlement in the world" line previously hardcoded the English
  ordinal word and fell back to a bare number in every other language. The six
  ranks now resolve through dedicated tags
  (`LOC_DEMOGRAPHICS_SETTLEMENTS_ORDINAL_1`–`_6`), so languages that need
  grammatical inflection (e.g. Polish) can provide a properly declined form. The
  tags ship in all eleven locale files; English keeps its existing wording and the
  already-translated languages keep the numeric form their sentence frames are
  built around, so nothing changes on screen until a translation is supplied.

## [2.4.3] - 2026-07-06

A code-quality and test-hardening release. There are **no gameplay, UI, or
behavior changes** — the mod runs exactly as 2.4.1 did. This release only
strengthens the automated safety net behind two of the mod's trickier
subsystems so future changes are less likely to regress them.

### Internal / Quality
- **New branch-coverage tests for the war tracker.** The Conflicts sampler — the
  code that detects active wars, ingests each war event's diplomatic data, and
  runs the per-turn war tracker — gained dedicated test suites
  (`sampler-wars-detect`, `sampler-wars-ingest`, `sampler-wars-core`) that
  exercise its edge cases (missing engine data, duplicate declarations, ally and
  city-state augmentation, record migration). These are wired into the release
  gate, so a bad edit to war detection now fails `verify` instead of shipping.
- **New branch-coverage tests for the crisis cost model.** The Crises cost table
  (`crisis-cost-model.js`) — participant ordering, age-column merging, and
  cost aggregation — is now covered by its own `crisis-cost-branches` suite,
  also part of the release gate.
- **Targeted mutation-testing config added.** `stryker.full.targeted.json`
  mutation-tests the crisis cost model and the entire wars-sampler pipeline
  (detect / ingest / core / augment) against the new suites, to confirm the
  tests actually catch injected faults rather than just executing the code.
- **Lint gate tightened.** Three per-file `max-lines` exemptions (the metrics
  catalog, the screen controller, and the storage facade) were removed now that
  those modules fit the standard limit; the modularization gate applies
  uniformly with no remaining per-file waivers.

## [2.4.1] - 2026-07-05

Completes the font-size-setting support across the whole screen, plus two fixes.

### Fixed
- **Every screen now honors the in-game font-size setting.** 2.4.0 brought this to
  World Rankings; the remaining tabs — Historical Timeline, Global Statistics,
  Geopolitics/Relations, Conflicts, Options, and the shared chrome — sized their
  text with hardcoded values (many via `clamp()`, which Coherent silently drops),
  so they ignored the setting. All of it now routes through the same font-scale
  bridge, and the mod's ad-hoc font sizes are consolidated onto one small type
  scale.
- **Global Relations ring: leader portraits sit inside their circles again.** After
  the ring capped its own height to stay on-screen, the portrait overlays measured
  the pre-cap (taller) box and used a slightly larger scale than the SVG, flinging
  the outer portraits off their nodes (proportional to distance from center). The
  overlays now paint a frame later, after the cap has reflowed.
- **Triumphs legend no longer shows a "□"/"[]" box.** The per-civ total was prefixed
  with a "Σ" glyph that isn't in the Latin UI font, so Coherent drew it as a
  missing-glyph box. The total now reads in parentheses, e.g. "Rome (5)".

The World Rankings screens now honor the in-game font-size setting.

### Fixed
- **World Rankings respects the in-game font-size setting (small / medium / large /
  extra large).** Every World Rankings page — Civilization Ranking, Civilization
  Rank by Yield, Top 25 Settlements, Settlement Rank by Yield, and the category-
  leader cards — sized its text with hardcoded values that only tracked the global
  UI scale, so the font-size setting did nothing to them (unlike the base game).
  Root cause turned out to be two engine quirks: the game applies the font-size
  setting by regenerating its own `text-*` classes (which don't reach fixed-`rem`
  mod content), **and** Coherent Gameface silently drops `font-size: clamp()` — so
  the mod's entire `clamp()`-based responsive-font layer had never actually applied.
  The screens now read the setting in JS and publish each size as a CSS variable
  the stylesheets reference, so all of that text scales with the font-size setting
  *and* the UI scale. As part of this, the ad-hoc ~30 distinct font sizes were
  consolidated to a clean 8-step type scale.
- **World Rankings comparison table sits centered.** With only a few met
  civilizations on a wide screen, the columns hit their max width and the grid was
  left-aligned with dead space on the right; it now centers.

### Changed
- The All Civilizations comparison table's text is a step larger and the metric
  rows lead with an icon (carried over from the 2.3.x line).

## [2.3.3] - 2026-07-04

### Fixed
- **The per-turn rate suffix now localizes.** Signed per-turn figures (e.g.
  "+12/turn") appended a hardcoded English "/turn". It now resolves through
  `LOC_DEMOGRAPHICS_RATE_PER_TURN_SUFFIX`, so it translates with the rest of the
  interface (Polish "/tura") instead of needing a manual JS patch after each
  update. Off-engine (and if a translation is missing) it still falls back to
  "/turn".

## [2.3.2] - 2026-07-04

A follow-up to the 2.3.0 4K fix. The All Civilizations comparison is transposed so
its labels are readable at every resolution and UI scale, plus a Scaled/Civ toggle,
score-ordered columns, heading icons, and larger table text.

### Changed
- **All Civilizations view is now metrics-as-rows (no more clipped/tiny headers).**
  The comparison previously put each of the ~21 metrics in its own *column*, so at
  4K / low UI scale there was no room for the localized column headers — Polish
  "Pozycja", "Technologie", "Powierzchnia terenu" were cut off ("Pozycja" →
  "ozycj") or shrunk to nothing. It now lays out each **metric as a row** with its
  name in a wide left column (which reads at full size), and each **civilization as
  a column** — far fewer columns, and the long labels have horizontal room. Every
  cell shows the world rank with its value beneath it, the local player's column is
  pinned on the left, and other civs can still be hidden/shown. Metric names use the
  engine's font auto-fit (`coh-font-fit-mode: shrink`) so they stay on one line at
  any resolution without wrapping.
- **Scaled / Civ toggle in the All Civilizations view.** Metrics that come in a
  scaled-"people" and a raw-Civ-numbers pair — Population, and (with the Emigration
  companion) the migration flows — now show a **single row** with a Scaled/Civ
  button that swaps the whole column in place, matching the toggle on the other
  tabs, instead of two identically-labelled rows. Fixes the duplicate "Population"
  row (base `population` vs `population_civ`) the transpose exposed.
- **Civilizations are ordered as a leaderboard.** Beside the local player's pinned
  column, the other civilizations are now laid out left→right in descending
  **civilization-score** order (previously alphabetical by leader name), so the
  view reads as a ranking. Ties fall back to leader name.
- **Metric row headings show icons.** Each metric name in the left column now
  leads with its icon (gold, science, culture, food, production, population,
  diplomacy, military, wonders, score, …) for faster scanning.
- **Larger table text.** The metric names, values, ranks and civilization names in
  the All Civilizations table are set a step larger for readability.
- **Category-leader cards above the table.** The "rank by category" strip — one
  card per metric naming the civilization that leads it — is back above the All
  Civilizations table, matching the All Settlements panel.

## [2.3.0] - 2026-07-04

A localization release. Polish is now a supported language, and every remaining
hardcoded interface string has been moved behind a translation tag so the whole
UI can be localized. Also fixes oversized World Rankings text at 4K.

### Added
- **Polish (pl_PL) localization.** Polish is now a registered language with a
  translation file covering every string in the mod. It ships as English
  placeholders pending community translation, so any not-yet-translated row
  falls back cleanly to English — exactly as an untranslated string does in the
  other languages.
- **The other nine languages are now fully translated.** German, Spanish,
  French, Italian, Japanese, Korean, Portuguese (BR), Russian and Simplified
  Chinese had a backlog of interface strings still showing English (chart
  titles, tab and column labels, page names, and more). Every one is now
  translated, using the game's own terminology, so those languages read as a
  complete localization rather than a partial one.
- **Full translation coverage for the interface.** The strings that were still
  hardcoded in English — the History time-range filter pills (*25y … 1000y*),
  the Relations node-focus caption, the City-State ally fallback, and the
  "Player N" / "War #N" fallback labels — now resolve through translation tags,
  so they localize with the rest of the UI. The Relations focus caption also
  drops an English-only plural suffix in favour of a count-based phrasing that
  translates correctly in every language. This closes the gaps a translator
  would otherwise hit.
- **War display names now fully localize.** The dynamic war names (recurrence
  ordinals, world/great/regional labels, duration flair) were already built from
  translation templates; the last English leaks in that path — the "Unknown"
  fallback adjective that could surface inside a name, and single-belligerent
  wars that fell back to the raw stored name — are now localized too. The names
  are composed at display time, so nothing is baked into save files and existing
  saves are unaffected.

### Fixed
- **Numbers now format for the player's language.** Grouped figures and
  abbreviated magnitudes (e.g. *1.23M*, *12,345 km²*, *+3.4/turn*) previously
  always used English separators (`1,234.5`) regardless of language. They now
  route through the game's own `Locale.toNumber`, the same API the base game
  uses, so a German player sees `1.234,5`, a French player `1 234,5`, and so on.
  Off-engine (and if the API is ever unavailable) it falls back to the previous
  formatting, so nothing regresses.
- **World Rankings text no longer oversized at 4K.** Every tab of the World
  Rankings screen used a larger type scale than the rest of the mod, which read
  as oversized on high-resolution displays and left too little room for longer
  names. The leader, civilization, metric-label and value text is retuned to
  match the mod's other tables (and the civilization-table name column widened),
  so names — including longer localized ones — fit, while the smooth
  per-resolution scaling introduced in 2.1.2 is preserved.

## [2.2.0] - 2026-07-02

Influence now shows in the Settlement rankings, alongside the other yields.

### Added
- **Influence column in the Settlement rankings.** The "Settlement Rank by
  Yield" table (and the settlement showcase, per-settlement dossier, and
  category-leader strip) now show Influence alongside the other yields, matching
  the "Civilization Rank by Yield" tab which already listed it. Influence is a
  ranked/sortable column but stays out of the composite Score — it is an
  empire-pooled yield only sparsely emitted per settlement, so counting it would
  skew the economic Score toward the few civs with influence-generating
  buildings. Localized in all supported languages.

## [2.1.2] - 2026-06-28

Every screen now scales smoothly to lower resolutions.

### Fixed
- **Every screen now renders properly on lower resolutions.** On sub-1080p
  displays (1366×768, 1600×900 and similar) the game pins the UI font at its
  smallest size, so all the fixed elements — titles, tab bars, the chart toolbar
  and legends, the World Rankings header band, the Settlements avatars and
  sub-tabs, the Relations filter chips — kept their full size and crowded the
  actual data into a sliver (the reported "charts only use 20% of the screen").
  The fixed-size content now scales *continuously* with the available height:
  each element eases smoothly from its full size down to a readable floor as the
  window gets shorter, with no abrupt jumps between resolutions. At the standard
  resolutions (1080p / 1440p / 4K) nothing changes.

## [2.1.1] - 2026-06-27

A correctness pass on two charted figures that could balloon to absurd values on
long or slow (Marathon) games — the same "a number escaped its bound" class the
2.1.0 population rework addressed, now closed for war casualties and GDP. No
saves affected; presentation only.

### Fixed
- **War-casualties no longer read in the billions on long / slow games.** The
  "soldiers killed" chart used an unbounded `1.009^turn` era multiplier (the same
  term the population formula already dropped), which ran to thousands× on a long
  Marathon game. It is now capped at a full game's worth of era growth, so casualty
  figures stay sane and comparable across eras and speeds.
- **GDP no longer balloons purely because time passed.** The GDP figure multiplied
  per-turn yield by the raw turn counter with no bound, making a mature empire read
  hundreds of times "richer" late game (worse on Marathon). The turn factor is now
  capped at a full game's length, so a normal game is unchanged while overtime / slow
  speeds / very long games can't run the figure away.
- **Hardened the population soft ceiling** against a divide-by-zero in the (today
  impossible) case of a zero ceiling.

## [2.1.0] - 2026-06-27

A population-realism release. The scaled "people" figures the dashboard shows
are completely reworked so that **every age reads at a believable historical
scale** — towns in the thousands, great cities up to ~1 million in the
pre-modern world, and true 10–38 million megacities only in the Modern age — and
the empire total is now the exact **sum of its settlements** rather than a
separate, hotter number. Existing saves are unaffected; this is presentation
only and never touches gameplay.

### Changed
- **Population scaling is now grounded in Civilization VII's own per-era growth
  formula.** The old `raw^1.11 × 90,000 × 1.009^turn` curve (which slammed late
  games into billions and reset awkwardly at every age) is gone. Each settlement
  is now valued from the game's real growth cost per era, so a settlement reads
  at a sane size for *whatever age it's in*, with a smooth, continuous hand-off
  across age boundaries (no jump when a new age begins).
- **The civ-wide Population metric is the sum of its settlements' estimates.**
  Previously the empire total used a separate, much hotter formula on the
  aggregate, which over-counted badly in the late game. It now adds up the same
  per-settlement people figures shown on the Settlements board, so "empire" and
  "sum of cities" finally agree, and the number is historically sane.
- **Per-settlement variation is now drawn from real game signals.** Two
  same-size settlements still never read identically, but the small spread is now
  derived from each settlement's actual happiness, urban/rural mix, and growth
  trend (with its identity only as a final tie-breaker) — a thriving city reads a
  touch larger than a stagnant one — instead of a bare name hash.

### Added
- **Modern megacities.** In the Modern age the largest cities can now grow into
  the real 10–38 million range, emerging gradually as the age advances rather
  than popping in at the boundary.
- **"One more turn" keeps scaling.** If you continue past the natural end of the
  game, population keeps growing into a speculative future instead of flat-lining
  at the historical cap (bounded so it can never run away).
- **The Population chart bridges age transitions.** Civ VII mechanically slashes
  settlement population when an age rolls over; the people line now smooths across
  that artificial reset so it reads as a continuous history — while still showing
  a genuine war or collapse that happens to land near the boundary.

### Internal
- A historical-anchor + age-boundary-continuity test suite, a cross-mod parity
  guard pinning the shared scaling to the **Emigration** companion mod, and an
  upper safety bound so a bad engine read can never resurrect a multi-billion
  figure. Design + review notes under `reports/`.

## [2.0.8] - 2026-06-27

A stability and quality-assurance release. No charts, metrics, or behaviour
changed for the player. This hardens how the mod stores its history and adds a
large automated test-coverage pass (around four dozen new regression harnesses)
that exercises the error paths and edge cases of nearly every screen and
subsystem, so corrupt input, missing data, and unavailable engine APIs are
handled gracefully instead of crashing.

### Changed
- **Saved-history persistence now uses a versioned envelope.** Demographics
  history is written as `{ v: 2, data: ... }` instead of a bare payload, so future
  schema changes can be migrated cleanly. Loading remains fully
  backward-compatible: legacy raw payloads from older versions are still read,
  so existing saves are unaffected.

### Added
- **Storage / persistence hardening harnesses** covering the persistence layer's
  failure modes, so a corrupt, truncated, or old-schema blob is handled
  gracefully instead of throwing: `storage-schema` (versioned-envelope shape),
  `storage-load-branches` (malformed / legacy load paths), `storage-backend-branches`
  (storage-backend availability fallbacks), `storage-cap-branches` (bounded-growth
  caps), and `governance-branches` (analytics-visibility governance paths).
- **Relations-graph coverage** — the largest area, hardening the Global Relations
  diagram end to end: `relations-queries-branches`, `relations-shared-branches`,
  `relations-settings-branches`, `relations-filters-branches`,
  `relations-filters-dom-branches`, `relations-viewer-controls-branches`,
  `relations-node-info-branches`, `relations-edges-branches`,
  `relations-edges-cs-branches`, `relations-ring-compute-branches`,
  `relations-ring-svg-branches`, `relations-ring-svg-nodes-branches`,
  `relations-ring-svg-edges-branches`, `relations-ring-svg-backdrop-branches`,
  and `relations-render-integration`.
- **Line-chart coverage** for the history graphs: `chart-line-axis-branches`,
  `chart-line-config-branches`, `chart-line-datasets-branches`,
  `chart-line-series-branches`, `chart-line-legend-branches`,
  `chart-line-plugins-branches`, `chart-line-event-markers-branches`,
  `chart-line-wonder-markers-branches`, and `chart-line-render-integration`.
- **Settlements and city-map coverage**: `settlements-pure-branches`,
  `settlements-detail-render-branches`, `settlements-render-integration`, and
  `city-map-view-branches`.
- **Radar, World Rankings and resources coverage**: `radar-data-branches`,
  `worldrankings-profiles-branches`, `resources-radar-render-integration`, and
  `options-worldrankings-render-integration`.
- **Crisis, conflicts and history view render coverage**:
  `crisis-render-integration`, `conflicts-render-integration`, and
  `history-view-render-integration`.
- **Bootstrap, registration and shared-helper coverage**: `bootstrap-branches`,
  `hardware-branches`, `screen-demographics-registration-branches`,
  `re-export-barrels-branches`, `ui-helpers-contracts-branches`,
  `camera-utils-branches`, `view-pills-branches`, and `wars-naming-branches`.
- New shared test scaffolding (`tests/_dom-stub.mjs`, an engine panel-support
  stub) so the render-integration harnesses can drive the real view code
  off-engine.
- **`scripts/required-scripts-gate.mjs`** — a script-integrity guard that fails
  the build if a required test script is missing from `package.json` or from the
  `verify` chain, so a harness can't be silently dropped.
- **`release:gate`** script chaining `required-scripts`, `verify`, and `coverage`
  into a single pre-release check.

### Internal
- Strengthened the package gates so `verify` and the coverage chain (`test:js`)
  run the new harnesses, preventing accidental script-chain regressions; the
  automated suite now runs roughly four dozen more harnesses than 2.0.7.
- Pruned generated coverage temp artifacts (`coverage/tmp`) from the working tree
  to keep local outputs reproducible and avoid stale report carryover.

## [2.0.7] - 2026-06-25

A full-codebase resolution / Interface-Size hardening pass (follow-up to the 2.0.6
ring fix), driven by an audit for every place content could clip, overflow, or
mis-scale at a non-default resolution or Interface Size.

### Fixed
- **History charts now re-fit when the window or Interface Size changes.** Every
  chart (line, war Gantt, war/crisis graphs, resources, Legacy radar) measured its
  size once and kept it; changing Interface Size or resizing while Demographics was
  open left the chart stale (overflowing or shrunk) until a metric was re-picked.
  They now re-render on resize, mirroring the relations ring.
- **Charts size to the real panel at every resolution.** Chart dimensions now come
  from the measured host (with a generous high-res / ultrawide ceiling, replacing a
  fixed 2800×1400 cap that left wide monitors under-resolved), and the line chart no
  longer falls back to a hardcoded 1920×1080 when the engine hides `window.inner*`.
- **Global Relations edge tooltips no longer clip off-panel.** The ring's edge-hover
  label was nudged a fixed amount down-right with no edge detection, so hovering an
  edge near the panel's right/bottom clipped it. It now flips to up-left near those
  edges and wraps long localized labels (same edge-flip the war graphs got in 2.0.5).
- **War / crisis graph tooltips no longer clip at a cell's left/top corner.** The
  hover tip flipped near the viewport edge but could land at a negative offset on a
  small left-column cell; it's now clamped to stay on-cell.
- **Global Relations filter legend tracks the Interface Size.** The legend and the
  City-State "viewer" dropdown were pinned at a hardcoded offset chosen to clear the
  tab/toolbar rows, but that chrome grows with Interface Size, so at larger sizes the
  legend overlapped the tabs. Their position is now measured at runtime, the legend's
  height is capped to the panel (a fixed `min-height` floor that could push it
  off-screen was removed — the same min-over-max trap as the ring), and its sample-
  line swatches scale with Interface Size.
- **Line-chart legend clears the Y axis at every Interface Size.** The overlaid
  legend used fixed offsets to clear the Y-axis labels; it now aligns to the plot's
  measured inner edge, so it never overlaps the axis numbers when they grow.
- **Settlements podium column can shrink** so the ranked list beside it isn't crushed
  (and its names hard-truncated) on a narrow frame at a large Interface Size.
- **Radar axis labels stay on-canvas.** Long localized Legacy-path labels now anchor
  inward instead of overrunning the chart's edge.
- **Small UI glyphs now scale with Interface Size.** The wonder/raze markers, town
  population bars, and population-trend arrows were fixed pixel sizes (tiny next to
  rem-scaled text at large Interface Sizes); they're now in rem. The two-line
  settlement-name clamp got a touch more headroom so a tall fallback font can't shave
  its second line.

## [2.0.6] - 2026-06-25

### Fixed
- **Global Relations diagram still clipped at the bottom on some setups.** The
  ring's bottom node (and ~20% of the wheel) could hang below the frame off-screen
  at larger Interface Sizes / shorter windows, most visibly with a full lobby
  (7–12 majors, the largest ring). Earlier fixes removed the SVG min-height floors,
  but the diagram's flex container could still resolve taller than the frame in
  GameFace, so the box itself overran the bottom edge. The view now **measures the
  visible space in pixels at runtime** (the body's top to the frame's bottom, minus
  the caption row) and caps the diagram to it — so the whole ring always fits at
  **any resolution or Interface Size**, with no hard-coded sizes. The fit re-runs on
  window resize, and the SVG keeps scaling to the capped box via `meet`.

## [2.0.5] - 2026-06-25

A correctness + robustness pass from a full multi-subsystem audit.

### Changed
- **Removed the Refresh and Time buttons from the Triumphs radar screen.** Both
  were meaningless on a snapshot view (the radar reloads when you pick a snapshot,
  and the turn/year toggle has no time axis to act on); the snapshot selector,
  Copy CSV, and Options controls remain.

### Fixed
- **CSV export dropped most rows in multi-age games.** The per-turn CSV keyed
  rows by `turn`, which resets to 1 each age, so same-numbered turns across ages
  collided and all but the last age's row was silently lost (~2/3 of rows in a
  3-age game). Rows are now keyed/sorted by the monotonic `chartTurn`, and a new
  `age` column disambiguates the (still age-local) `turn` value.
- **CSV formula-injection guard.** A player-renamed civ/leader/town name starting
  with `=`, `+`, `-`, or `@` was written verbatim and would execute as a formula
  when the CSV was opened in Excel/Sheets. Such cells are now prefixed with a
  single quote (numbers, including negative/BCE years, are left untouched).
- **Saved settings no longer freeze old defaults.** Each write baked every current
  default value into the saved slice, so a later change to a shipped default would
  never reach anyone who had ever opened the options. Only real overrides are now
  persisted (defaults are overlaid at read time); this also heals already-baked
  saves on their next write.
- **History now resets on a new game / different save.** History is stamped with
  the game seed but the seed was never checked on load, so a prior game's data
  could load into a new one (and a stale in-memory mirror could resurrect it).
  Added a seed-mismatch reset on both the stored payload and the memory mirror.
- **Settlements "Options" button vanished** after sorting/toggling inside the All
  Civilizations sub-tab, because that view clears its host on each internal
  re-render. The toolbar is now re-attached after every re-render (idempotently).
- **Chart tooltips clipped off the bottom.** The war-graphs hover tooltip and the
  Gantt tooltip only flipped horizontally; both now also flip vertically so hovers
  in the lower rows of scrollable grids stay on-screen.
- **Crisis graphs re-parsed the entire sample history on every legend toggle**
  (~8× per click). Parsed series are now cached per game, so a visibility toggle
  reuses them instead of re-walking the whole stream.
- **Global Relations diagram robustness.** An orphaned ring's deferred portrait
  placement could spin in an unbounded animation-frame loop against a detached
  node after rapid re-renders; added a liveness check and a retry cap. The view's
  in-memory filter / node-focus caches now reset when the game/save changes, so a
  second game in one session no longer inherits the previous game's selections.
- **Wrapped rows could overlap vertically.** Several `flex-wrap` containers used a
  single-value `gap`, whose row-gap GameFace drops on wrap; converted to explicit
  two-value gaps. Hardened two dropdowns (`.demographics-option-dropdown`,
  `.demographics-chart-viewer-dropdown`) against the same `min-width` >
  `max-width` overflow trap as the relations ring, and de-duplicated a conflicting
  `.demographics-option-hint` rule that resolved differently by file load order.

### Internal
- Markers that relied on `stroke-dasharray` (which Coherent ignores) had the no-op
  attribute removed and the color-based differentiation documented inline.
- Release tooling: the Workshop change-note now keeps multi-line bullet text and
  always leads with the version; the `verify` gate runs the two tests it had been
  skipping (`test:settlements-data`, `test:civ-color-utils`).

## [2.0.4] - 2026-06-25

### Fixed
- **Global Relations diagram clipped / "too big for the UI" on some displays.**
  The relations ring (the Politics & Relationships / Agreements view) is an SVG
  that scales to fit its panel, but a `min-height: 22rem` floor on the SVG
  overrode that — CSS `min-height` wins over both `height` and `max-height` — so
  at a larger Interface Size or on a short window the diagram overflowed its
  container and got cut off. Removed the SVG floor so the ring always scales to
  fit the space available. (Reported on the Steam Workshop page.)

## [2.0.3] - 2026-06-25

### Fixed
- **Critical mod-compatibility fix (dead Begin Game button / missing mod options).**
  Demographics shipped a file named `mod-options.js` — the same basename many other
  mods use for their options bootstrap. The game's UI module loader resolves these by
  basename, so Demographics' copy (which has no default export) shadowed every other
  mod's `mod-options.js`, making their option modules fail with "does not provide an
  export named 'default'". That broke the Begin Game button after the load screen and
  hid those mods' options entirely. Demographics' bootstrap is now
  `demographics-mod-options.js` — a unique name that can never shadow another mod.
  (Companion to the 2.0.2 shared-settings fix.)

## [2.0.2] - 2026-06-25

### Fixed
- **Critical mod-compatibility fix.** Demographics could wipe other mods' settings
  out of the shared options store. Mods share one `modSettings` blob (one slice
  each), and when the game's UI layer handed back a momentarily-empty or unreadable
  copy of it, Demographics wrote back only its own slice — deleting every other
  mod's saved options. The visible result was other mods (e.g. Classic Leader
  Screens, Dynamic Main Menu, Flag Corps, Map Trix) behaving as if uninstalled and,
  in some setups, the "Start Game" button doing nothing after the load screen.
  Demographics now re-reads on an empty result, refuses to write when the shared
  store can't be safely read, and only ever touches its own slice — so it can never
  drop another mod's settings.

## [2.0.1] - 2026-06-24

### Changed
- UI now scales cleanly across resolutions. Tab rows (the Geopolitics / Global
  Relations tabs and every other tab bar) could overflow past the window edge at
  lower resolutions or with long localized labels; each tab now shrinks to share
  the available width instead of spilling off-screen. The Global Relations filter
  legend, the Settlements podium/advisor cards, and the inline dropdowns likewise
  clamp to the panel so they never run past a narrow frame.

### Fixed
- Hardened the Options-screen category bootstrap that runs at the main menu: its
  writes to the engine's shared Options model are now fully guarded, so a future
  game patch that reshapes that model can no longer throw there and take the main
  menu down with it.

## [2.0.0] - 2026-06-23

### Fixed
- Crisis Impact's per-civ losses (Population / Crop / Production Lost) blanked out
  to "—" when an earlier age's crisis was viewed from a later age, leaving only
  Military Power. Those figures are sums of per-turn declines, so they need dense
  samples — but old samples are decimated as the game grows, and recomputing from
  the thinned stream loses the dips (while one-sample figures survive). Each age's
  per-civ **cumulative crisis cost is now snapshotted at the age boundary**, while
  that age's samples are still dense (alongside the existing triumph snapshot), and
  the Crises page renders a finished age's cumulative + the cross-age overall block
  from the snapshot, falling back to live computation for the current age. (Per-stage
  tables still compute live; the confirmed symptom was the cumulative/overall.)
- War names used the player's **current-age** civilization instead of the civ
  they were when the war happened (a player is Han in Antiquity but Qajar in
  Modern, yet an Antiquity war showed as "Qajar"). War rosters were re-stamped
  from the live (current) civ every sample — and never cleared on war end — even
  though a player's civilization changes each age while history persists across
  ages. Roster civ identity is now pinned to the war's **start age**, re-derived
  from the recorded sample at the war's start chart-turn, which also corrects
  existing saves on the next sample.

### Added
- Companion-mod metric hook (`globalThis.DemographicsMetricsAPI` with
  `registerMetric` + `registerMetricToPage`). Lets a separate mod contribute a
  metric that flows through the normal sample → store → line-chart pipeline and
  appears on a chosen Historical Data page. Inert unless another mod calls it, so
  base behavior is unchanged. The handshake is load-order-independent: this module
  is dynamic-imported (after `engine.whenReady`), so it drains any registrations a
  companion mod queued before it loaded. (Used by the companion **Emigration** mod
  to add a net-migration graph next to Population.)
- Companion-mod **panel** hook (`DemographicsMetricsAPI.registerPanel`). Beyond a
  line-chart metric, a companion mod can contribute a whole **page** whose body it
  renders itself: the Historical Data screen adds it as its own page/tab and hands the
  companion's `render(container, ctx)` callback a container (the time-filter and CSV
  toolbar are suppressed for these custom pages). Inert unless called; the base mod
  gains no dependency on the companion. (Used by **Emigration** to add a dedicated
  Migration dashboard page.)

## [1.3.0] - 2026-06-09

### Fixed
- Crisis Impact tab: each age's crisis now stays bounded within its own age, so the antiquity crisis's "Ends" stage and its per-age cumulative impact keep their real values after you advance into Exploration (previously they went blank because the window ran into the next age's reset turn numbers). A separate "Overall crisis impact across all ages" total now appears only once crises exist in two or more ages (i.e. after the Exploration crisis occurs). Crisis-stage detection also no longer mistakes a crisis level lingering from the previous age into the new age's first turns for a fresh crisis — it waits for that age to report a pre-crisis reading first — so a phantom next-age crisis no longer appears before the real one begins.
- Historical Data charts no longer collapse at the start of a new age. GDP and Population dropped toward zero at every age boundary because their era-scaling used the age-local turn (`Game.turn`), which restarts at 1 each age — they now scale off the monotonic chart turn and stay continuous. Techs, Civics, and Score (which falls back to techs + civics) reset to 0 each age because each age has its own fresh tech/culture tree; they are now carried forward cumulatively across ages. Trade Routes still step down at an age boundary, which is correct — routes genuinely end at the age transition.

### Improved
- Release packaging now ships readable JavaScript by default. Dist minification is opt-in via `MINIFY_DIST_JS=1` in `release.sh`.
- Workshop and README copy now state the readable-source release posture and companion `triumphs-progress-overlay` split.

### Internal
- Wave 2 refactor decomposition expanded across major view controllers:
	- Settlements split into detail, civ ranking, showcase, and table modules.
	- Relations name-map and city-state node-info extraction moved into `relations-node-info.js`.
	- Options storage controls and action controls moved into dedicated modules.
	- History chart host/render routing moved into `view-history-chart-render.js`.

## [1.2.0] - 2026-06-05

### Added
- Wonders overlay: destroyed wonders are now marked. When a wonder is lost because its city is razed, a marker appears on that civilization's line at the turn it fell — the wonder icon, dimmed, with a small burning raze badge — alongside its existing "built" marker. Hovering shows the wonder name and a "Destroyed · Turn" line.

### Fixed
- Radar graph: the Refresh button no longer shows a missing-glyph box ("[]") in front of the label. The unsupported icon character was removed in every language.
- Options screen: the sample-cap and poll-interval choices no longer show a missing-glyph box ("[]") before their performance caveats; the caveats now read as plain parentheticals (e.g. "Unlimited (very large saves, may slow performance)"), in every language.

### Improved
- Faster Demographics screen (lazy loading): the heavy All Civilizations and Global Relations tabs, and the Conflicts charts (the wars timeline and the per-war graphs), now load on demand the first time you open them, instead of all being parsed when the screen first opens. The default Historical Data view is unchanged.
- Smaller download and faster load (minification): shipped builds are now minified, cutting the mod's JavaScript size by roughly 70% (about 1.0 MB down to 0.3 MB) with no change in behavior.

### Internal
- Dead-code removal: deleted the unused in-screen triumph charts (`chart-triumphs.js`, ~1,080 lines) together with their now-orphaned CSS (~380 lines) and leftover view state — about 1.5k lines in total. The native Triumphs decorator is unaffected.
- Build pipeline (minification): `release.sh` now minifies every shipped JS file in place (esbuild, per-file transform) while preserving the module layout and import paths, and constant-folds out the debug logging. Source stays unminified and readable; only the shipped `dist/` copy is minified, so players never need any build tooling.
- Loading architecture: the chart barrel (`demographics-chart.js`) now imports the heavy Conflicts charts on demand via `ensureChartForMetric`, and the screen imports the All Civilizations/Relations tab modules on first open — replacing the previous all-at-once static imports.

## [1.1.12] - 2026-06-04

### Fixed
- Historical Data line charts: crisis stage markers now recover missing intermediate stage labels when sampled data jumps across crisis stages between turns, so the second stage label no longer disappears while the crisis line continues.
- Historical Data line charts: crisis labels now render above age-boundary labels, preventing the later age pill from covering a crisis label at the same horizontal position.
- Historical Data line charts: crisis stage detection now scans every player row in a sample and uses the highest valid crisis stage, avoiding missing onset labels when one row carries a stale lower value.
- Historical Data filters: year-relative windows now scan the mapped chart-X domain correctly instead of reading an undefined sample field, so 25/50/100/300/500/1000-year filters clamp to the intended range.
- History storage: late-game decimation now preserves the latest age by age tag instead of relying only on legacy boundary-turn comparisons, reducing the risk of thinning current-age samples.

### Improved
- Historical Data line charts: crisis marker layout now stacks overlapping crisis labels into separate lanes instead of drawing one label directly on top of another.
- Historical Data line charts: font resolution across config, crisis markers, age markers, and plugin overlays now uses the same guarded fallback path, keeping chart text stable even if the Chart.js global is unavailable or partially initialized.
- Historical Data line charts: focus glow respects skipped points, preventing the highlight overlay from bridging across gaps that the underlying Chart.js line does not connect.

### Internal
- Refined the line-chart time and crisis marker pipeline to keep chart-X mapping, time-range filters, and marker overlays aligned under the new persisted `chartTurn` chronology model.
- Reworked decimation and crisis helper structure to satisfy the mod's complexity and verification gates without changing user-facing behavior.

## [1.1.11] - 2026-06-04

### Improved
- Global Relations: the Major Civilizations ring is now centered higher in the panel, so the diagram reads as centered on the window instead of sitting low beneath the tab row.

### Documentation
- The Workshop description now details the Conflicts and Crises views — the war Gantt timeline and per-war graphs, and the staged crisis severity bars, per-stage cost tables, and crisis graphs.

## [1.1.10] - 2026-06-03

### Fixed
- Line charts: civilizations with near-black banner colors (e.g. Alexander) are now drawn in their secondary banner color when that reads better against the dark chart background, so their line, label, and value no longer disappear. If neither banner color is readable, the color is lifted to a visible tone preserving its hue.

### Improved
- Line charts: a global pass now keeps every civilization's line color visually distinct — when two civs would otherwise share a near-identical color, the lower-priority line is reassigned to a well-separated color so lines never blur together. In extreme cases (banner colors that collide or can't be made readable) the chart falls back to arbitrary, evenly-spread colors.
- Wars timeline: war labels for conflicts involving a near-white-bannered civilization now render in red so the label stays legible against the cream-on-dark default.

### Thanks
- **renouf** — for reporting the unreadable dark line colors (a black Alexander line on the dark background) that prompted all of the chart color-readability work in this release.

## [1.1.9] - 2026-06-02

### Added
- Relations legend titles for both Global Relations tabs:
	- Major Civilizations
	- City States
- New chart-line sibling modules to continue the monolith split:
	- `chart-line-axis.js`
	- `chart-line-config.js`
	- `chart-line-event-markers.js`
	- `chart-line-plugins.js`
	- `chart-line-tooltip.js`

### Improved
- Overhauled the war-titling system on the Wars timeline so generated conflict names read consistently and avoid repetitive/misleading labels across ages.
- Reworked long-war duration naming: rare/accurate suffixing, realistic rounded spans, and strict "Hundred Years' War" gating.
- Improved chart and relations tooltip readability and presentation so hover details are clearer and more consistent across views.
- Continued reducing `chart-line.js` size and surface area by extracting cohesive subsystems without behavior changes. The line chart architecture is now split into focused modules for axis math, config shape-builders, overlays, and tooltip rendering.
- Global Relations overlay layout polish:
	- Viewer label/dropdown placement no longer clashes with panel framing.
	- Viewer controls and legend now align on the same horizontal plane (viewer on left, legend on right).

### Fixed
- City-State Global Relations viewer control positioning so the "Viewer" label and dropdown do not collide with the border frame.
- Selector-scoping bug where a viewer-position rule could affect tab-header layout; now isolated so only the viewer host receives that positioning.
- Resolved multiple war-graph rendering bugs affecting timeline labeling and edge-case display behavior.

### Internal
- Updated remediation tracking for the chart-line split workstream and synchronized extracted module references in docs.
- Release changenote source now reflects all bullets in this section so Steam Workshop updates show the full change list for this upload.

## [1.1.8] - 2026-06-01

### Improved
- Larger crisis-marker text on the history charts: both the crisis stage/year note and the crisis name are easier to read.

### Fixed
- War-tab labels now stay readable over any civilization bar color — including white, black, or a black+white mix — via a crisp dark text outline.

### Internal
- Continued breaking up the `chart-line.js` monolith: extracted the history→series pipeline (`chart-line-series.js`) and the series→dataset shaping (`chart-line-datasets.js`). Behavior-identical; `chart-line.js` is now roughly 432 lines, down about 82% from the original ~2,394.

## [1.1.7] - 2026-06-01

### Added
- Met-history reveal mode: a new Options sub-toggle under "Hide unmet civ stats" that chooses, once you meet a civilization, whether to reveal its entire history (default) or only data from first contact forward.

### Fixed
- The line chart now reveals a civ's full history the moment you meet them, instead of being stuck showing only data from the meeting turn forward (now consistent with the Radar and All Civilizations views).
- Greatly reduced settings log spam: the shared `modSettings` localStorage blob is parsed quietly with a single warning per session instead of an error on every settings write.

## [1.1.6] - 2026-05-31

### Added
- Full localization across 10 languages (English, German, Spanish, French, Italian, Japanese, Korean, Portuguese, Russian, Chinese) with a `t()` helper and locale-gated text loading.
- War history rebuilt on real data: cumulative participation roster (join / leave / active), per-participant cost accounting, "withdrew" markers, and sides labeled by civilization name instead of "Attackers/Defenders".
- Unmet-civ spoiler guard as a reversible Options toggle (`hideUnmetStats`, default on): diplomacy, influence, and relations values are withheld for civilizations you have not met, with charts eliding rather than showing zero.
- One-time downsampling notice plus a read-only history-cap and decimation status line in Options.
- MIT license.

### Changed
- Localized and credibility-hardened crisis names, with native-speaker passes across all languages and renames to avoid charged real-world references.
- Moved the spoiler guard from sample-time to display-time so the toggle is fully reversible without re-sampling.
- Adopted an honest persistence model: history persists within an age (cross-age state does not survive current engine builds) and the UI states this plainly.
- Relabeled the sample-frequency setting as the performance control (lighter per-turn work on slow machines or long games).
- Audited all README and Workshop claims for accuracy.

### Fixed
- Replaced fabricated war casualties and battle counts with data-backed per-side war costs.
- Fixed a `cumulativeOffset` ReferenceError in the war-timeline age offsets.
- Settings shared-namespace defense: stamp a schema version into the persisted slice and warn once if it returns missing-amid-siblings, malformed, or version-mismatched.

### Internal
- Split monolithic files into roughly 15 typed modules (barrel re-exports), holding zero TypeScript, ESLint, and complexity/length violations.
- Migrated static inline styles to CSS classes mod-wide.
- Defaulted all debug flags off in source and removed a debug-only Triumphs probe.
- Added a `release.sh` zip allow-list audit so stray files cannot ship.

## Earlier releases (pre-1.1.6)

Initial public releases established the core read-only analytics dashboard:
Historical Data time-series (Economy / Power / Knowledge & Influence / Triumphs)
with per-civ colors, time-range filters, smoothing, and CSV export; the World
All Civilizations current-values-and-ranks view; the Global Relations ring; and Triumph
card progress overlays. Detailed per-version notes predate this changelog.
