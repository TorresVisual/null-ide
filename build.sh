#!/usr/bin/env bash
# Local development helper — runs on Linux/WSL for patch testing.
# Full builds run in GitHub Actions on a Windows runner (see .github/workflows/build.yml).
set -euo pipefail

OVERLAY_DIR="$(cd "$(dirname "$0")" && pwd)"
VSCODE_SRC="${VSCODE_SRC:-$OVERLAY_DIR/../vscode-src}"
MODE="${1:-help}"

usage() {
  cat <<EOF
Usage: $0 <mode>

Modes:
  --patches-only    Apply overlay patches to VSCODE_SRC (assumes VSCodium patches already applied)
  --css-only        Copy workbench/custom.css → VSCODE_SRC/src/vs/workbench/browser/null-custom.css
  --icons-only      Copy icons from icons/ into VSCODE_SRC
  --theme-only      Copy extensions/null-theme into VSCODE_SRC/extensions/
  --product-only    Merge product.json overlay into VSCODE_SRC/product.json

Environment:
  VSCODE_SRC        Path to the vscode source tree (default: ../vscode-src)

The full build pipeline is defined in .github/workflows/build.yml.
EOF
  exit "${2:-0}"
}

require_vscode_src() {
  if [ ! -d "$VSCODE_SRC" ]; then
    echo "ERROR: VSCODE_SRC not found at: $VSCODE_SRC"
    echo "Clone vscode at the MS_TAG version and set VSCODE_SRC accordingly."
    exit 1
  fi
}

case "$MODE" in
  --patches-only)
    require_vscode_src
    patch_dir="$OVERLAY_DIR/patches"
    patches=("$patch_dir"/*.patch 2>/dev/null || true)
    if [ ${#patches[@]} -eq 0 ] || [ ! -f "${patches[0]}" ]; then
      echo "No patches to apply (patches/ is empty)."
      exit 0
    fi
    cd "$VSCODE_SRC"
    for patch in "$patch_dir"/*.patch; do
      echo "Applying: $(basename "$patch")"
      git apply --ignore-whitespace "$patch"
    done
    ;;

  --css-only)
    require_vscode_src
    wb="$VSCODE_SRC/src/vs/workbench/browser"
    cp "$OVERLAY_DIR/workbench/custom.css"  "$wb/null-custom.css"
    echo "Copied workbench/custom.css → $wb/null-custom.css"
    cp "$OVERLAY_DIR/workbench/splash.js"   "$wb/null-splash.js"
    echo "Copied workbench/splash.js → $wb/null-splash.js"
    ;;

  --icons-only)
    require_vscode_src
    icon_dir="$OVERLAY_DIR/icons"
    [ -f "$icon_dir/icon.ico" ] && cp "$icon_dir/icon.ico" "$VSCODE_SRC/resources/win32/code.ico" \
      && echo "Copied icon.ico"
    # Extend here as more icon variants are added (icns, png sizes, etc.)
    ;;

  --theme-only)
    require_vscode_src
    cp -r "$OVERLAY_DIR/extensions/null-theme" "$VSCODE_SRC/extensions/"
    echo "Copied null-theme to $VSCODE_SRC/extensions/"
    ;;

  --product-only)
    require_vscode_src
    node "$OVERLAY_DIR/scripts/merge-json.js" \
      "$VSCODE_SRC/product.json" \
      "$OVERLAY_DIR/product.json" \
      "$VSCODE_SRC/product.json"
    ;;

  help|--help|-h|"")
    usage
    ;;

  *)
    echo "Unknown mode: $MODE"
    usage 1
    ;;
esac
