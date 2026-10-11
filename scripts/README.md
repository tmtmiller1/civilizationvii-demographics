# scripts

Helper scripts for releases and documentation.

## Files

- build_readme_pdf.sh: Builds README.pdf from README.md with pandoc and tectonic, pictures included.
- readme_pdf_source.mjs: Rewrites the README's HTML pictures as markdown figures (scaled for print) for that build.
- pdf_header.tex: Shared LaTeX header tweaks used by the README PDF build.
- table_wrap.lua: Pandoc Lua filter that applies wrapped-width table columns.
- deploy.mjs: Copies the files that ship into the game's Mods folder (`--check` reports a stale copy).
- The release gates are ordinary test files, run with the rest by `npm test` (`tests/run-all.mjs` finds every test in
  `tests/` by itself):
  - `tests/storage-invariants.mjs`: the shared localStorage root contract.
  - `tests/core-imports.mjs`: the engine `/core/` modules the mod imports exist in the installed game. Skips with a
    warning when no install is found; `CIV7_GAME_DIR` overrides the lookup.
  - `tests/loc-keys.mjs`: every LOC key the code names is defined, or registered as a base-game key.
  - `tests/control-assets.mjs`: the HTML and CSS each `Controls.define` names exist and are declared in the modinfo.
  - `tests/modinfo.mjs`: the import closure, and no runtime import cycles.
  - `tests/i18n.mjs`: every locale has the same tags.
- steam-changelog.mjs: Keeps CHANGELOG.steam.txt (Steam Workshop change notes) in step with CHANGELOG.md.
- gen-locale-fonts.mjs: Writes the per-locale font stylesheet that gives Chinese, Japanese and Korean text a face with
  those characters (`--check` reports a stale file).
- hotspot-score.mjs: Ranks ui/ files by churn times complexity, to pick refactoring targets.
