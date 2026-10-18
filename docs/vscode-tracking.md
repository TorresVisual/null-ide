# VS Code feature tracking

Null IDE builds on VSCodium, which trails VS Code by several releases. This list
catches VS Code features early so we can backport or adapt them now instead of
waiting for the VSCodium bump (#115).

**Last reviewed: 1.142** (backfilled 1.129–1.135, already in the 1.135 build, so those rows are ticked as reconciled)

The `upstream-check` workflow opens a *Review VS Code 1.x release notes* issue for
every stable release after the version above; `/vscode-watch` works through them
and moves the line forward.

## Statuses

| Status | Meaning |
|---|---|
| Backport | Core workbench change: cherry-pick the upstream commit as a temporary `patches/` file |
| Adapt | Build it into a Null extension/component, the Null way (also features shadowed by `null-markdown`, the dashboard, patch 007, ...) |
| Wait | Worth having, but fine to arrive with the VSCodium bump |
| N/A | Doesn't fit Null IDE |

Backport and Adapt rows get their own Null issue. When a VSCodium bump reaches a
row's version, reconcile it: drop the backport patch, or check the adaptation
against the real upstream feature, then tick **Reconciled**.

## Features

| Feature | VS Code | Status | Null issue | Reconciled |
|---|---:|---|---|---|
| Markdown editor: paste images from the clipboard | 1.142 | Adapt | #138 | |
| Markdown editor: Outline view and breadcrumbs integration | 1.142 | Adapt | #139 | |
| Markdown editor: hover copy button on code blocks | 1.142 | Adapt | #140 | |
| Markdown editor: Rename Symbol (F2) on file links; needs a rename round-trip from the webview to the language server | 1.142 | Wait | — | |
| Markdown editor: editing mode shows each source line on its own visual line; Null's caret-reveal markers are a deliberate difference | 1.142 | Wait | — | |
| `editor.occurrencesHighlightFromAllProviders`: merge document highlights from all providers instead of only the top-priority one | 1.142 | Wait | — | |
| N/A: Copilot harness as default, canvases, moving chats between folders/worktrees, Agents window layout scope / panel alignment, harness name in chat titles, stopping background shells, BYOK `statefulResponses`, Windows sandboxing deprecation, redesigned model picker, enterprise policy routing / permission modes / DWORD policies, Python Environments fixes (extension not bundled), GitHub Pull Requests 0.170 stacked PRs on by default (not bundled) | 1.142 | N/A | — | |
| Spreading block paste: with `editor.multiCursorPaste: spread`, pasting a copied block at a single cursor distributes its rows across successive lines (`full` pastes the whole block) | 1.141 | Wait | — | |
| Modern UI polish (frosted glass overlays `workbench.modernUIFrostedGlass`, `connected`/`pill` tab styles); only with experimental `workbench.experimental.modernUI` | 1.141 | Wait | — | |
| Compact layout density now also applies to editor windows via `window.density.layout` (continues the 1.136 row) | 1.141 | Wait | — | |
| N/A: Copilot harness and sandboxing, worktree cleanup, session grid / filters / nested-session read status, background shells, Codex and external-session handoff, remote file download, Dev Container samples, Blobby pet, MCP discovery in Customizations, stacked PRs (GitHub Pull Requests 0.168, not bundled), multiple GitHub Enterprise instances (`github-enterprise.uris`; `null-accounts` wraps the github.com session only), enterprise managed settings and telemetry identity | 1.141 | N/A | — | |
| `editor.selectedTextMatchMode`: choose case-sensitive / insensitive selection highlighting independent of the Find widget | 1.140 | Wait | — | |
| `git.worktreeSymlinkFolders` (experimental): symlink ignored folders such as `node_modules` into new worktrees; revisit if Null grows a worktree workflow | 1.140 | Wait | — | |
| N/A: Copilot harness, HydraFusion, multi-folder sessions, remote agent delegation, Dev Container cleanup/startup, welcome phrases, composer controls, persistent progress, terminal output reflow in chat, multiple chats in the editor window, MCP portable config files, confetti accessibility signal, macOS terminal font rendering, `authIssuers` proposed API (`null-accounts` uses its own providers), enterprise minimum-version / Auto tier / OTel identity | 1.140 | N/A | — | |
| Word wrap indicators: an arrow at the wrap column marks lines that wrap | 1.139 | Wait | — | |
| Bracket auto-close no longer inserts a duplicate closing bracket when a matching one already follows | 1.139 | Wait | — | |
| N/A: remote Dev Container agent sessions, faster/compact/filterable session lists, in-place session rename, `sessions.showChatTabs`, pet naming contest, `authSessionExpiration` proposed API, Linux desktop file renames | 1.139 | N/A | — | |
| N/A: agent sessions in local Dev Containers, Automations sharing, Codex harness and quick chats, on-demand agent SDK download, PRs from agent sessions, session cleanup / attention badge, unified workspace picker, per-theme chat backgrounds, Voice Mode session awareness | 1.138 | N/A | — | |
| Smart diff editor layout: Inline / Side by Side / Automatic picker in **More Actions > Diff View**, shared by regular, multi-file and Changes diffs | 1.137 | Wait | — | |
| Binary files stay visible in multi-file diffs with a "Binary file changed" placeholder and **Open Diff** | 1.137 | Wait | — | |
| GitHub issue/PR links in the Markdown editor show live title and state (experimental `markdown.experimental.richLinks.enabled`); revisit for `null-markdown` once it leaves experimental | 1.137 | Wait | — | |
| N/A: Automations, Voice Mode, GitHub issue/PR as chat context and in the Agents window, VS Code pet, quick chats to workspace sessions, agent-queued messages, agent host, GitHub Pull Requests extension 0.166 (not bundled; `null-tools` owns the Issues panel), MHTML in integrated browser, Entra ID private marketplace sign-in | 1.137 | N/A | — | |
| Compact layout density (`window.density.layout`, needs experimental `workbench.experimental.modernUI`) | 1.136 | Wait | — | |
| Word wrap accounts for injected text width (color decorators, inlay hints, breakpoint placeholders) | 1.136 | Wait | — | |
| Terminal: no 5 s delay when extensions run commands once shell integration is ready (helps `null-actions` buttons) | 1.136 | Wait | — | |
| N/A: agent merge, multi-root agent sessions, session/chat hierarchy, chat backgrounds, agent notifications, agent host, dictation policies, Agents-window accessibility badge, integrated-browser spell check | 1.136 | N/A | — | |
| Auto-reload HTML files in the integrated browser (`workbench.browser.autoReloadOnFileChange`); open HTML in the integrated browser by default via `workbench.editorAssociations` | 1.133 / 1.134 | Wait | — | ✓ |
| Hold Alt on an editor tab's close button to **Close Other Editors** | 1.134 | Wait | — | ✓ |
| Hybrid Markdown editor (Agents window only, experimental; Markdown diffs from 1.132): rendered, editable, with agent comments. Built as the Null Markdown Editor in `null-markdown`; reconcile against the real feature once it leaves experimental | 1.131 / 1.132 | Adapt | #114 | ✓ |
| Built-in dictation in editors, chat and terminal (`dictation.enabled`, experimental; shell-aware terminal cleanup from 1.132) | 1.131 | Wait | — | ✓ |
| Terminal: `terminal.integrated.resizeDimensionsOverlay.enabled`, `accessibleViewPreserveCursorPosition: always`, clickable file links for `diff.mnemonicPrefix` paths | 1.130 / 1.131 | Wait | — | ✓ |
| Modern UI preview (`workbench.experimental.modernUI`); **Reopen Editor With** submenu in the editor toolbar | 1.129 | Wait | — | ✓ |
| `customEditors.priority` per editor mode (text vs. diff) proposed API; relevant if `null-markdown` ever registers a custom editor | 1.129 / 1.132 | Wait | — | ✓ |
| N/A: agent host and Agents window changes, side chats, grid / side-pane layouts, prompt timeline, find and sticky scroll in chat, Rubber Duck, Agent Plugins, Claude/Copilot model mixing, external agent session handoff, chat turn usage, local harness sandboxing, Copilot BYOK / prompt-to-skill migration / `!` commands / timestamps / credit usage, GitHub Enterprise in the agent host, VS Code pet, subagent info, commenting on elements in the integrated browser | 1.129–1.135 | N/A | — | |
