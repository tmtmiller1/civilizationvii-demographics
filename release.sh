#!/usr/bin/env bash
# release.sh: produce a clean, debug-disabled zip ready for mod.io upload.
#
# Usage:  ./release.sh
# Output: dist/demographics-vX.Y.Z.zip  (X.Y.Z read from demographics.modinfo <Version>)
#
# What this does:
#   1. Mirrors the mod source into dist/demographics/
#   2. Sed-replaces `const DBG = true` -> `const DBG = false` in every JS file
#      so the verbose `console.warn` traces don't fire in shipped builds.
#      Source code stays development-friendly; only the dist copy is muted.
#   3. Always ships readable JS (no minification; transparent source is a core
#      property of the mod, so there is no minify path).
#   4. Verifies the modinfo has Version + Authors set to non-default values.
#   5. Zips the result with `demographics/` as the zip root (mod.io / Steam
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
    echo "error: <Authors> in modinfo is '$AUTHORS'; provide a release author name before packaging."
        exit 1
        ;;
esac

case "$VERSION" in
    *-smoke|*-dev|0.0.*)
        echo "error: <Version> '$VERSION' looks like a dev tag; bump to a release version first."
        exit 1
        ;;
esac

# ── Steam Workshop published file id ──────────────────────────────────────
# The publishedfileid is what makes steamcmd UPDATE the existing Workshop item
# instead of creating a duplicate. It must survive the `rm -rf dist` below, so we
# persist it OUTSIDE dist/ in steam_workshop_id.txt (committed to the repo).
# Resolution priority: saved steam_workshop_id.txt is authoritative by default;
# WORKSHOP_PUBLISHED_FILE_ID may be used only when it matches the saved id (or
# no saved id exists); final fallback recovers from leftover dist/workshop_item.vdf.
WORKSHOP_ID_FILE="$SRC_DIR/steam_workshop_id.txt"
PUBLISHED_FILE_ID="${WORKSHOP_PUBLISHED_FILE_ID:-}"
SAVED_PUBLISHED_FILE_ID=""
if [ -f "$WORKSHOP_ID_FILE" ]; then
    SAVED_PUBLISHED_FILE_ID="$(tr -dc '0-9' < "$WORKSHOP_ID_FILE")"
fi
if [ -n "$PUBLISHED_FILE_ID" ] && [ -n "$SAVED_PUBLISHED_FILE_ID" ] \
    && [ "$PUBLISHED_FILE_ID" != "$SAVED_PUBLISHED_FILE_ID" ]; then
    echo "error: WORKSHOP_PUBLISHED_FILE_ID ($PUBLISHED_FILE_ID) conflicts with"
    echo "       steam_workshop_id.txt ($SAVED_PUBLISHED_FILE_ID)."
    echo "       Refusing to override the saved mod number."
    echo "       Unset WORKSHOP_PUBLISHED_FILE_ID or update steam_workshop_id.txt intentionally."
    exit 1
fi
if [ -z "$PUBLISHED_FILE_ID" ] && [ -n "$SAVED_PUBLISHED_FILE_ID" ]; then
    PUBLISHED_FILE_ID="$SAVED_PUBLISHED_FILE_ID"
fi
if [ -z "$PUBLISHED_FILE_ID" ] && [ -f "$DIST_DIR/workshop_item.vdf" ]; then
    PUBLISHED_FILE_ID="$(grep -oE '"publishedfileid"[[:space:]]*"[0-9]+"' \
        "$DIST_DIR/workshop_item.vdf" | grep -oE '[0-9]+' | head -1 || true)"
fi

ZIP_NAME="demographics-v${VERSION}.zip"
TARGET_DIR="$DIST_DIR/demographics"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"

echo "==> Cleaning $DIST_DIR/"
rm -rf "$DIST_DIR"
mkdir -p "$TARGET_DIR"

echo "==> Mirroring $SRC_DIR/ → $TARGET_DIR/ (excluding dev cruft)"
rsync -a --exclude='.git' --exclude='.gitignore' --exclude='.DS_Store' --exclude='dist' \
    --exclude='release.sh' --exclude='*.bak' --exclude='node_modules' \
    --exclude='tsconfig.json' --exclude='jsconfig.json' --exclude='types' --exclude='docs' \
    --exclude='eslint.config.js' --exclude='package.json' --exclude='package-lock.json' \
    --exclude='*.d.ts' --exclude='text/data' --exclude='tests' \
    --exclude='steam_workshop_id.txt' --exclude='CONTRIBUTING.md' \
    --exclude='coverage' --exclude='.c8rc.json' \
    --exclude='reports' --exclude='.stryker-tmp' --exclude='stryker.config.json' \
    --exclude='scripts' --exclude='README.pdf' \
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

