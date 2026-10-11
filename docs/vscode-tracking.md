# VS Code feature tracking

Null IDE builds on VSCodium, which trails VS Code by several releases. This list
catches VS Code features early so we can backport or adapt them now instead of
waiting for the VSCodium bump (#115).

**Last reviewed: 1.135**

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
