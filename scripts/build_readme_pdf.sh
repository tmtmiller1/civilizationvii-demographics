#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

pandoc "$ROOT_DIR/README.md" \
  --from gfm \
  --lua-filter="$ROOT_DIR/scripts/table_wrap.lua" \
  --toc \
  --toc-depth=2 \
  --pdf-engine=tectonic \
  -V title="Demographics for Civilization VII" \
  -V author="" \
  -V date="" \
  -V geometry:margin=0.65in \
  -V fontsize=10pt \
  -V linestretch=1.03 \
  --include-in-header="$ROOT_DIR/scripts/pdf_header.tex" \
  -o "$ROOT_DIR/README.pdf"

shasum "$ROOT_DIR/README.pdf"
