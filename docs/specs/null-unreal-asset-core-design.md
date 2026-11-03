# Null Unreal — Asset Core Design
nIssue: [#150 Unreal asset core](https://github.com/TorresVisual/null-ide/issues/150)

Second of three specs for Unreal Engine support in Null IDE. Builds on [null-unreal-tooling-design.md](null-unreal-tooling-design.md) (engine and project resolution, the `null-unreal` CLI, logs, timeouts, exit codes). The third spec, the asset viewers, consumes what this one produces.

**Sequencing:** the tooling spec is implemented first. This plan assumes the `null-unreal` extension, its CLI and the shared pieces (engine and project resolution, command-line builder, logs, timeouts, exit codes) already exist, and adds only the `export` command, the exporter script and the asset store.

## Goal

Turn an Unreal asset (`.uasset`) into structured, cached data that the IDE and coding agents can read without Unreal's editor UI. Null IDE's asset viewers (spec 3) draw from it, and `null-unreal export` prints it for an agent, so an agent can inspect a material graph or a texture's settings as text.

The engine does the reading: an Unreal commandlet loads the asset and a script ships its data out as JSON. The result matches what the editor shows and survives engine upgrades, at the cost of a few seconds' wait on first open.

## Today

Nothing in Null IDE reads assets. What was measured on this machine (UE 5.8, `MyGame`):

- A commandlet run (`UnrealEditor-Cmd … -run=PythonScript -Script=<file.py> -nullrhi -unattended -stdout -NoSplash`) that loads an asset and exits takes about **6.2 s** wall time, exit code 0. About 10 s on a first (cold) boot to "assets loaded".
- It runs fine **while the editor has the same project open**: no project, log or asset-registry lock conflicts.
- The Python route reached real data: `unreal.load_asset('/Game/Materials/M_Example')` gave a `Material` with 221 expressions via `MaterialEditingLibrary`.
- `-ExecCmds="Quit"` does not exit in editor mode (only with `-game`); commandlets exit by themselves.
- `unreal.log` is filtered from stdout at default verbosity; `unreal.log_warning` shows. Stdout is therefore not a reliable data channel.
- `MyGame/Content` holds 12 assets: 1 material, 1 material instance, 8 textures, 2 skeletal-mesh assets (mesh and skeleton). No Blueprints, no maps.

## Scope

**Kinds covered first:** material, material instance, texture, skeletal mesh (and its skeleton). Any other asset class gets the **generic** export (class, package path, properties as far as reachable, and dependencies from the asset registry), so an unknown asset still yields something instead of an error.

**Non-goals**

- **Blueprints and maps** are deferred until a project has some. They need their own spike: Python exposes only editor-visible properties, and Blueprint graphs (`UbergraphPages`, the nodes) probably are not. Fallbacks to try then: the engine's text export (`AssetExportTask`) or a small C++ commandlet. Generic export applies until then.
- Parsing the `.uasset` bytes ourselves (community parsers such as UAssetAPI and CUE4Parse lag new engine versions; the Blueprint graph model would have to be rebuilt). It can be added later as an instant preview for machines without Unreal.
- Editing or writing assets. Live sync with the open editor, including querying a running editor through Unreal's Python remote execution (a deliberate non-goal; see the tooling spec). [decided] Cooked or packaged content (the editor cannot load it). Engine and marketplace content. Linux (follows the tooling spec). Asset diffing in git (a nice consequence of JSON exports, not built here).

**Anti-goals**

- **Silent partial data.** A property the script cannot read is recorded as `{"unreadable": "<reason>"}`, never omitted.
- **Stale data shown as current.** The cache key (below) must change whenever the source file or engine version does. Data always reflects the **saved** file, never unsaved editor state, and the UI says so.
- **A hung export.** Every run has a timeout that kills the process tree.

## Decisions

1. **Engine route.** A commandlet runs one exporter script, `engine/export_asset.py`, shipped inside the extension. Considered and set aside: byte-level parsing (B) and engine plus bytes (C). C stays open for later.
2. **Part of the `null-unreal` extension and CLI**, no new extension. The CLI gains `export`: `null-unreal export <asset-or-folder>… [--json] [--force]`. It reuses engine and project resolution, the command-line builder, logging, timeouts and exit codes from the tooling spec. Only the CLI starts the engine.
3. **Files, not stdout, carry data.** The CLI writes a request file (`Saved/NullUnreal/export-request-<pid>.json`, unique per run: asset package paths, output directory) and passes its path to the script through an environment variable. The script writes one JSON result per asset plus a manifest with per-asset status. Stdout and the log are for diagnosis only.
4. **Batching.** One engine run exports a list of assets, because the 6 s is nearly all boot. While a run is in progress, new requests queue and go out together in the next run (one run at a time). A folder export is one run. [my call]
5. **Cache.** `Saved/NullUnreal/assets/<package path>.json`, plus sidecar files beside it. The header carries `{ schema, engineVersion, sourceMtime, sourceSize }`; the entry is valid only if all four match the current file and tool. Corrupt or unparseable entries are treated as misses. Exports are self-contained: references to other assets are stored as package paths, never inlined, so a change elsewhere never invalidates this entry. [my call]
   **Previews are full resolution with no size cap**, so the texture viewer's 1:1 zoom is true to the pixels. Nothing is evicted automatically; `Null: Clear Unreal Asset Cache` deletes `Saved/NullUnreal/assets` (`Saved/` is disposable and gitignored in standard projects). [decided]
6. **Path mapping.** A file maps to a package path through the project's `Content/` (`/Game/…`) and each plugin's `Content/` (`/<Plugin>/…`). A `.uasset` outside any mounted content root is an explicit error. Engine version comes from the resolved engine's `Build/Build.version`.
7. **Requirements are checked, not assumed.** The export needs the editor binary, the Python plugin enabled for the project, uncooked assets, and **the project's editor modules compiled** (a fresh checkout with stale or missing binaries makes `UnrealEditor-Cmd` fail before the script runs). The CLI does not build for the user: when no manifest appears and the log shows the module-load failure, it exits 2 with "build the project first (`null-unreal build`)". [my call] Each missing requirement gives its own actionable error (exit code 2 from the tooling spec's table).
   **Python plugin:** the probe worked on `MyGame` because that project's `.uproject` enables `PythonScriptPlugin` explicitly; whether it is on by default elsewhere is unverified. When it is off, `export` fails with exit code 2 and shows the exact `.uproject` entry to add. The CLI never edits the `.uproject` and never passes plugin-enabling flags on its own. [decided]

