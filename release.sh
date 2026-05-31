#!/usr/bin/env bash
# release.sh — produce a clean, debug-disabled zip ready for mod.io upload.
#
# Usage:  ./release.sh
# Output: dist/demographics-vX.Y.Z.zip  (X.Y.Z read from demographics.modinfo <Version>)
#
# What this does:
#   1. Mirrors the mod source into dist/demographics/
#   2. Sed-replaces `const DBG = true` -> `const DBG = false` in every JS file
#      so the verbose `console.warn` traces don't fire in shipped builds.
#      Source code stays development-friendly; only the dist copy is muted.
#   3. Verifies the modinfo has Version + Authors set to non-default values.
#   4. Zips the result with `demographics/` as the zip root (mod.io / Steam
#      Workshop need the modinfo at zip root, not inside a wrapper folder).
#
# Run from the mod source directory.

set -euo pipefail

cd "$(dirname "$0")"

# Source detection: this script lives at the mod root (next to demographics.modinfo),
# but the zip needs `demographics/` as the root folder name regardless.
DIST_DIR="dist"
if [ -f "demographics.modinfo" ]; then
    SRC_DIR="."
elif [ -f "demographics/demographics.modinfo" ]; then
    SRC_DIR="demographics"
else
    echo "error: no demographics.modinfo in $(pwd) or $(pwd)/demographics/"
    exit 1
fi

# Pull <Version> from the modinfo (first match wins).
VERSION="$(grep -oE '<Version>[^<]+</Version>' "$SRC_DIR/demographics.modinfo" \
    | head -1 | sed -E 's|</?Version>||g')"
[ -n "$VERSION" ] || { echo "error: could not parse <Version> from modinfo"; exit 1; }

AUTHORS="$(grep -oE '<Authors>[^<]+</Authors>' "$SRC_DIR/demographics.modinfo" \
    | head -1 | sed -E 's|</?Authors>||g')"
case "$AUTHORS" in
    ""|"Your Name"|"TODO")
        echo "error: <Authors> in modinfo is '$AUTHORS' — set a real author name first."
        exit 1
        ;;
esac

case "$VERSION" in
    *-smoke|*-dev|0.0.*)
        echo "error: <Version> '$VERSION' looks like a dev tag — bump to a release version first."
        exit 1
        ;;
esac

ZIP_NAME="demographics-v${VERSION}.zip"
TARGET_DIR="$DIST_DIR/demographics"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

echo "==> Cleaning $DIST_DIR/"
rm -rf "$DIST_DIR"
mkdir -p "$TARGET_DIR"

echo "==> Mirroring $SRC_DIR/ → $TARGET_DIR/ (excluding dev cruft)"
rsync -a --exclude='.git' --exclude='.DS_Store' --exclude='dist' \
    --exclude='release.sh' --exclude='*.bak' --exclude='node_modules' \
    "$SRC_DIR"/ "$TARGET_DIR"/

echo "==> Disabling debug logging in dist JS files"
# Both patterns we use across the codebase:
#   `const DBG = true;`               (most modules)
#   `let DEMOGRAPHICS_DEBUG = true;`   (sampler; var so it can self-downgrade)
#   `const DEMOGRAPHICS_DEBUG = true;` (bootstrap, view-relations)
# BSD/macOS sed needs the empty -i argument.
find "$TARGET_DIR" -name '*.js' -type f -print0 | xargs -0 sed -i '' -E \
    -e 's/^const DBG = true;/const DBG = false;/' \
    -e 's/^let DEMOGRAPHICS_DEBUG = true;/let DEMOGRAPHICS_DEBUG = false;/' \
    -e 's/^const DEMOGRAPHICS_DEBUG = true;/const DEMOGRAPHICS_DEBUG = false;/'

echo "==> Syntax-checking dist JS"
find "$TARGET_DIR" -name '*.js' -type f -print0 \
    | xargs -0 -n1 node -c

echo "==> Verifying modinfo at zip root"
[ -f "$TARGET_DIR/demographics.modinfo" ] \
    || { echo "error: $TARGET_DIR/demographics.modinfo missing"; exit 1; }

echo "==> Zipping $ZIP_PATH"
( cd "$DIST_DIR" && zip -qr "$ZIP_NAME" demographics )

# Sanity-check zip contents.
echo "==> Zip contents (first 20 entries):"
unzip -l "$ZIP_PATH" | head -25

SIZE="$(du -h "$ZIP_PATH" | cut -f1)"

# ── Steam Workshop upload assets ──────────────────────────────────────────
# Generate a 512×512 PNG preview from the SVG icon and a workshop_item.vdf
# template ready to use with steamcmd. The .vdf needs absolute paths so we
# build them off $(pwd).

PREVIEW_SRC="$SRC_DIR/images/demographics-icon.svg"
PREVIEW_OUT="$DIST_DIR/preview.png"
if [ -f "$PREVIEW_SRC" ]; then
    if command -v rsvg-convert >/dev/null 2>&1; then
        rsvg-convert -w 512 -h 512 "$PREVIEW_SRC" -o "$PREVIEW_OUT"
        echo "==> Workshop preview rendered:  $PREVIEW_OUT"
    elif command -v sips >/dev/null 2>&1; then
        # macOS fallback: sips can't read SVG, so we skip and warn.
        echo "==> rsvg-convert not found; preview.png NOT generated."
        echo "    Install with:  brew install librsvg"
    fi
fi

VDF_PATH="$DIST_DIR/workshop_item.vdf"
ABS_CONTENT="$(cd "$TARGET_DIR" && pwd)"
ABS_PREVIEW=""
[ -f "$PREVIEW_OUT" ] && ABS_PREVIEW="$(cd "$DIST_DIR" && pwd)/preview.png"

cat > "$VDF_PATH" <<EOF
"workshopitem"
{
    "appid"          "1295660"
    "contentfolder"  "$ABS_CONTENT"
EOF
[ -n "$ABS_PREVIEW" ] && echo "    \"previewfile\"    \"$ABS_PREVIEW\"" >> "$VDF_PATH"
cat >> "$VDF_PATH" <<EOF
    "visibility"     "0"
    "title"          "Demographics"
    "description"    "Civilization V's Demographics, ported to VII. Real-time per-civ history graphs (score, GDP, military power, legacy paths…), a per-civ Factbook, global relations rings, and a conflicts gantt of every war. Pure presentation — never affects game state."
    "changenote"     "v${VERSION} release."
    // After first upload, steamcmd will print a publishedfileid.
    // Add it here as:    "publishedfileid"  "1234567890"
    // so subsequent runs update the existing item instead of creating a new one.
}
EOF

echo "==> Workshop manifest written: $VDF_PATH"
echo ""
echo "✓ Release built:  $ZIP_PATH  ($SIZE)"
echo "  Version:        $VERSION"
echo "  Authors:        $AUTHORS"
echo ""
echo "── Upload to Steam Workshop (from Mac) ──"
echo "  1. Install SteamCMD if you haven't:"
echo "       mkdir -p ~/steamcmd && cd ~/steamcmd"
echo "       curl -sqL 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz' | tar zxvf -"
echo ""
echo "  2. Upload (Steam Guard prompt will appear on first login):"
echo "       ~/steamcmd/steamcmd.sh +login <yourSteamLogin> \\"
echo "           +workshop_build_item $(cd "$DIST_DIR" && pwd)/workshop_item.vdf +quit"
echo ""
echo "  3. The first run prints a publishedfileid. Paste it into $VDF_PATH"
echo "     (uncomment the publishedfileid line) so re-runs UPDATE the item"
echo "     instead of creating a new one."
