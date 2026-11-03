# Null Unreal Asset Viewers Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Open a `.uasset` in Null IDE and see a texture, a material node graph or a skeletal mesh, read-only, from the `AssetStore` exports.

**Architecture:** One `CustomReadonlyEditorProvider` in `null-unreal` picks a webview page by export `kind`. Pages are TypeScript bundled by esbuild into `lib/*.js` (the `null-markdown` pattern); all logic that can be tested lives in `src/viewer/*.ts`, imports neither `vscode` nor the DOM, and is imported by both the host build (`tsc` → `out/`) and the webview bundles.

**Tech Stack:** TypeScript, esbuild (dev dependency), hand-rolled SVG for the graph, three.js (dev dependency, bundled, mesh page only), `node --test`.

**Spec:** `docs/specs/null-unreal-viewers-design.md` (data shapes: `docs/specs/null-unreal-asset-core-design.md`, "Spike results"). Issue #151.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- View type `null-unreal.assetViewer`, selector `*.uasset` and `*.umap`, priority `default`; read-only; no new extension.
- Host chooses the page by `kind`; webviews never read files. Images, GLBs and JSON arrive through `asWebviewUri`; `localResourceRoots` is only `<project>/Saved/NullUnreal/assets` plus the extension's `lib/`. Strict CSP with a nonce, no `unsafe-inline` for scripts.
- Anything `{unreadable: reason}`, any link whose target is missing, and any tone-mapped preview is shown as such, never dropped or defaulted.
- Opening an asset never starts an engine run for any asset other than itself; a file change on disk only shows "file changed — click to update".
- Colours come from VS Code theme CSS variables; pin and node-family colours are data tables.
- `out/` is tracked (`chore: refresh null-unreal compiled output`); new `*.test.js` files go in `package.json`'s `test` list or they are skipped silently.
- `lib/` follows `null-markdown`: **gitignored**, built by `npm run build` in CI and locally (the spec says "committed"; the repo's actual convention for esbuild bundles is gitignored, and this plan follows the repo).
- Windows only, experimental, not in the REH list.

## Review Focus

- Material with a link to an expression index that is out of range or `{from: {unreadable}}` → dashed stub link plus a count in the notes, no crash, node count unchanged.
- Material whose `outputs` entry is `null` (unconnected property) → no link, no pin error.
- Export whose `references`/`data` shape is current-schema but a field is `{unreadable}` where a number is expected (texture `format`, `mipCount`, mesh `triangles`) → rendered as "not available: <reason>", never `NaN` or `undefined`.
- Skeleton or mesh `bones` with `parent: {unreadable}` or a parent name not in the list → flat list / root, no infinite loop.
- Opening a `.uasset` in a folder with no `.uproject` or no engine → *failed* state with the error and *Reopen as text*, no thrown exception in the host.
- Material instance whose parent chain is only partly cached → own overrides shown, "parent not cached" note, no engine run.

---

## File Structure

```
extensions/null-unreal/
  src/viewer/            pure, tested (imported by host and webviews)
    page.ts              pageFor(kind), buildHtml()
    messages.ts          host<->webview message types
    refs.ts              packageToFile, sidecarFile, thumbnailMap
    value.ts             describe(): unreadable-aware value text
    geometry.ts          fit/zoom transforms, link path, hit test
    channels.ts          texture channel masking, HDR check
    instance.ts          material-instance parameter resolution
    tree.ts              bone tree
    colors.ts            pin type + node family tables
    renderModel.ts       material export -> {nodes, pins, links, bounds, notes}
  src/viewerProvider.ts  vscode side: provider, watcher, message handling (imports vscode)
  webview/               one entry per page + shared frame; tsconfig.json (DOM lib, noEmit)
    frame.ts texture.ts material.ts mesh.ts properties.ts viewer.css
  fixtures/              hand-written, scrubbed export JSON per kind
  lib/                   esbuild output (gitignored)
```

---

### Task 1: Pure foundation (page, messages, refs, value text)

**Files:**
- Create: `src/viewer/page.ts`, `src/viewer/messages.ts`, `src/viewer/refs.ts`, `src/viewer/value.ts`
- Test: `src/viewer/page.test.ts`, `src/viewer/refs.test.ts`, `src/viewer/value.test.ts`
- Create: `fixtures/{texture,material,material-instance,skeletal-mesh,skeleton,generic}.json` — hand-written to the spike's shapes (names scrubbed, synthetic values; the material has ≥ 6 expressions including one parameter, one texture sample, one reroute, one link with `{from: {unreadable}}`, one unconnected `outputs` entry)
- Modify: `package.json` (`test` list)

**Interfaces:**
- Produces:
  - `type Page = 'texture' | 'material' | 'mesh' | 'properties'`; `pageFor(kind: Kind): Page` (`texture`→texture, `material`→material, `skeletal-mesh`→mesh, everything else → properties).
  - `buildHtml(o: { page: Page; nonce: string; cspSource: string; scriptUri: string; styleUri: string; title: string }): string` — CSP: `default-src 'none'; img-src ${cspSource} data: blob:; connect-src ${cspSource}; style-src ${cspSource}; script-src 'nonce-${nonce}'`.
  - messages: `ToWebview = {type:'exporting'} | {type:'failed'; error:string; hint?:string} | {type:'stale'} | {type:'ready'; name:string; kind:Kind; data:Record<string,unknown>; sidecars:Record<string,string|{unreadable:string}>; extra?:unknown} | {type:'thumbs'; byPackage:Record<string,string|null>}`; `FromWebview = {type:'ready'} | {type:'reexport'} | {type:'update'} | {type:'reopenText'} | {type:'openLog'} | {type:'exportReferenced'} | {type:'openAsset'; package:string}`.
  - `packageToFile(pkg: string, mounts: Mount[]): string | undefined` (inverse of `toPackagePath`, `Mount` from `packagePath.ts`); `sidecarFile(assets: string, doc: ExportDoc, key: string): string | undefined` (absolute path beside the entry JSON, `undefined` when the sidecar is missing or unreadable); `thumbnailMap(packages: string[], pngFor: (pkg: string) => string | undefined): Record<string, string | null>`.
  - `describe(v: unknown): string` — number/string as text, `{unreadable: r}` → `not available: ${r}`, `null`/`undefined` → `—`, arrays → `n items`.

- [ ] **Step 1: Write failing tests.** `page.test.ts`: `pageFor` for all six kinds; `buildHtml` output contains `script-src 'nonce-abc'`, a `<script nonce="abc" src=…>` tag, and does not contain `unsafe-inline` in `script-src`. `refs.test.ts`: `packageToFile('/Game/A/B', mounts)` equals the file `toPackagePath` maps back to `/Game/A/B` (round trip, including a plugin mount `/MyPlugin/X`); unmounted package → `undefined`; `sidecarFile` returns `<assets>\Game\A\T.png` for `{preview:'T.png'}`, `undefined` for `{preview:{unreadable:'x'}}`; `thumbnailMap(['/Game/T','/Game/U'], p => p==='/Game/T' ? 'a.png' : undefined)` equals `{'/Game/T':'a.png','/Game/U':null}`. `value.test.ts`: `describe({unreadable:'no mip count'})` is `not available: no mip count`; `describe(undefined)` is `—`; `describe(1024)` is `1024`.
- [ ] **Step 2: Run** `npm test` in `extensions/null-unreal` → FAIL (modules missing).
- [ ] **Step 3: Implement the four modules** with the signatures above; add the three test files to the `test` script list.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(null-unreal): viewer page, message and ref helpers (#151)`.

---

### Task 2: The frame and a properties page (every asset opens)

**Files:**
- Create: `src/viewerProvider.ts`, `webview/frame.ts`, `webview/properties.ts`, `webview/viewer.css`, `webview/tsconfig.json`
- Modify: `package.json` (customEditors contribution; `esbuild` devDependency; script `build`: one `esbuild webview/{texture,material,mesh,properties}.ts --bundle --minify --format=iife --target=es2020 --outdir=lib` call limited to entries that exist; script `typecheck:webview`: `tsc -p webview/tsconfig.json --noEmit`; `compile` runs it too), `src/extension.ts` (register provider with the `AssetStore` returned by `registerAssets`), `.gitignore` (`extensions/null-unreal/lib/`)
- Modify: `scripts/sync-local.ps1` (add `"lib"` to null-unreal `Copy`, and run `npm run build` first)

**Interfaces:**
- Consumes: `AssetStore.get/peek/onState`, `resolver` from `assets.ts` (export it as `resolveProjectAndEngine(context)` returning `() => {project, engine}`), `assetsDir`, `findMounts`, `pageFor`, `buildHtml`, `ToWebview`, `FromWebview`.
- Produces: `registerViewer(context: vscode.ExtensionContext, store: AssetStore, resolve: () => {project: Uproject; engine: Engine}): void`; webview `frame.ts` exports `mountFrame(onMessage: (m: ToWebview) => void): { send(m: FromWebview): void; body: HTMLElement; inspector: HTMLElement }` — header strip (name, kind, "saved file" badge, labelled ↻ button), the exporting / failed (with *Reopen as text*, *Open log*) / stale ("file changed — click to update") states, a slide-over `inspector` that opens on `showInspector()` and closes on `hideInspector()`.

- [ ] **Step 1: Write the host flow** in `viewerProvider.ts`: `openCustomDocument` returns `{uri, dispose}`; `resolveCustomEditor` sets `localResourceRoots`, sets `html` via `buildHtml`, waits for the webview's `ready`, posts `exporting` if `store.peek` misses, then `store.get(file)`; posts `ready` (sidecar values rewritten to `asWebviewUri` strings via `sidecarFile`) or `failed` with the error. `resolve()` throwing → `failed` with its message. `reexport` → `store.get(file,{force:true})`; `update` → re-run the open flow; `reopenText` → `vscode.openWith(uri,'default')`; `openLog` → open `Saved/NullUnreal/logs` newest `export` log (reuse `logs.ts`). A `FileSystemWatcher` on the single file posts `stale` and never calls the store.
- [ ] **Step 2: Write `frame.ts` and `properties.ts`.** `properties.ts` renders `data` as a collapsible tree using `describe()` for leaves (this is the generic, material-instance, skeleton and — until Task 7 — skeletal-mesh view).
- [ ] **Step 3: Run** `npm run compile && npm run build && npm test` → no type errors, existing tests PASS.
- [ ] **Step 4: Verify in a real build** with `/verify-local null-unreal`: open one `.uasset` of each kind from a real project; each reaches *ready* with the right kind in the header; a second open shows no `> null-unreal export` line in the Null Unreal output channel; an asset outside any content root shows *failed* + *Reopen as text*.
- [ ] **Step 5: Extend the integration spec** (`src/test/suite/`): `vscode.commands.executeCommand('vscode.openWith', <fixture .uasset in a workspace without a .uproject>, 'null-unreal.assetViewer')` opens a tab whose input `viewType` is `null-unreal.assetViewer` and does not throw.
- [ ] **Step 6: Commit** `feat(null-unreal): read-only asset viewer frame and properties page (#151)`, then `chore: refresh null-unreal compiled output`.

---

### Task 3: Texture viewer

**Files:**
- Create: `src/viewer/geometry.ts` (zoom/pan part), `src/viewer/channels.ts`, `webview/texture.ts`
- Test: `src/viewer/geometry.test.ts`, `src/viewer/channels.test.ts`
- Modify: `package.json` (`test` list)

**Interfaces:**
- Produces: `type View = { scale: number; x: number; y: number }`; `fitView(content: {w:number;h:number}, viewport: {w:number;h:number}, pad: number): View`; `zoomAbout(v: View, p: {x:number;y:number}, factor: number, limits?: {min:number;max:number}): View` (the point under the cursor stays fixed; default limits 0.05–32); `type Mask = {r:boolean;g:boolean;b:boolean;a:boolean}`; `applyMask(rgba: Uint8ClampedArray, m: Mask): Uint8ClampedArray` (off channel → 0; alpha off → 255; when only `a` is on, RGB = alpha, alpha 255); `isToneMapped(data: {compression?: unknown}): boolean` (compression name matches `/HDR|FLOAT/i`).

- [ ] **Step 1: Write failing tests.** `fitView({w:100,h:50},{w:200,h:200},0)` → scale 2, content centred (`x:0,y:50`). `zoomAbout` with factor 2 about `{x:10,y:10}` keeps `(10 - v.x)/v.scale` constant before and after. `zoomAbout` clamps at `limits.max`. `applyMask([10,20,30,40], {r:true,g:false,b:true,a:true})` → `[10,0,30,40]`; `a:false` → alpha 255; only-alpha → `[40,40,40,255]`. `isToneMapped({compression:'HDR'})` true, `{compression:'DEFAULT'}` false, `{compression:{unreadable:'x'}}` false.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement** `geometry.ts` (zoom part) and `channels.ts`.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Implement `webview/texture.ts`:** draw the `preview` PNG to a `<canvas>`; read pixels once into an `ImageData`, redraw on mask change; checkerboard CSS background behind it; wheel zoom via `zoomAbout`, drag pan, *Fit* and *1:1* buttons; R/G/B/A toggle buttons (labelled, `aria-pressed`); inspector rows from `data` through `describe()` (size, built size, compression, sRGB, LOD group, mip gen, format and mip count as "not available: …"); if `isToneMapped` show a persistent "HDR/float texture — tone-mapped preview" note; if `sidecars.preview` is `{unreadable}` show it instead of the canvas.
- [ ] **Step 6: Manual check** (build + `/verify-local null-unreal`): the texture matches the Unreal editor's preview; channel toggles behave; a second open does not start the engine.
- [ ] **Step 7: Commit** `feat(null-unreal): texture viewer (#151)`.

---

### Task 4: Material instance and skeleton views

**Files:**
- Create: `src/viewer/instance.ts`, `src/viewer/tree.ts`
- Test: `src/viewer/instance.test.ts`, `src/viewer/tree.test.ts`
- Modify: `webview/properties.ts`, `src/viewerProvider.ts` (add `extra` for instances), `package.json` (`test` list)

**Interfaces:**
- Produces: `type ParamRow = { name: string; type: 'scalar'|'vector'|'texture'|'switch'; value: unknown; source: 'override'|'inherited'|'unknown' }`; `resolveParams(own: ExportDoc, chain: ExportDoc[]): { rows: ParamRow[]; complete: boolean }` — `chain` is the parents nearest-first as far as cached; rows are the instance's own overrides (`source:'override'`) plus every parameter of the root material not overridden (`inherited`, value from the nearest ancestor that overrides it, else the material default); if the chain ends at an instance (parent not cached) `complete` is false and only overrides are returned. `type BoneNode = { name: string; children: BoneNode[] }`; `boneTree(bones: {name: string; parent: unknown}[]): BoneNode[]` (parent that is `null`, `{unreadable}` or not in the list → root).
- Host: for a `material-instance` ready doc, walk `data.parent` through `packageToFile` + `store.peek` (never `get`) to build `chain`, send as `extra: { chain }`; texture overrides' thumbnails via `thumbnailMap`.

- [ ] **Step 1: Write failing tests.** `resolveParams`: instance overrides scalar `Roughness`, parent material has `Roughness` (default 0.5) and `Tint` (default blue) → rows `[Roughness override, Tint inherited blue]`; grandparent instance overriding `Tint` → `Tint` inherited with that value; chain ending in an uncached parent → `complete:false`, overrides only. `boneTree`: orphan parent name → extra root; all `parent:{unreadable}` → flat list; a cyclic input (`a→b→a`) terminates (break the cycle by making the second visited node a root).
- [ ] **Step 2: Run** `npm test` → FAIL. **Step 3: Implement** both modules. **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Extend `properties.ts`:** instance view = parent link (click → `openAsset`), parameter table with an *override/inherited* column and texture thumbnails, "parent not cached" note when `!complete`; skeleton view = bone tree built with `boneTree` (collapsible).
- [ ] **Step 6: Commit** `feat(null-unreal): material instance and skeleton views (#151)`.

---

### Task 5: Material graph render model and geometry

**Files:**
- Create: `src/viewer/colors.ts`, `src/viewer/renderModel.ts`; extend `src/viewer/geometry.ts`
- Test: `src/viewer/renderModel.test.ts`, extend `src/viewer/geometry.test.ts`, `src/viewer/colors.test.ts`
- Modify: `package.json` (`test` list)

**Interfaces:**
- Produces (all pure):
  - `colors.ts`: `pinColor(typeMask: number | null): string` (CSS colour; unknown/`null` → neutral grey), `nodeFamily(cls: string): 'parameter'|'texture'|'math'|'constant'|'utility'|'function'|'other'`, `familyColor(f): string`. Tables are data (`const PIN_COLORS`, `FAMILY_PATTERNS`), type bits from the engine's `EMaterialValueType` (verify the bit values against `MaterialValueType.h` of the engine in use when filling the table).
  - `renderModel.ts`: `type RNode = { id: number; label: string; family: string; shape: 'node'|'reroute'|'result'; x: number; y: number; w: number; h: number; inputs: RPin[]; outputs: RPin[]; props: Record<string, unknown> }`; `type RPin = { name: string; type: number | null; x: number; y: number; side: 'in'|'out' }`; `type RLink = { from: {node:number; pin:string}; to: {node:number; pin:string}; missing: boolean }`; `buildRenderModel(data: Record<string, unknown>): { nodes: RNode[]; links: RLink[]; bounds: {x:number;y:number;w:number;h:number}; notes: string[]; expressionCount: number }`. Node size derived from pin counts (width 180, height 32 + 20 × max(inputs, outputs)); the synthetic `result` node (id `-1`, label "Material") sits right of the right-most expression and has one input pin per entry of `data.outputs`; a link whose `from` is not a valid expression index becomes `missing: true` with the note `"<n> link(s) to unreadable expressions"`; a `null` `outputs` entry creates no link; `data.commentBoxes` being `{unreadable}` adds the note `"comment boxes are not available in this export"`; class `MaterialExpressionReroute` → `shape: 'reroute'`.
  - `geometry.ts` additions: `linkPath(a: {x:number;y:number}, b: {x:number;y:number}): string` (SVG `M … C …` cubic with horizontal control points `max(40, |dx|/2)`), `hitNode(nodes: Pick<RNode,'id'|'x'|'y'|'w'|'h'>[], p: {x:number;y:number}): number | undefined` (topmost = last drawn).

- [ ] **Step 1: Write the pin-colour and family tables — your call.** `colors.ts` is created with the function signatures and the two tables empty; **the developer fills `PIN_COLORS` and `FAMILY_PATTERNS`** (about 10 lines each; it is the one taste decision in this plan: which hues separate scalar, vector, texture, bool and attribute pins, and which class-name patterns map to which family). The test only requires that every family returns a non-empty colour, that two different pin kinds (float vs texture) differ, and that `pinColor(null)` is the neutral grey.
- [ ] **Step 2: Write failing tests** against `fixtures/material.json`: `expressionCount` equals `data.expressions.length`; `nodes.length` is `expressionCount + 1`; link count equals the number of `inputs[].link` with a numeric `from` plus the non-null `outputs` entries; the `{unreadable}` link produces exactly one `missing` link and the note; a node with 3 inputs/1 output has `h = 32 + 20*3`; reroute has `shape:'reroute'`; `bounds` contains every node. Geometry: `linkPath({x:0,y:0},{x:100,y:50})` starts with `M 0 0 C`; `hitNode` returns the later node for overlapping rectangles and `undefined` outside.
- [ ] **Step 3: Run** `npm test` → FAIL. **Step 4: Implement** `renderModel.ts` and geometry additions. **Step 5: Run** `npm test` → PASS.
- [ ] **Step 6: Commit** `feat(null-unreal): material render model and graph geometry (#151)`.

---

### Task 6: Material graph page and lazy referenced textures

**Files:**
- Create: `webview/material.ts`
- Modify: `src/viewerProvider.ts`, `webview/frame.ts` (only if the inspector needs a hook), `webview/viewer.css`

**Interfaces:**
- Consumes: `buildRenderModel`, `fitView`, `zoomAbout`, `linkPath`, `hitNode`, `pinColor`, `familyColor`, `thumbnailMap`, `packageToFile`.
- Host behaviour: on a ready material, `thumbs` is posted from `thumbnailMap(data.usedTextures, pkg => sidecarFile(assets, store.peek(file)…, 'preview'))` — `peek` only. `exportReferenced` → `store.getMany(<uncached used-texture files>)` (one batched run), then re-post `thumbs`. `openAsset {package}` → `vscode.openWith(packageToFile(...), 'null-unreal.assetViewer')` (the viewer's normal open flow exports it on demand).

- [ ] **Step 1: Implement `material.ts`:** one `<svg>` with a `<g>` transformed by the `View`; nodes as `<g>` rect + title (family colour) + pin circles (`pinColor`) + labels; reroutes as small dots; links as `<path d=linkPath>` (missing ones dashed, `--vscode-errorForeground`); wheel zoom, drag pan, fit on open and a *Fit* button; click node → `hitNode` → inspector (class, position, `props` through the properties tree, inputs with their link source); click empty canvas hides the inspector. Texture-sample nodes show a thumbnail from `thumbs` or a placeholder; double-click one → `openAsset`. Inspector shows *Export referenced textures (n not cached)*. Notes from the model render as a dismissible banner. A *List view* toggle shows a `<table>` of nodes and their inputs (text alternative); toolbar buttons are labelled; the inspector is focusable.
- [ ] **Step 2: Run** `npm run compile && npm run build && npm test` → PASS.
- [ ] **Step 3: Manual check on the real project (`/verify-local null-unreal`):** the largest material shows the same node count and connections as the Unreal editor, side by side; opening a material starts no engine run (Null Unreal output has no `> null-unreal export` line); *Export referenced textures* produces exactly one run. Record the largest graph's node count and whether pan/zoom stays smooth in the plan's Notes below (the SVG ceiling).
- [ ] **Step 4: Commit** `feat(null-unreal): material graph viewer (#151)`.

---

### Task 7: Mesh viewer (gate: GO — the spike showed the glTF exporter works by default)

**Files:**
- Create: `webview/mesh.ts`
- Modify: `package.json` (`three` + `@types/three` devDependencies, `build` includes `mesh.ts`), `src/viewer/page.ts` only if CSP needs `worker-src blob:` (add a test line if changed), `webview/properties.ts` (mesh inspector sections), `.github/workflows/build.yml` and `scripts/build-local.ps1` (Task 8)

**Interfaces:**
- Consumes: ready doc of kind `skeletal-mesh` with `sidecars.model` (webview URI string) and `data.{bones,lods,materialSlots,morphTargets,bounds}`.
- Behaviour: `GLTFLoader` + `OrbitControls`, camera framed from the loaded scene's `Box3`; toggles *Wireframe* (set `wireframe` on every mesh material) and *Skeleton* (`SkeletonHelper` over the first `SkinnedMesh`; no mapping to the export's hierarchy is needed because the helper draws the GLB's own joints). If `sidecars.model` is `{unreadable}` or the load fails, fall back to the properties view with the reason as a banner. Inspector: LODs (vertices, sections, triangles via `describe` → "not available"), material slots, morph targets, bone count.

- [ ] **Step 1: Add dependencies** (`npm install -D three @types/three`), implement `mesh.ts`, add it to `build`.
- [ ] **Step 2: Run** `npm run compile && npm run build && npm test` → PASS; confirm `lib/mesh.js` is the only bundle containing three (`grep -L "OrbitControls" lib/{texture,material,properties}.js` lists the other three).
- [ ] **Step 3: Manual check:** a skeletal mesh orbits, wireframe and skeleton overlay toggle, counts match the Unreal editor; an asset with a failed GLB shows the properties view with the reason.
- [ ] **Step 4: Commit** `feat(null-unreal): skeletal mesh viewer (#151)`.

---

### Task 8: Build wiring, docs, acceptance

**Files:**
- Modify: `.github/workflows/build.yml` (after "Compile null-unreal TypeScript": run `npm run build`; in the Linux job nothing, null-unreal is Windows only), `scripts/build-local.ps1` (mirror), `extensions/null-unreal/CLAUDE.md` (viewer paragraph: pure modules in `src/viewer`, `lib/` gitignored and built, the pin-colour tables, message protocol in `messages.ts`), root `CLAUDE.md` (null-unreal entry + repository note), `docs/wiki/` (via `/wiki-sync`: asset viewer page — opening, "saved file", "file changed" banner, Export referenced textures)

- [ ] **Step 1:** make the CI/local-build edits; check `lib/` ends up in the packaged `vscode-src/extensions/null-unreal`.
- [ ] **Step 2: Run** `npm test` in `extensions/null-unreal` and `/verify-local null-unreal` → PASS.
- [ ] **Step 3: Acceptance with the developer against the 12-asset project** (spec "Done means"): all 12 open with the right kind; material node count 221 and connections match the editor; textures match; mesh orbits with the skeleton overlay; a second open of any asset starts no engine run.
- [ ] **Step 4: Commit** `build(null-unreal): bundle viewer pages in CI` and `docs(null-unreal): asset viewers`.

---

## Notes

- Comment boxes are not exported by the engine's Python API (spike), so the viewer cannot draw them; it says so in a banner. Revisit if the export gains them.
- Cube maps, volume textures and texture arrays export as `generic` (the exporter only maps `Texture2D` to `texture`), so they get the properties view, not a texture viewer.