8. **Dependencies yes, referencers no.** `references.dependencies` comes from the asset's own file, so the cache key covers it. Referencers change when any other asset changes and would break the cache rule, so v1 omits them. A "what uses this?" view would compute them live from the asset registry in its own spec. [my call]
9. **Batch semantics.** Exit code: 0 if every asset exported or hit the cache; 1 if any asset failed (the manifest has per-asset status and error); the tooling spec's 2 and 124 otherwise. If the engine crashes or hangs mid-batch, assets already written stay cached, the crashing or hung one and every later one are reported `not exported`, and there is no automatic retry (the next request exports them). Large requests are split into runs of at most 50 assets; the timeout is 120 s plus 2 s per asset in the run. [my call]
10. **One engine run per project at a time, across processes.** The CLI takes a per-project lock file (`Saved/NullUnreal/export.lock`, holding the PID and start time); a second export waits for it, and a lock whose PID is dead is taken over. The extension keeps a small in-process queue that coalesces requests into one CLI call; the lock is what protects against an agent's CLI call overlapping it. [my call]

## Export format

One JSON file per asset:

```
{
  "schema": 1,
  "engineVersion": "5.8.x",
  "package": "/Game/Materials/M_Example",
  "kind": "material | material-instance | texture | skeletal-mesh | generic",
  "class": "Material",
  "references": { "dependencies": ["/Game/…"] },
  "data": { …kind-specific… },
  "sidecars": { "preview": "M_Example.png" }
}
```

