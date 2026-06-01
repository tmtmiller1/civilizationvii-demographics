# Demographics Mod — Remediation Plan

Plan for addressing issues identified in the engineering / modding-community
critique pass. Items are grouped by audience and ordered by impact.

**Status:** `[x]` done · `[~]` partially done · `[ ]` not started.

## P0 — Correctness and stale assumptions

### 1. [x] Drop or honestly downgrade the `Tutorial.setProperty` cross-age backend
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

### 2. [x] Spoiler / multiplayer leakage audit on diplomacy metrics
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

### 3. [x] Resolve template-token inconsistency in crisis-name CSVs — ✅ RESOLVED
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

### 4. [x] Finish locale tone-clean pass
- **Status.** Done for all 10 locales. it/pt/ja/ko/ru were already cleaned; en
  is the (clean) source of truth; de/es/fr/zh re-synced — harness-placeholder
  BODY, collector/sampler FOOTNOTE, and Σ-formula GDP/approval trigger captions
  replaced with the cleaned wording (detailed hover popovers keep their formula).

## P2 — Code-smell, maintainability, and "looks AI-generated"

### 5. [ ] Strip reverse-engineered file:line citations from comments
- **Problem.** Comments reference engine paths and line numbers
  ("see model-diplo-ribbon.js:748-752", "gamecore-events.xml:148"). These
  rot on every patch and become disinformation in our own codebase.
- **Action.** Replace with the *symbolic* hook ("accessor X on Y") or
  delete entirely. Sweep all `ui/*.js` files.

### 6. [ ] Trim verbose JSDoc on internal helpers
- **Problem.** Two-line helpers carry paragraph-length typed JSDoc. Reads
  as LLM-generated boilerplate.
- **Action.** Reserve full JSDoc for module-exported surfaces. Keep one-line
  `//` comments on internal helpers. Do not over-type with `@type {*}`.

### 7. [x] Decide the fate of `perfMode`
- **Problem.** Flushes every 3 turns instead of every 1. Saves trivial
  work, loses up to 3 turns on crash, adds a second persistence path.
- **Action.** Remove `perfMode` and the `_persistAppend` buffer. The
  existing `sampleEveryNTurns` setting already gives the user the same
  control with one knob.
- **Files.**
  - `ui/demographics-storage.js`
  - `ui/demographics-settings.js`
  - `ui/screen-demographics/views/view-options.js`

### 8. [x] Decimation should warn, not silently lossy-compress
- **Problem.** `_maybeDecimate` drops every-other-than-Nth sample past
  25% of cap. Users discovering late-game data gaps will be confused.
- **Action.** When decimation triggers, emit a one-time toast / log line:
  "Sample cap approached; history downsampled past turn N to fit." Expose
  the current cap and decimation state in the Options panel.

### 9. [ ] Kill-switch error reporting
- **Problem.** Three accessor throws → permanent silent unsubscribe.
  Masks real engine bugs.
- **Action.** Log the *first* exception with full stack and the accessor
  name before incrementing the counter. Surface "Demographics paused due
  to engine errors" in the Options panel with a manual re-enable button.

### 10. [ ] Relations graph — cache edges, re-filter on toggle (perf)
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

### Triumphs stable-id probe (2026-06-01) — ✅ INVESTIGATED
- **Question.** Can localized title matching in the Triumphs decorator be
  replaced with a stable native identifier?
- **What was done.** Added runtime probe logic to
  `ui/demographics-triumphs-decorator.js`, deployed the updated script to the
  active Civ VII Mods directory, opened Legacies → Triumphs, and inspected
  game logs.
- **Evidence.** `UI.log` reported:
  `[Demographics.triumphsDecorator] stable-id probe: no native LegacyType token found; using title fallback`
  (2026-06-01 08:10:51).
- **Conclusion.** Current Civ VII native Triumph card DOM does not expose a
  stable `LegacyType` token discoverable by passive probing. Keep title
  fallback matching in place. Re-test only after Firaxis UI updates.

## P3 — Content and framing

### 11. [ ] De-Europeanize the Exploration crisis name pools
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

### 12. [~] Crisis/war-name sensitivity audit — partially done
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

### 13. [x] Credits — keep attribution clean
- **Context.** Lineage from robk (Civ V Demographics), Gedemon (CivGraphs),
  Slothoth (Global Relations). These are older mods on prior Civ titles
  and no permission is required to draw inspiration from them.
- **Action.** Keep the existing attribution in the README accurate (mod
  name, original author, original game, link if available). No further
  work required.

## P4 — Optional / nice-to-have

### 14. [ ] Export-as-CSV / JSON button
- Sidesteps the persistence problem entirely by letting players save a
  run's history to disk before the age transition wipes it.

### 15. [ ] Replace FNV-1a fallback hash with a hard fail
- If `Database.makeHash` is missing, the mod should disable persistence
  and warn, not silently use a different hash that will desync from any
  future engine change.

### 16. [ ] `localStorage.modSettings` shared-namespace defense
- **Problem.** Settings live under a top-level `modSettings` key shared
  with any other mod. The current code already only writes our own
  sub-key (after an earlier regression that wiped siblings), but there is
  no defensive read — if a sibling mod ships the same bug, our slice
  disappears silently.
