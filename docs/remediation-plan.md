# Demographics Mod — Remediation Plan

Plan for addressing issues identified in the engineering / modding-community
critique pass. Items are grouped by audience and ordered by impact.

## P0 — Correctness and stale assumptions

### 1. Drop or honestly downgrade the `Tutorial.setProperty` cross-age backend
- **Problem.** `demographics-storage.js` writes to
  `Players[localObserverID].Tutorial.setProperty` on the documented theory
  that it survives age transitions. Empirical testing shows it does not.
  The cost (writing to an undocumented engine bag) is being paid for zero
  benefit, and the file header still advertises the broken path as "blessed".
- **Actions.**
  - Update the file header comment in `ui/demographics-storage.js` to state
    plainly: cross-age persistence via per-player Tutorial bag does not
    survive the age save in current builds; retained only for within-age
    sessions and as a forward-compat hook.
  - Add a single `PERSISTENCE_MODE` constant: `within_age` (default) /
    `legacy_tutorial_bag` (opt-in, behind a setting).
  - Remove the `BeforeAgeTransition` flush, or repurpose it to emit a
    user-visible end-of-age artifact (clipboard copy or downloadable JSON).
  - Update `docs/README.md` and the Workshop short description to remove
    any "cross-age history" language.
- **Files.**
  - `ui/demographics-storage.js`
  - `ui/demographics-settings.js` (new setting)
  - `docs/README.md`, `docs/steam-workshop-description-short.md`

### 2. Spoiler / multiplayer leakage audit on diplomacy metrics
- **Problem.** `Game.Diplomacy.getPlayerEvents` and other diplomacy
  accessors are sampled for every alive major civ. The `showUnmetNames`
  setting gates *labels*, but metric *values* may still surface
  information about civs the local player has not met.
- **Actions.**
  - Add a `met`-flag check to every diplomacy/influence/relations metric
    accessor in `ui/demographics-sampler.js` and `ui/sampler-collectors.js`.
    Return `null` (not 0) when unmet, so charts can elide rather than show
    a misleading flatline.
  - Document that the mod is single-player-safe and that multiplayer use
    requires the host to gate the screen.
- **Files.**
  - `ui/demographics-sampler.js`
  - `ui/sampler-collectors.js`
  - `ui/screen-demographics/views/view-options.js`
  - `docs/README.md`

## P1 — Localization

### 3. Resolve template-token inconsistency in crisis-name CSVs — ✅ RESOLVED
- **Problem (orig).** English source used `{regional}` / `{place}` /
  `{color}` tokens while translations baked in concrete variants per row —
  redundant rows *and* lost template flexibility. Worse: the CSVs were read
  by **no runtime code at all** (dead data); crisis names were generated
  from a hardcoded English catalog in `chart-line.js`.
- **Resolution.** Migrated the entire crisis-name system to `LOC_*` keys
  (option B, concretized). Every name — including all `{color}/{place}/
  {regional}` expansions — is now a `LOC_DEMOGRAPHICS_CRISIS_*` tag in
  `text/<lang>/ModText.xml`, composed at runtime via `Locale.compose` in
  `flavorCrisisName`. The inlined English catalog and the substitution pools
  were removed; `resolveCrisisEntry` / `flavorCrisisName` now pick a key by
  seed and compose it. Coverage extended from 2 → all 6 crisis types across
  10 languages at key-set parity. The CSVs are retained ONLY as the
  human-review/authoring artifact and excluded from the shipped zip.
- **Files (done).** `ui/screen-demographics/chart-line.js`,
  `text/<lang>/ModText.xml` (×10), `text/data/crisis-names-v4.*.csv`,
  `release.sh` (now excludes `text/data`).

### 4. Finish locale tone-clean pass
- **Status.** Done for it, pt, ja, ko, ru. Pending for de, es, fr, zh, en.
- **Action.** Apply the same tone/strip-dev-jargon pass to remaining
  `text/<lang>/ModText.xml` files.

## P2 — Code-smell, maintainability, and "looks AI-generated"