`data` per kind (the contract the viewers build on; fields beyond this are the builder's to add):

- **material:** `expressions[]` (index, class, editor position x/y, own properties, inputs as `{ from: <expression index>, output: <name> }`), `outputs{}` (BaseColor, Normal, … → the expression that feeds each), parameters (name, type, default, group), shading model and blend mode, used textures as package paths.
- **material-instance:** parent package path, scalar / vector / texture parameter overrides, static switches.
- **texture:** width, height, format, compression, sRGB, mip count, LOD group, plus a **PNG preview** sidecar. Only the engine can decode its compressed formats, which is why the preview comes from here.
- **skeletal-mesh:** skeleton path, bone hierarchy, LOD count with vertex and triangle counts, material slots, morph targets, plus a **GLB** sidecar if the engine's glTF exporter is available.
- **generic:** `class`, `outer`, and every property the script can read as a tree, plus the raw text export if the text exporter handles the class.

What the Python API can actually reach is not fully known. The first build phase is a **capture spike**: for each kind, run the exporter against the real `MyGame` assets, record what is reachable, and fix the schema to what exists. Gaps become `unreadable` entries or a documented limit, not guesses. If the Python route cannot reach enough of a material (pin types, node sizes, comment boxes), the fallback order is (a) a degraded but honest graph (uncoloured pins, default node size, missing data marked `unreadable`), then (b) parse the engine's text export of the material; never a C++ commandlet or plugin added to the user's game project. [decided] PNG and GLB export availability is part of this spike. [my call to include sidecars; drop the mesh GLB if the glTF exporter is not available by default]

## Surfaces

- **CLI:** `null-unreal export <asset-or-folder>…` prints, per asset, the package path, kind, cache status (hit, exported, failed), and a one-line summary (for example `Material, 221 expressions`). `--json` prints the export JSON itself to stdout for agents. `--force` ignores the cache. Failed assets show the error from the manifest, and the log path is printed as in the tooling spec.
- **Extension:** an internal `AssetStore` (cache first, otherwise queue an export) that the viewers in spec 3 call. Its surface is `peek(uri)` (synchronous cache lookup), `get(uri, { force })`, `getMany(uris)` (one batched run) and per-asset state events; see Decision 13 of the viewers spec. The spike must also meet the viewers' needs list (Decision 11 there). A command `Null Unreal: Export Asset` exports the active `.uasset` or a chosen folder. While an export runs, a progress notification says why it is waiting. Because the extension is workspace-side, it works in a remote window; the engine must be on the machine that hosts the workspace.
- **Settings:** none new. Engine path and per-command extra args come from the tooling spec.

## Testing

- **Unit (`node --test`):** package-path mapping (project, plugin, unmounted); cache validity (hit, mtime change, size change, engine version change, corrupt file); request and manifest parsing; schema validation of export files; queue coalescing with an injected runner. Fixtures: small export JSON files captured from a real project during the spike and checked in. The repo is public: fixtures keep structure only (node graphs, property values), are scrubbed of project and asset names, and never include real PNG or GLB files from a game; images and meshes in tests are synthetic. [decided]
- **Integration (`/verify-local null-unreal`):** against `MyGame` in a real build, export one asset of each covered kind and compare the key fields (for example the material's expression count) with the fixtures; a second export is a cache hit; touching the file makes it a miss.
- The exporter script itself needs the engine to run, so it is covered by the integration test and the capture spike, not by unit tests.

## Open items for the builder

- How to pass arguments to a `PythonScript` commandlet reliably (script path with spaces, environment variable versus arguments).
- Per kind, what the Python API reaches and how (`MaterialEditingLibrary`, asset registry, texture and mesh libraries); whether `AssetExportTask` produces the PNG and GLB sidecars.
- Cold-start cost on a large project (more than the 12 assets measured) and whether a resident commandlet is worth it later. It is not needed for v1.
- Behaviour when the editor is mid-save on the same asset, and when the file is under source control and read-only.
- Memory and CPU cost of a second engine instance beside an open editor (the measured editor used about 4.8 GB).

## Follow-ups

- **Viewer spec (spec 3):** webview custom editors for `.uasset` registered by `null-unreal`: a node-graph renderer for materials, an image viewer for textures, a three.js viewer for meshes. They read this spec's exports and sidecars.
- **Blueprint and map support**, once a project has them, starting with the spike described under Non-goals.
