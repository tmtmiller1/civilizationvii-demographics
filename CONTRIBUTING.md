# Contributing

Thanks for your interest. Demographics is a read-only Civilization VII UI mod. This doc covers the setup, the one check to run before you submit, and the few conventions the code follows.

## Typed JavaScript, no build step

The mod is **typed JavaScript**, not TypeScript. Civ VII loads `.js` files directly into the Coherent GameFace engine at runtime — there is no transpile in the mod pipeline, and **what ships is exactly what you wrote** (no minification, no generated output). Types come from **JSDoc** annotations checked by `tsc --noEmit` (`checkJs`), so the `/** @param … */` blocks are the type system — keep them on exported functions and anywhere a type isn't obvious. Please don't
add `.ts` files or a build step.

## Setup

```sh
npm install
```

## Before you submit: `npm run verify`

```sh
npm run verify
```

This must pass with **zero errors and zero warnings**. It runs:

1. `tsc --noEmit` — JSDoc type checking (`checkJs`).
2. `eslint ui` — style + size limits.
3. the remediation test harness.

## Style limits (enforced by ESLint)

- cyclomatic complexity ≤ 10
- max statements per function ≤ 18
- max nesting depth ≤ 4
- max parameters ≤ 5 (bundle extras into a single options/context object)
- max lines per function ≤ 50
- line length ≤ 100 (warning)

When a function trips a limit, prefer extracting a small, named helper or a context object over disabling the rule.

## Conventions

- **Defensive engine access.** The GameFace API surface can be absent or throw
  (`Camera`, `UI.Player`, `Stats`, etc. may be undefined). Guard with
  `typeof X !== "undefined"` / the local `safeCall` wrappers and degrade gracefully — never assume an engine global exists.
- **Persistence.** History is stored in the GameConfiguration KV store
  (`Configuration.editGame().setValue` / `getGame().getValue`), seed-stamped and self-resetting on a new game. Settings live in the **shared** `localStorage` `modSettings` key (only ever write the single `demographics` slice; never add a second top-level `localStorage` key as other mods wipe `localStorage` when they
  see more than one).
- **Localization.** User-facing strings are LOC keys. Add every new key to all 10 locales under `text/<locale>/ModText.xml` (en_us is the base/fallback).
- **Comments.** Explain *why* (engine quirks, workarounds), not *what*. Avoid internal ticket/process references in shipped code.

## Project layout

```
ui/
  demographics-bootstrap.js   entry UIScript (engine.whenReady → load decorator + sampler)
  core/        cross-cutting infra (settings, contracts, i18n, audio, palette, a11y, dock decorator)
  metrics/     metric registry, helpers, formatting
  sampler/     per-turn sampling + collectors + war/age tracking
  storage/     history persistence (backend, load, schema, retention, cap)
  screen-demographics/
    screen/ charts/ views/ camera/ settlements/ styles/
text/<locale>/ModText.xml     localized strings (10 locales)
```

## Releasing

`./release.sh` produces the upload zip. It mutes debug logging in the dist copy and **always ships readable JS — there is no minification path.** The shipped file layout matches the dev tree.

## License

MIT. See [LICENSE](LICENSE). By contributing you agree your changes are licensed under the same terms.