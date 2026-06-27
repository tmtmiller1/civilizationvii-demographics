# Commit-Ready Hardening Notes (2026-06-26)

## Scope
Non-player-facing hardening and regression prevention for the Demographics mod.

## Recommended Commit Split

### 1) storage: envelope persistence + legacy migration compatibility
Files:
- ui/storage/storage-load.js
- ui/storage/storage-retention.js
- ui/storage/demographics-storage.js
- tests/storage-schema.mjs

Message:
- storage: write versioned envelope payloads, keep legacy payload load compatibility

### 2) test: add storage/governance branch hardening harnesses
Files:
- tests/storage-load-branches.mjs
- tests/storage-backend-branches.mjs
- tests/storage-cap-branches.mjs
- tests/governance-branches.mjs

Message:
- test: add branch harnesses for storage load/backend/cap and governance policies

### 3) build: enforce script-chain integrity and release gate
Files:
- scripts/required-scripts-gate.mjs
- package.json
- CHANGELOG.md

Message:
- build: enforce required scripts in verify/test chains and add release gate

## Validation Performed
- npm run test:required-scripts
- npm run verify
- npm run release:gate

All passed after hardening changes.