# Dist JS is ALWAYS shipped readable - no minification. Transparent, inspectable
# source is a core property of this mod, so there is intentionally no minify path.
echo "==> Shipping dist JS readable (no minification)"

echo "==> Syntax-checking dist JS"
find "$TARGET_DIR" -name '*.js' -type f -print0 \
    | xargs -0 -n1 node -c

echo "==> Verifying modinfo at zip root"
[ -f "$TARGET_DIR/demographics.modinfo" ] \
    || { echo "error: $TARGET_DIR/demographics.modinfo missing"; exit 1; }

echo "==> Zipping $ZIP_PATH"
( cd "$DIST_DIR" && zip -qr "$ZIP_NAME" demographics )

# Allow-list audit: fail the build on any shipped file that isn't expected, so a
# loose rsync exclude can't silently ship docs/, tests/, *.d.ts, dev configs,
# stray CSVs, .DS_Store, etc. Update ALLOW when a new shipped file type is added.
echo "==> Verifying zip contents against allow-list"
ALLOW='^demographics/(demographics\.modinfo|README\.md|LICENSE|CHANGELOG\.md)$'
ALLOW="$ALLOW"'|^demographics/ui/.+\.(js|html|css)$'
ALLOW="$ALLOW"'|^demographics/images/.+\.(svg|png)$'
ALLOW="$ALLOW"'|^demographics/text/[a-z_]+/ModText\.xml$'
UNEXPECTED="$(unzip -Z1 "$ZIP_PATH" | grep -vE '/$' | grep -vE "$ALLOW" || true)"
if [ -n "$UNEXPECTED" ]; then
    echo "error: zip contains entries not on the allow-list:"
    echo "$UNEXPECTED" | sed 's/^/    /'
    echo "  → tighten the rsync --exclude list, or update ALLOW in release.sh if intended."
    exit 1
fi
echo "    OK: every shipped entry matches the allow-list."

echo "==> Zip contents:"
unzip -l "$ZIP_PATH" | head -25 || true

SIZE="$(du -h "$ZIP_PATH" | cut -f1)"

# ── Steam Workshop upload assets ──────────────────────────────────────────
# Generate a 1024×1024 PNG preview for the Workshop thumbnail and a
# workshop_item.vdf template ready to use with steamcmd. The .vdf needs absolute
# paths so we build them off $(pwd).
#
# Prefer the branded preview card (docs/workshop-preview.svg: dark frame + logo
# + wordmark) over the bare 64px icon, since the card reads far better in the
# Steam Workshop grid. Falls back to the raw icon if the card is absent.
PREVIEW_SRC="$SRC_DIR/docs/workshop-preview.svg"
[ -f "$PREVIEW_SRC" ] || PREVIEW_SRC="$SRC_DIR/images/demographics-icon.svg"
PREVIEW_OUT="$DIST_DIR/preview.png"
if [ -f "$PREVIEW_SRC" ]; then
    if command -v rsvg-convert >/dev/null 2>&1; then
        rsvg-convert -w 1024 -h 1024 "$PREVIEW_SRC" -o "$PREVIEW_OUT"
        echo "==> Workshop preview rendered:  $PREVIEW_OUT  (from $(basename "$PREVIEW_SRC"))"
    elif command -v sips >/dev/null 2>&1; then
        # macOS fallback: sips can't read SVG, so we skip and warn.
        echo "==> rsvg-convert not found; preview.png NOT generated."
        echo "    Install with:  brew install librsvg"
    fi
fi

VDF_PATH="$DIST_DIR/workshop_item.vdf"
VDF_NOPREVIEW_PATH="$DIST_DIR/workshop_item_no_preview.vdf"
ABS_CONTENT="$(cd "$TARGET_DIR" && pwd)"
ABS_PREVIEW=""
[ -f "$PREVIEW_OUT" ] && ABS_PREVIEW="$(cd "$DIST_DIR" && pwd)/preview.png"

