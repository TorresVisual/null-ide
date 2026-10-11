# VS Code feature tracking

Null IDE builds on VSCodium, which trails VS Code by several releases. This list
catches VS Code features early so we can backport or adapt them now instead of
waiting for the VSCodium bump (#115).

**Last reviewed: 1.136**

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
| Compact layout density (`window.density.layout`, needs experimental `workbench.experimental.modernUI`) | 1.136 | Wait | — | |
| Word wrap accounts for injected text width (color decorators, inlay hints, breakpoint placeholders) | 1.136 | Wait | — | |
| Terminal: no 5 s delay when extensions run commands once shell integration is ready (helps `null-actions` buttons) | 1.136 | Wait | — | |
| N/A: agent merge, multi-root agent sessions, session/chat hierarchy, chat backgrounds, agent notifications, agent host, dictation policies, Agents-window accessibility badge, integrated-browser spell check | 1.136 | N/A | — | |
