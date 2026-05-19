# Patches

Patches are standard `git format-patch` output applied against the VS Code source tree
**after** VSCodium's own patches have been applied. They live here and are picked up
automatically by the CI workflow.

## Naming convention

`NNN-short-description.patch` — three-digit prefix controls application order.

```
001-workbench-custom-css.patch
002-strip-residual-telemetry.patch
003-custom-titlebar.patch
```

## Creating a patch

```bash
# 1. Make sure you have vscode-src checked out and VSCodium patches applied.
cd vscode-src

# 2. Make your changes to source files.
# ... edit src/vs/... ...

# 3. Stage and commit inside the vscode-src git repo.
git add -p
git commit -m "feat: inject custom CSS into workbench"

# 4. Export the patch into this directory.
git format-patch HEAD~1 -o /path/to/ide-overlay/patches/

# 5. Rename to match the NNN- convention.
mv patches/0001-feat-inject-custom-css.patch patches/001-workbench-custom-css.patch
```

## Testing patches apply cleanly

```bash
# From the repo root (with vscode-src already at the MS_TAG checkout):
VSCODE_SRC=./vscode-src bash build.sh --patches-only
```

## Rebasing after an upstream bump

When `VSCODIUM_TAG` is bumped in `build.yml`, the corresponding `MS_TAG` in the VSCodium
repo changes. Patches must be rebased against the new vscode commit:

```bash
cd vscode-src

# The patch branch is a series of commits on top of the old MS_TAG.
# Rebase onto the new tag:
git rebase --onto <new-ms-tag> <old-ms-tag> HEAD

# Re-export all patches:
git format-patch <N>   # N = number of overlay patches
# Copy output to patches/ and rename to match NNN- convention.
```

## Target files for common patches

| What | Files to patch |
|---|---|
| Inject `workbench/custom.css` | `src/vs/workbench/browser/workbench.ts` — add `createStyleSheet` call in `startup()` |
| Strip residual telemetry | `src/vs/platform/telemetry/common/telemetryService.ts`, endpoint URLs in `src/vs/` |
| Custom title bar / borderless | `src/vs/workbench/browser/parts/titlebar/titlebarPart.ts` |
| Binary / app name in source | `src/vs/platform/product/common/product.ts` (most handled via `product.json` merge) |
