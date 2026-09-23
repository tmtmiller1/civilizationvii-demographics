# scripts

Helper scripts for release and documentation tasks for the demographics mod.

## Files

- build_readme_pdf.sh: Builds README.pdf from README.md with pandoc and tectonic, pictures included.
- readme_pdf_source.mjs: Rewrites the README's HTML pictures as markdown figures (scaled for print) for that build.
- pdf_header.tex: Shared LaTeX header tweaks used by the README PDF build.
- table_wrap.lua: Pandoc Lua filter that applies wrapped-width table columns.
- deploy.mjs: Copies the files that ship into the game's Mods folder (`--check` reports a stale copy).
- required-scripts-gate.mjs: Fails `npm run verify` when a required npm script (such as a test) is missing from package.json, or when a required test is absent from the `verify` / `test:js` chains. The release gates it enforces beyond the unit tests: `test:storage-invariants` (shared localStorage root contract), `test:core-imports` (engine `/core/` imports exist in the installed game; skips with a warning when no install is found, `CIV7_GAME_DIR` overrides the lookup), `test:loc-keys` (every referenced LOC key is defined or registered as base-game), `test:control-assets` (Controls.define HTML/CSS exist and are declared in the modinfo), plus `test:modinfo` (import closure and zero runtime import cycles) and `test:i18n` (locale parity).
- steam-changelog.mjs: Keeps CHANGELOG.steam.txt (Steam Workshop change notes) in step with CHANGELOG.md.
- hotspot-score.mjs: Ranks ui/ files by churn times complexity, to pick refactoring targets.
