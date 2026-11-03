# Null Unreal — Asset Viewers Design

Issue: [#151 Unreal asset viewers](https://github.com/TorresVisual/null-ide/issues/151)

Third of three specs for Unreal Engine support in Null IDE, and the reason for the other two. It builds on [null-unreal-tooling-design.md](null-unreal-tooling-design.md) (the `null-unreal` extension, engine and project resolution) and [null-unreal-asset-core-design.md](null-unreal-asset-core-design.md) (the `.uasset` → JSON export, its cache and sidecar files). Both are implemented first; this plan assumes the `AssetStore` from the asset core spec exists.

## Goal

Open a `.uasset` in Null IDE and see what Unreal's editor would show for it: the node graph of a material, the image of a texture, the 3D shape of a skeletal mesh. No Unreal UI is involved. After the first open (a few seconds while the engine exports it) the asset opens from the cache instantly.

## Today

- `.uasset` files open as unreadable binary. The asset core spec produces the data (JSON plus PNG and GLB sidecar files) but nothing displays it.
- The repo already has the pattern to copy: `null-markdown` registers a custom editor, bundles its webview with esbuild into tracked `lib/*.js` files, takes `node_modules` from `npm ci --prefix` in CI (not copied by `sync-local.ps1`), and keeps pure logic in testable `.mjs` modules.
- The extension host owns state; a webview only draws and reports clicks.

## Scope

Kinds, in build order (cheapest first): **texture**, **material graph** (with material instance and skeleton as small property views), **skeletal mesh**. The generic kind shows a properties tree. `.umap` opens in the generic view only; Blueprints and maps stay deferred as in the asset core spec.

**Non-goals**

- Editing anything. The viewers are read-only; the header says "saved file" because the data is the last saved state, not unsaved editor state.
- Blueprint graphs, level (map) rendering, animation playback, material previews rendered by the engine, a minimap, graph search, diffing.
- Reproducing Unreal's look pixel for pixel. The graph should read like Unreal's (node colors by family, typed pins), not clone it.

**Anti-goals**

- **A viewer that looks right and is wrong.** Anything the export marked `unreadable`, any link whose target is missing, and any texture format shown from a tone-mapped preview must be visible as such, never silently dropped or defaulted.
- **A viewer that triggers engine runs nobody asked for.** Opening a material must not start exporting every texture it references (6 s each, serialized). Referenced assets that are not cached show placeholders and one explicit button.

## Decisions

1. **One read-only custom editor** (`CustomReadonlyEditorProvider`, view type `null-unreal.assetViewer`) for `*.uasset` and `*.umap`, priority `default`; VS Code's "Reopen With…" still reaches any other editor. It lives in `null-unreal`; no new extension.
2. **Host chooses the page by `kind`.** The host asks `AssetStore` for the export, then loads one webview page per kind (texture, material, material-instance, skeletal-mesh, generic). The webview never reads files: images, GLBs and JSON come through `asWebviewUri` with `localResourceRoots` limited to the asset cache folder (`Saved/NullUnreal/assets`). Strict CSP with a nonce.
3. **Frame (all kinds).** A header strip: asset name, kind, a "saved file" badge, a re-export button (`--force`). Body states: *exporting* ("Exporting from Unreal, about 6 s"), *ready*, *failed* (the manifest's error and a link to the log). When the file changes on disk, the viewer keeps the old content visible and shows "file changed — click to update"; it never starts an engine run by itself (a second engine instance per save, while the editor is open, is exactly the unasked-for run the anti-goals rule out). [my call]
   **When no export is possible** (no engine resolved, project not built, Python plugin off, cooked asset, file outside a content root, no engine on the remote host) the *failed* state shows the error with its fix hint and a *Reopen as text* button. The editor keeps priority `default`: in a workspace that has no Unreal project a `.uasset` is not useful as text anyway. [my call]
4. **Layout: full-width canvas with a slide-over inspector** (the layout the developer picked from three mockups). Clicking a node opens the inspector over the right edge; clicking empty canvas closes it. The inspector never reflows the canvas.

```
┌──────────────────────────────────────────────────────────┐
│ M_Example   Material        [saved file]  [↻]        │
├──────────────────────────────────────────────┬───────────┤
│  · · · · · · · · · · · · · · · · · · · ·    │ Multiply  │
│   ┌────────────┐   ┌────────┐   ┌────────┐  │ ConstB 1.0│
│   │TextureSample├──▶│Multiply├──▶│Material│  │ Desc tint │
│   └────────────┘   └────────┘   └────────┘  │ (slides   │
│  · · · · · · · · · · · · · · · · · · · ·    │  over)    │
└──────────────────────────────────────────────┴───────────┘
```

5. **Material graph: hand-rolled SVG, no graph library.** Nodes sit at the export's saved editor positions; pins are coloured by type; links are cubic Béziers; pan with drag, zoom with the wheel, fit-to-view on open; click selects. Comment boxes render as background rectangles with their text; reroute nodes as small dots. A node library was set aside because it imposes its own look and a framework. A UI-agnostic **render model** (`{ nodes, pins, links, bounds }`, built by a pure function from the export) sits between the export and the SVG, so a later Blueprint viewer can reuse the renderer. [my call: SVG draws all nodes; virtualization is the upgrade if graphs reach thousands of nodes]
6. **Referenced textures are lazy.** A texture-sample node shows the thumbnail only if that texture is already cached; otherwise a placeholder. The inspector offers *Export referenced textures*, which requests all of them as one batch (one engine run). Double-clicking a texture node opens that texture's viewer, exporting it on demand if needed.
7. **Texture viewer:** the exported PNG on a canvas with zoom, pan, a checkerboard behind transparency, 1:1 and fit, and R / G / B / A channel toggles. Format, size, mip count, compression and sRGB are in the inspector. For HDR or float formats the PNG is a tone-mapped preview and the viewer says so. Cube maps, volume textures and texture arrays show metadata and the first slice if the export provides one, otherwise "no preview". [my call]
8. **Material instance and skeleton viewers are property views, not graphs.** Material instance: parent chain with a link that opens the parent, a parameter table marking overridden versus inherited values (inherited values come from the parent's export if cached), and texture overrides as thumbnails. Skeleton: the bone tree.
9. **Mesh viewer: three.js** with its GLB loader and orbit controls, in a separate lazily loaded bundle (`lib/mesh.js`) so non-mesh assets never load it. Toggles: wireframe and skeleton overlay. The inspector lists LODs with vertex and triangle counts, material slots, and morph targets. `<model-viewer>` was set aside because it has no wireframe or bone overlay.
10. **Bundling follows `null-markdown`:** esbuild produces tracked `lib/*.js` (texture, material, mesh, generic pages), `three` is a dev dependency installed by `npm ci --prefix` in CI, `lib/` is committed, `node_modules` is not synced by `sync-local.ps1`. Styling uses VS Code's theme CSS variables so the viewers follow Null Dark and any other theme. Webview code compiles from TypeScript, with pure logic in modules that import neither `vscode` nor the DOM.

11. **Schema ownership and sequencing.** The export schema belongs to the asset core spec; the viewers work may add fields or bump `schema`, and does so through that spec's exporter. The asset core capture spike must satisfy this **viewer needs list**, or record the gap as `unreadable`: for materials, every input pin by name (connected or not) with a type, node size or enough to derive one, comment boxes with size and text, reroutes, and the output pins' names. Build order inside this plan: the texture viewer and the frame can start as soon as the spike has fixed the texture export; the material viewer starts after the spike has fixed the material export; the mesh viewer starts after it. [my call]
12. **Mesh phase is gated on the spike.** If the engine's glTF exporter is not available by default, there is no GLB: the mesh phase is skipped, three.js is not added to `package.json` or CI, and skeletal meshes get a properties-only view (hierarchy, LODs, slots, counts). The gate is a go/no-go check at the end of the spike, not a mid-build surprise. [my call]
13. **`AssetStore` surface the viewers need** (the asset core plan implements it): `peek(uri)` (synchronous cache lookup, no engine), `get(uri, { force })`, `getMany(uris)` (one batched run), and state events (queued, exporting, ready, failed) per asset. [my call]

## Pure modules (unit-tested with `node --test`)

- Render model builder: export → `{ nodes, pins, links, bounds }`, including missing-link and `unreadable` handling.
- Graph geometry: link path, fit-to-view transform, zoom-about-point, hit testing.
- Pin colour and node family mapping (data table).
- Texture channel masking (given pixel arrays).
- Material instance parameter resolution (override versus inherited).

## Testing

- **Unit:** the modules above, against the structure-only, name-scrubbed export fixtures from the asset core spike (the repo is public; images in tests are synthetic).
- **Integration (`/verify-local null-unreal`):** in a real build, open one asset of each kind from `MyGame` and assert the editor opens, the right page loads, the state reaches *ready*, and a cached second open does not start the engine. The visual result (node placement, link routing, texture channels, mesh orbit) needs a human look and is a short manual checklist in the plan, not an automated assertion.

## Done means (acceptance for all three specs) [decided]

Checked by the developer in a few minutes against their own test project (12 assets):

1. All 12 assets open in the viewer with the correct kind.
2. The material graph shows the same node count (221) and the same connections as the Unreal editor, compared side by side.
3. Textures match the editor's preview.
4. The mesh orbits, with the skeleton overlay (or, if the mesh phase was gated out, the properties-only view shows correct counts).
5. A second open of any asset does not start the engine.

## Open items for the builder

- Pin type colours and node family colours: pick a table and keep it data-only.
- How the GLB's skin joints map to the export's bone hierarchy for the skeleton overlay.
- Graph performance threshold: measure on the largest material in `MyGame`, and note where SVG stops being comfortable.
- Keyboard and screen-reader basics: labelled toolbar buttons, a focusable inspector, and a text alternative (the properties list) for the graph.
- Texture formats the engine's PNG export cannot represent (and what the viewer says for them).
- How a viewer reaches a referenced asset's file from a package path (the reverse of the asset core's path mapping).

## Follow-ups

- Blueprint graph viewer on the same renderer, once the Blueprint export spike exists.
- "What uses this asset?" (referencers computed live from the asset registry) and asset diffing in git, both enabled by the JSON exports.
