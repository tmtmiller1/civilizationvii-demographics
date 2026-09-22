# scripts

Helper scripts for release and documentation tasks for the demographics mod.

## Files

- build_readme_pdf.sh: Builds README.pdf from README.md with pandoc and tectonic, pictures included.
- readme_pdf_source.mjs: Rewrites the README's HTML pictures as markdown figures (scaled for print) for that build.
- pdf_header.tex: Shared LaTeX header tweaks used by the README PDF build.
- table_wrap.lua: Pandoc Lua filter that applies wrapped-width table columns.
- deploy.mjs: Copies the files that ship into the game's Mods folder (`--check` reports a stale copy).
- required-scripts-gate.mjs: Fails `npm run verify` when a required npm script (such as a test) is missing from package.json.
- steam-changelog.mjs: Keeps CHANGELOG.steam.txt (Steam Workshop change notes) in step with CHANGELOG.md.
- hotspot-score.mjs: Ranks ui/ files by churn times complexity, to pick refactoring targets.