- **Action.** Add a schema-version field to the persisted slice and a
  one-time in-game toast if the slice comes back missing or malformed.
- **Files.** `ui/demographics-settings.js`

### 17. [x] `infoAddict` legacy slice migration — ✅ RESOLVED
- **Context.** Storage layer migrated from a `modSettings.infoAddict`
  slice. Confirmed via code inspection that `infoAddict` was an earlier
  internal name for THIS mod (Civ 7 Demographics), not robk's Civ V mod,
  and no released build of this mod ever shipped under that key.
- **Resolution.** Removed `migrateLegacySlice` and its call site in
  `ui/demographics-settings.js`. Also flagged for the comment-sweep
  (#5): `ui/demographics-storage.js` near line 341 still references
  "legacy data written under the old GameTutorial-based code" — that
  fallback existed for the same dead migration and should be trimmed.

### 18. [ ] Engine-event subscription lifecycle
- **Problem.** Subscriptions to `PlayerTurnActivated`,
  `PlayerAgeTransitionComplete`, `BeforeAgeTransition`, and `BeforeUnload`
  are not all paired with explicit unsubscribes on the kill-switch path
  (#9) or on module teardown. A leaked subscription firing after the
  module is in a partial state is itself a likely source of the throws
  that trip the kill switch.
- **Action.** Audit every `engine.on(...)` / `addEventListener(...)` in
  `ui/demographics-sampler.js` and `ui/demographics-storage.js`. Store
  the returned handles and call `off` / `removeEventListener` on the
  kill-switch path. Add a single `_teardown()` that drains them all.
- **Files.** `ui/demographics-sampler.js`, `ui/demographics-storage.js`

### 19. [ ] Save-bloat measurement
- **Problem.** Cap + decimation are tuned by intuition. There is no
  measurement of actual serialized byte size per write.
- **Action.** Add a one-shot console helper (e.g. `window.__demoSizeOf()`)
  that reports the byte size of the property-bag payload at current turn
  count. Use it to set a sane default cap and to answer future user
  complaints quantitatively.
- **Files.** `ui/demographics-storage.js` (helper); no shipped UI.

### 20. [ ] README claims audit before release
- **Action.** After #1 (Tutorial-bag downgrade) and any other
  user-visible behavior changes land, re-read `docs/README.md` and the
  Workshop short description top-to-bottom and strip anything stale
  (cross-age history claims, template-based crisis names, etc.).
- **Files.** `docs/README.md`, `docs/steam-workshop-description-short.md`

### 21. [ ] Promote `tooltipSafeTextColor` to a shared utility
- **Problem.** Civ-color text-on-color contrast logic lives only in the
  chart tooltip. Relations ring labels, Wars Gantt labels, and any
  future surface have the same problem and risk diverging implementations.
- **Action.** Extract `safeTextColor(civColor)` into a shared module
  (e.g. `ui/civ-color-utils.js`); refactor the tooltip and all other
  civ-color text surfaces to use it.

### 22. [ ] `release.sh` exclusion audit
- **Problem.** After #3 excluded `text/data`, no one verified the rest
  of the exclusion list. One regex too loose and the Workshop zip ships
  `docs/`, `*.md`, `.DS_Store`, `node_modules/`, stray CSVs, etc.
- **Action.** Add an assertion step to `release.sh` that diffs the zip
  contents against an allow-list and fails the build on unexpected
  entries.
- **Files.** `release.sh`

### 23. [ ] Minimal test harness
- **Scope.** Two pure-function tests, ~30 lines total:
  - `flavorCrisisName(seed, type) → key` is deterministic across calls.
  - `_maybeDecimate(samples, cap)` preserves age-boundary turns and the
    latest age window.
- **Action.** Add `tests/` with a Node-runnable script (no framework
  needed). Excluded from the shipped zip via #22.

## Execution order

1. P0/#1 (Tutorial bag honesty) — blocking for any further persistence work.
2. P0/#2 (spoiler audit) — small surface, high reputational risk.
3. P1/#3 (template tokens) — ✅ done (migrated crisis names to LOC keys).
4. P2/#7 + P2/#8 (perfMode + decimation transparency) — paired cleanup.
5. P1/#4 (locale tone pass) — mechanical.
6. P2/#5, #6, #9, #10 — code-quality + perf sweep, can run in parallel.
   (#5 should also trim the stale "legacy GameTutorial migration"
   comment in `ui/demographics-storage.js` near line 341, flagged by #17.)
7. P3/#11, #12, #13 — content review, requires external input. (#12
   sensitivity scan + charged-name renames done; native pass on es/fr/pt/zh
   still pending.)
8. P4/#16, #18, #22 — pre-release hardening (settings defense, event
   lifecycle audit, release.sh allow-list).
9. P4/#14, #15, #19, #20, #21, #23 — defer / nice-to-have.

## Out of scope

- Rewriting the Triumphs decorator. Runtime probe confirmed no stable native
  `LegacyType` token is currently exposed in Triumph card DOM (`UI.log`,
  2026-06-01 08:10:51); keep the scoped decorator + title fallback and
  revisit only if Firaxis changes the Legacies screen.
- Replacing Chart.js. The `fxs-hof-chart` dependency is the engine's
  shipping chart and the right thing to ride.