# Change note: pull the current version's section out of CHANGELOG.md (Keep a
# Changelog format) and render its bullet lines as a Steam BBCode list. Falls
# back to a generic note if CHANGELOG.md or the matching section is absent.
CHANGELOG_FILE="$SRC_DIR/CHANGELOG.md"
CHANGENOTE="v${VERSION} release."
if [ -f "$CHANGELOG_FILE" ]; then
    # awk: print lines between "## [VERSION]" and the next "## " header.
    BULLETS="$(awk -v ver="$VERSION" '
        $0 ~ ("^## \\[" ver "\\]") { grab = 1; next }
        grab && /^## / { exit }
        grab { print }
    ' "$CHANGELOG_FILE" \
        | sed -nE 's/^[[:space:]]*[-*][[:space:]]+(.*)$/[*]\1/p' \
        | sed -E 's/\*\*//g; s/`//g' \
        | tr '\n' ' ')"
    if [ -n "$BULLETS" ]; then
        # Wrap as a BBCode list and escape backslashes/quotes for the VDF string.
        CHANGENOTE="$(printf '[list]%s[/list]' "$BULLETS" \
            | sed -E 's/\\/\\\\/g; s/"/\\"/g')"
    fi
fi

write_workshop_vdf() {
    local out_path="$1"
    local include_preview="$2"
    cat > "$out_path" <<EOF
"workshopitem"
{
    "appid"          "1295660"
EOF
[ -n "$PUBLISHED_FILE_ID" ] && echo "    \"publishedfileid\" \"$PUBLISHED_FILE_ID\"" >> "$out_path"
cat >> "$out_path" <<EOF
    "contentfolder"  "$ABS_CONTENT"
EOF
    if [ "$include_preview" = "yes" ] && [ -n "$ABS_PREVIEW" ]; then
        echo "    \"previewfile\"    \"$ABS_PREVIEW\"" >> "$out_path"
    fi
cat >> "$out_path" <<EOF
    "visibility"     "0"
    "title"          "Demographics"
EOF
# NOTE: "description" is intentionally omitted. steamcmd's workshop_build_item
# only updates the fields present in this VDF, so leaving it out preserves the
# description currently set on the Steam Workshop page instead of overwriting it.
cat >> "$out_path" <<EOF
    "changenote"     "${CHANGENOTE}"
EOF
if [ -z "$PUBLISHED_FILE_ID" ]; then
    cat >> "$out_path" <<EOF
    // First upload: steamcmd will print a publishedfileid when this completes.
    // Save it so re-runs UPDATE the existing item instead of creating a duplicate:
    //     echo <publishedfileid> > steam_workshop_id.txt
EOF
fi
    echo "}" >> "$out_path"
}

write_workshop_vdf "$VDF_PATH" yes
write_workshop_vdf "$VDF_NOPREVIEW_PATH" no

# Persist the id so it's durable across `rm -rf dist` on future runs.
if [ -n "$PUBLISHED_FILE_ID" ]; then
    printf '%s\n' "$PUBLISHED_FILE_ID" > "$WORKSHOP_ID_FILE"
fi

echo "==> Workshop manifest written: $VDF_PATH"
echo "==> Workshop no-preview manifest written: $VDF_NOPREVIEW_PATH"
if [ -n "$PUBLISHED_FILE_ID" ]; then
    echo "    UPDATE mode: publishedfileid $PUBLISHED_FILE_ID (existing item)"
else
    echo "    NEW-ITEM mode: no publishedfileid yet (first upload will create one)"
fi
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
echo ""
echo "     If Steam rejects the preview upload with Access Denied, upload with:"
echo "       ~/steamcmd/steamcmd.sh +login <yourSteamLogin> \\
"
echo "           +workshop_build_item $(cd "$DIST_DIR" && pwd)/workshop_item_no_preview.vdf +quit"
if [ -z "$PUBLISHED_FILE_ID" ]; then
echo "  3. The first run prints a publishedfileid. Save it so future runs UPDATE"
echo "     the existing item instead of creating a duplicate:"
echo "       echo <publishedfileid> > steam_workshop_id.txt"
else
echo "  3. This builds in UPDATE mode (publishedfileid $PUBLISHED_FILE_ID from"
echo "     steam_workshop_id.txt), so the upload updates the existing item."
fi