### 5. Strip reverse-engineered file:line citations from comments
- **Problem.** Comments reference engine paths and line numbers
  ("see model-diplo-ribbon.js:748-752", "gamecore-events.xml:148"). These
  rot on every patch and become disinformation in our own codebase.
- **Action.** Replace with the *symbolic* hook ("accessor X on Y") or
  delete entirely. Sweep all `ui/*.js` files.

### 6. Trim verbose JSDoc on internal helpers
- **Problem.** Two-line helpers carry paragraph-length typed JSDoc. Reads
  as LLM-generated boilerplate.
- **Action.** Reserve full JSDoc for module-exported surfaces. Keep one-line
  `//` comments on internal helpers. Do not over-type with `@type {*}`.

### 7. Decide the fate of `perfMode`
- **Problem.** Flushes every 3 turns instead of every 1. Saves trivial
  work, loses up to 3 turns on crash, adds a second persistence path.
- **Action.** Remove `perfMode` and the `_persistAppend` buffer. The
  existing `sampleEveryNTurns` setting already gives the user the same
  control with one knob.
- **Files.**
  - `ui/demographics-storage.js`
  - `ui/demographics-settings.js`
  - `ui/screen-demographics/views/view-options.js`

### 8. Decimation should warn, not silently lossy-compress
- **Problem.** `_maybeDecimate` drops every-other-than-Nth sample past
  25% of cap. Users discovering late-game data gaps will be confused.
- **Action.** When decimation triggers, emit a one-time toast / log line:
  "Sample cap approached; history downsampled past turn N to fit." Expose
  the current cap and decimation state in the Options panel.

### 9. Kill-switch error reporting
- **Problem.** Three accessor throws → permanent silent unsubscribe.
  Masks real engine bugs.
- **Action.** Log the *first* exception with full stack and the accessor
  name before incrementing the counter. Surface "Demographics paused due
  to engine errors" in the Options panel with a manual re-enable button.

### 15. Relations graph — cache edges, re-filter on toggle (perf)
- **Problem.** Every filter-pill toggle calls `rs.repaint()` →
  `computeRingData` → `buildCivEdges`, which re-queries the engine from
  scratch: a full O(n²) `getRelationshipEnum` attitude pass plus a per-active
  political pass and an O(n²) `countPlayerTradeRoutesTo` trade pass. The
  engine state is unchanged between toggles — only the filter set changed —
  so the FFI work is repeated for nothing. Felt as toggle jank, worst with
  many met majors.
- **Actions.**
  - Build the FULL edge set once (all categories, each edge tagged with its
    `filterKey`) and cache it keyed on `localPlayerID | Game.turn |
    ringViewerPid | metIds.length`. On repaint, drop the engine calls and
    just `edges.filter((e) => activeSet.has(e.filterKey))`. Attitude edges
    are already filter-tagged this way (`buildCivEdges` line ~753) — extend
    the same pattern to the political/trade builders instead of gating them
    by `activeSet` at build time.
  - Invalidate the cache when the key changes (turn advance, viewer switch,
    met-set change) so live engine state never renders stale.
  - Fuse the separate per-pair passes (attitude/war/alliance + trade) into a
    single `i<j` loop that resolves each civ's `Diplomacy`/`Trade` handle
    once and wraps the pair in one try/catch, instead of re-fetching
    `Players.get` per pass-row and allocating a `safeCall` closure per
    accessor per pair.
  - Guard the attitude pass so it does not run when no attitude-family
    filter is active.
- **Verification.** Assert the build-all-then-filter edge output is
  identical to the current per-filter builds for a fixed game state
  before/after — the refactor must not change what renders.
- **Scope note.** Only runs while the Relations tab is open (rendering is
  already lazy per-tab) and does not touch per-turn sampling. Absolute cost
  is small for typical met-major counts (<10); the win is instant filter
  toggling, not open-time.
- **Files.**
  - `ui/screen-demographics/views/view-relations.js`
    (`buildCivEdges`, `computeRingData`, the repaint path)
  - `ui/screen-demographics/views/relations-edges.js`
    (consolidate `buildAttitudeEdges` / `buildPoliticalEdges` /
    `buildEconomicEdges` into one tagged build)

