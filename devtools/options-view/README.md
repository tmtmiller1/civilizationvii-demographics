# options-view (dev only, not shipped)

The Demographics screen's original in-screen Options tab. The player settings on it moved to the game's
own Options screen (Mods > Demographics, `ui/demographics-options.js`) on 2026-06-19 and the tab was
unmounted; what stayed on it was development instrumentation: a forced sample (Refresh sample), Clear
history (wipes every recorded sample of the game), Reset war history (a repair for an early war tracker),
storage-cap / decimation / poll-interval knobs, and a session line with sample count, schema and backend.
Those are not things a player should be able to do, so the view lives here, outside the deploy and
release sets (`scripts/deploy.mjs` ships `ui/` only; `release.sh` excludes `devtools`).

Files: `view-options.js`, `view-options-actions.js` (two-click armed destructive buttons),
`view-options-storage-controls.js`. They still import the mod's core modules by their absolute
`/demographics/ui/...` specifiers, so they run under the test loader.

Harness: `node --loader ./tests/loader.mjs ./devtools/options-view/options-view.test.mjs` (also
`npm run dev:options-view`). Not part of `npm run verify`.

To use the view in a game for a debugging session, add the three files to the modinfo `ImportFiles` of
the game group and mount `render(host, ctx)` from a probe UIScript; do not ship that change.
