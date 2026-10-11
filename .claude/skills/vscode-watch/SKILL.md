---
name: vscode-watch
description: Review new VS Code stable releases for features Null IDE should pick up before VSCodium ships them — triage each relevant feature (Backport / Adapt / Wait / N/A), update docs/vscode-tracking.md, file Null issues for the ones to build now, and close the matching "Review VS Code 1.x release notes" issues. Use when the user runs /vscode-watch, asks to review VS Code release notes, or an upstream-check review issue is open.
---

# Watching VS Code releases

VSCodium (pinned in `VSCODIUM_TAG`) trails VS Code by several releases. This skill
catches VS Code features early so Null can backport or adapt them now. VS Code is a
reference, not a spec: adapt to Null's identity, don't copy blindly (#115).

Do not implement anything here. The only changes are `docs/vscode-tracking.md` and
GitHub issues.

## Workflow

1. **Find the range.** Read `Last reviewed: 1.N` in `docs/vscode-tracking.md` and
   `gh api repos/microsoft/vscode/releases/latest --jq .tag_name`. Review every minor
   version after `N` up to the latest, oldest first.
2. **Read the notes** for each version:
   `curl -s https://raw.githubusercontent.com/microsoft/vscode-docs/main/release-notes/v1_<minor>.md`
   (human page: `https://code.visualstudio.com/updates/v1_<minor>`).
3. **Skip noise:** Copilot/chat-only features (the Claude Code extension is Null's AI
   path), Microsoft-service features VSCodium strips, Remote/Codespaces, web-only,
   macOS/Linux-only, engineering/housekeeping sections, minor bug fixes.
4. **Triage what's left.** Check `.claude/product-audit/FEATURES.md` and the
   CLAUDE.md extension sections to see what Null already shadows, then give each
   feature one status:
   - **Backport**: lives in workbench core and is worth having now. The fix is a
     temporary `patches/` file cherry-picking the upstream commit (find it from the
     notes' linked issue/PR). Note in the issue that it must apply against the
     current `MS_TAG`.
   - **Adapt**: belongs in a Null component, or upstream changed something Null
     replaces (`null-markdown` vs. the built-in preview, the dashboard vs. Welcome,
     patch 007 vs. the Accounts menu, patch 006 vs. the Settings TOC,
     `configurationDefaults` that turn it off). Build it the Null way.
   - **Wait**: good, but fine to arrive with the VSCodium bump.
   - **N/A**: doesn't fit Null.
5. **File issues** for Backport and Adapt rows through the `file-issue` skill, after
   checking for duplicates (`gh issue list --search`). Each issue covers: what VS Code
   introduced (version + release-notes link), why it helps, what the Null version
   should do, how it differs from upstream, acceptance criteria, and a
   *Reconcile when VSCodium reaches 1.<minor>* note. Add `Part of #115.`
6. **Update the tracker:** add one row per non-N/A feature (`Reconciled` empty),
   group N/A ones into a single `N/A: ...` row per version only if useful, and set
   `Last reviewed` to the newest version reviewed.
7. **Close the review issues** for each finished version:
   `gh issue close <n> --comment "Reviewed; see docs/vscode-tracking.md"`.
8. **Commit** the tracker: `docs(vscode-tracking): review VS Code 1.<from>–1.<to>`.

## Reconciling on a VSCodium bump

When asked to reconcile (the bump PR body asks for it), for every row whose VS Code
version is ≤ the new `MS_TAG`: delete Backport patches, check Adapt work against the
upstream feature (drop duplicates, keep deliberate differences), then tick
**Reconciled**.

## Report

List per version: features triaged by status, issues filed (`#123 — title`), review
issues closed, and the new `Last reviewed`.