## P3 — Content and framing

### 10. De-Europeanize the Exploration crisis name pools
- **Problem.** `EXPLORATION_CRISIS_REVOLUTION` and
  `EXPLORATION_CRISIS_RELIGION` lean heavily on Reformation,
  Counter-Reformation, Iconoclast, Glorious Revolution, Spring of Nations
  vocabulary. Applied to any civ in any region, this flattens.
- **Actions.**
  - Add equivalent name pools rooted in East/South Asian, African,
    Mesoamerican, and Islamic-world historical vocabulary.
  - Tag pools by civ/region affinity if the engine permits; otherwise
    expand the shared pool with diverse entries so the RNG can pick
    region-appropriate names.

### 11. Crisis/war-name sensitivity audit — partially done
- **Problem.** Procedurally combined names risk (a) per-locale phrasing
  that maps to a slur, and (b) English or translated names that read as a
  specific real-world atrocity/tragedy.
- **Done.**
  - Nazi/Holocaust term scan across all 10 langs — clean (no Endlösung /
    Vernichtung / Säuberung / Lebensraum / camp / ghetto, etc.).
  - Region-specific scan (PRC, Soviet/Russian, Latin-American, French
    Revolutionary, Japanese/Korean WWII) — es/pt/fr/ja/ko came back clean.
  - de `The Ashen Death` had collided with `The Grey Death` ("Der Graue
    Tod" ×2) → fixed to "Der Aschfahle Tod"; also fixed de "Years of
    Devastation" mismatch and "Great Fever" (Seuche → Fieber).
  - Charged real-world references renamed at the source (LOC key + JS
    catalog + all 10 langs + CSVs): "The Troubles" → "The Great Unrest"
    (Northern Ireland conflict); "The Great Dying" → "The Great Perishing"
    (post-Columbian Indigenous collapse); zh 动乱 → 大动荡 (the PRC term for
    the 1989 Tiananmen protests, dropped via retranslation).
- **Pending.** Native-speaker pass on the machine-translated locales
  (es, fr, pt, zh) for the 4 newly-added crisis types (loyalty + the three
  Exploration crises); record the audit in a CSV header comment so future
  contributors know it was checked.

### 12. Credits — keep attribution clean
- **Context.** Lineage from robk (Civ V Demographics), Gedemon (CivGraphs),
  Slothoth (Global Relations). These are older mods on prior Civ titles
  and no permission is required to draw inspiration from them.
- **Action.** Keep the existing attribution in the README accurate (mod
  name, original author, original game, link if available). No further
  work required.

## P4 — Optional / nice-to-have

### 13. Export-as-CSV / JSON button
- Sidesteps the persistence problem entirely by letting players save a
  run's history to disk before the age transition wipes it.

### 14. Replace FNV-1a fallback hash with a hard fail
- If `Database.makeHash` is missing, the mod should disable persistence
  and warn, not silently use a different hash that will desync from any
  future engine change.

## Execution order

1. P0/#1 (Tutorial bag honesty) — blocking for any further persistence work.
2. P0/#2 (spoiler audit) — small surface, high reputational risk.
3. P1/#3 (template tokens) — ✅ done (migrated crisis names to LOC keys).
4. P2/#7 + P2/#8 (perfMode + decimation transparency) — paired cleanup.
5. P1/#4 (locale tone pass) — mechanical.
6. P2/#5, #6, #9, #15 — code-quality + perf sweep, can run in parallel.
7. P3/#10, #11, #12 — content review, requires external input. (#11
   sensitivity scan + charged-name renames done; native pass on es/fr/pt/zh
   still pending.)
8. P4 — defer.

## Out of scope

- Rewriting the Triumphs decorator. DOM injection into the native popup is
  ugly but stable and well-isolated; revisit only if Firaxis changes the
  Legacies screen.
- Replacing Chart.js. The `fxs-hof-chart` dependency is the engine's
  shipping chart and the right thing to ride.
