# Product Opportunities

## Foundation

### Language support parity (C++ done; Rust, Java, Python)
Status: issues exist — #91 (Rust debug synthesis; rust-analyzer already recommended
and checked), #134 (Java), #142 (Python, filed 2026-10-23).
Why: null-env's manifest table covers rust/cpp/node/dotnet only; Pylance is
MS-licensed and unusable in VSCodium.

### Import settings/keybindings/snippets/extensions from VS Code / Cursor
Status: issue exists (#90). Cross-device sync shipped as null-sync, but migration
from another editor is still missing.

### Package managers / updater
Status: winget #13 open; scoop/choco closed not planned. Updater #120 closed
(completed); #12 closed not planned. Extension updater: #135 (empty body).
Linux build shipped (#119).

## Core IDE

### Project metadata as source of truth
Status: issue exists (#39)

### Markdown Editor follow-ups
Status: #114 umbrella, #138 paste images, #139 outline/breadcrumbs, #140 copy button.

## Developer Workflow

### Pull requests / Actions
Status: shipped (#92, #117, #132): list, review, merge, checks, Actions view,
logs, dispatch. GitLab merge requests/issues: issue #143 (pull-requests-design Phase 6).

### Rust run/debug parity
Status: #91 (remaining: CodeLLDB debug config synthesis)

### Git
Status: graph #87 and pull flows shipped. Open: hunk staging #7, secret scan #34.

### Dev server
Status: #33 auto-open browser.

## Advanced

### Editor-first Claude Code integration
Status: shipped (#98 #99 #100 #111). Don't propose a native agent UI or panel.

### Compiler Explorer (#86), Windows widgets (#141, implementation landed)

## Polish
Issues panel extras (#54 #56 #59); large files / low memory (#22 #30).

## Shipped since 2026-10-11 (not roadmap anymore)
Linux x64 build (#119), PR view + review (#92/#117), GitHub Actions view (#132),
Workspace hub (#133), installer/first-run redesign (#130), null-env (#89),
null-startup profiler (#19), safe mode + crash recovery (#17/#18), null-sync
(#23), remote WSL/SSH (#85, unverified in CI build), commit graph (#87),
activity multi-machine (#131), action-button run state (#81), build output to
Problems (#95), trust hardening (#97), wiki (#122), desktop widgets host (#141).

## Not doing (maintainer closed as not planned; don't re-file)
Test Explorer for non-C++ (#93), CTest (#82), project templates (#94), CI status
for branch (#96), dirty/stash dashboard flags (#83), wiki-link diagnostics (#36),
terminal process panel (#37), extension perf/memory monitors (#20 #21),
scoop/choco (#14 #15), commit templates (#6), multi-root git summary (#8).
