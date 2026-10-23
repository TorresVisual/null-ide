# Core Color Picker (Hue Ring + Triangle) — Design

Replaces the saturation square and hue strip in VS Code's built-in color picker with the Affinity-style hue ring and inscribed saturation/lightness triangle first built for `null-actions` (`extensions/null-actions/src/webview/colorPicker.ts`).

## Problem

Null IDE's own color picker (button text color in `null-actions`) is the picker the project wants everywhere, but it only exists inside one extension's settings webview. Anywhere the editor shows a color picker, the stock VS Code widget appears.

## Where core shows a picker

There is exactly one picker widget, `ColorPickerWidget` (`vscode-src/src/vs/editor/contrib/colorPicker/browser/colorPickerWidget.ts`). Two participants create it:

- the editor hover (`hoverColorPicker/hoverColorPickerParticipant.ts`),
- the "Show or Focus Standalone Color Picker" command (`standaloneColorPicker/standaloneColorPickerParticipant.ts`).

Nothing else in the workbench renders a picker. The Settings editor has none. Chat, SCM and limitIndicator import `ColorDetector` only, which draws swatch decorations. One swap point therefore covers every core picker.

## Scope

In scope: the picker body (saturation box + hue strip) is replaced by a ring + triangle part. The opacity strip stays, so `rgba()`, `hsla()` and `#rrggbbaa` keep working.

Out of scope: `null-actions`' own picker (separate webview, no module system, cannot share code); a setting to switch back to the stock picker; restyling the opacity strip; header, format cycling, Insert/Close buttons.

## Approach

Swap the body's parts and leave upstream files alone. `colorPickerSaturationBox.ts` and the hue `Strip` are not edited or deleted; `ColorPickerBody` just stops instantiating them (`OpacityStrip` still needs the `Strip` base). This keeps the patch small and the conflict surface minimal on each VSCodium bump.

Rejected: deleting the old parts (cleaner tree, larger diff to re-export every bump).

## Components

Patch `patches/012-color-ring-picker.patch`, applied after the VSCodium patches against the VS Code tree at `MS_TAG`.

| File (under `vs/editor/contrib/colorPicker/browser/`) | Change |
|---|---|
| `colorPickerParts/colorPickerRingMath.ts` (new) | Pure, import-free functions: HSL↔RGB, triangle vertices, barycentric ↔ (s, l), ring and triangle hit-testing. Ported from the `null-actions` picker and parameterized by size instead of the fixed 200 px. |
| `colorPickerParts/colorPickerRing.ts` (new) | `Disposable` part. Draws a conic-gradient ring and an ImageData triangle on one canvas (base layer cached per hue), handles pointer drag via `GlobalPointerMoveMonitor`, keyboard control (arrows: hue/lightness, PageUp/PageDown: saturation, Shift: larger step), fires `onDidChange` and `onColorFlushed` like `SaturationBox`. Uses the `pixelRatio` the body already receives. |
| `colorPickerParts/colorPickerBody.ts` | Instantiates the ring instead of `SaturationBox` + `HueStrip`; keeps the opacity strip and the standalone Insert button. Exposes the ring under a getter the standalone widget can size from. |
| `colorPicker.css` | Styles for the ring part. `.colorpicker-widget` stays 190 px tall. |
| `standaloneColorPicker/standaloneColorPickerWidget.ts` | About 3 lines: it reads `colorPickerBody.saturationBox.domNode.clientWidth` to size the header; point it at the ring's `domNode`. |

Geometry: the ring is about 150 px in diameter (the body's existing height), centered in the existing 220 px-wide area, scaled from the 200 px original. Ring thickness, triangle radius and handle sizes keep the original ratios. Header width math in the standalone widget keeps working because the wrap's width is unchanged. No hover relayout.

## Data flow

1. The ring reads `model.color` (a `Color`) and renders from it.
2. On drag or key input it builds a new `Color` from HSLA and assigns `model.color`, copying alpha from the current color so the opacity strip's value is never disturbed.
3. `onColorFlushed` fires on pointer-up / after a key step, as `SaturationBox` does, so the existing flush → `updateEditorModel` path writes the edit.

### Hue at greys

HSL has no hue at saturation 0, and a `Color` built from HSLA derives its HSVA from RGB, losing hue. Without care, dragging the triangle to black or white snaps the hue handle to red. The ring therefore keeps its own `hue` field. It updates it from the model only when the incoming color has saturation above a small epsilon and the change did not originate from the ring itself; for grey incoming colors it keeps the last hue.

### Model change while dragging

As in `SaturationBox`, `onDidChangeColor` is ignored while a drag is active, so the ring does not fight its own writes.

## Testing and verification

- `patches/test/colorRing.test.mjs` (`node --test patches/test/*.test.mjs`), loading `colorPickerRingMath.ts` through Node type stripping like `safeMode.test.mjs`, skipped when `vscode-src` is absent. Cases:
  - HSL→RGB→HSL round-trips across hues and the s/l corners;
  - position → (s, l) → position consistency for the triangle;
  - hit-test classification: on the ring, in the triangle, outside both, and the feathered edge;
  - grey colors keep a supplied hue.
- `git apply --check` of the patch against `vscode-src`, and a TypeScript check of the touched files.
- Visual and interaction verification needs a built app (CI or `scripts/build-local.ps1`, tens of minutes). Not run unless asked. Checklist for that run: hover on `#rrggbb`, `rgba()` and `hsl()` literals; format cycling; opacity strip; standalone picker (Insert and Close); drag to black/white keeps hue; keyboard; high-DPI.

## Bookkeeping

- Add the patch to the list in `CLAUDE.md`.
- `upstream-check.yml` already applies every `patches/*.patch`; nothing to change.
- The `null-actions` picker stays as is.

## Risks

- Upstream drift in `ColorPickerBody` or the standalone widget breaks the patch on a VSCodium bump. Mitigated by the small touch surface; `upstream-check.yml` flags it.
- A 150 px ring is smaller than the 200 px original. Handle and ring thickness are scaled to fit; if it feels cramped the follow-up is a taller widget, which does need hover relayout and is deliberately not done here.
