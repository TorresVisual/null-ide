---
name: wiki-sync
description: Use when the user runs /wiki-sync, asks to update, check or publish the Null IDE GitHub Wiki, or after a change to user-facing behavior (a setting, command, keybinding, installer step, built-in extension, or privacy/network call) that the wiki or README may now describe wrongly.
---

# Wiki sync

Keeps two things true to the code: `README.md` (the short landing page) and the wiki. The wiki source is `docs/wiki/*.md` in this repo (reviewed in PRs, versioned with the code). The GitHub Wiki (`TorresVisual/null-ide.wiki.git`) is a published copy. Edit the source, never the wiki on github.com. The README stays concise; detail belongs in the wiki and the README links to it.

Modes: `/wiki-sync` (default: update), `check` (report drift, change nothing), `publish` (push to the wiki).

## Update

1. **Audit the README first** (see [README](#readme)); it feeds the wiki pages below, so fix it before them.
2. **Find drift.** `cat docs/wiki/.last-sync` is the commit the pages last matched. Run `git diff --stat <sha>..HEAD -- <sources>` for the sources in the map below; no `.last-sync` means review every page.
3. **Read the changed sources**, then the page(s) they map to. Fix only what is now wrong or missing; do not rewrite pages that are still true.
4. **Verify against code, not memory.** Settings: `contributes.configuration` in `extensions/*/package.json` (key, default). Commands and keybindings: `contributes.commands` / `keybindings`. Install steps: `setup/CLAUDE.md` (the README is derived, not a source of truth). Never document something you did not find in a source.
5. **Check links:** `node .claude/skills/wiki-sync/check-links.mjs`. It must print `ok`.
6. **Record the sync:** write `git rev-parse HEAD` to `docs/wiki/.last-sync`, commit the wiki with `docs(wiki): ...` and README fixes separately with `docs(readme): ...`.
7. Report which README sections and wiki pages changed and why. Offer `publish`; do not run it unprompted.

## Source map

| Page | Sources of truth |
|---|---|
| Getting-Started | `README.md` (Install, Usage), `setup/CLAUDE.md`, `product.json` |
| Features | `extensions/*/package.json` (commands, keybindings), root `CLAUDE.md`, each extension's `CLAUDE.md` |
| Configuration | `contributes.configuration` in `extensions/*/package.json`, `product.json` `configurationDefaults` |
| Extensions | root `CLAUDE.md` built-in list, `extensionDependencies` in `package.json`s, `product.json` `extensionRecommendations` |
| Troubleshooting | `README.md`, `docs/specs/safe-mode-design.md`, closed bug issues (`gh issue list --label bug --state closed`) |
| Development | root `CLAUDE.md`, `README.md` (Building, Development), `.github/workflows/build.yml` |
| Contributing | `.github/ISSUE_TEMPLATE/*`, `git log` commit style |
| FAQ | `README.md` (Privacy), recurring questions in issues |
| Linux | `scripts/linux-smoke.sh`, `scripts/linux-deb-metadata.mjs`, `build-linux` job in `build.yml` |
| Home, _Sidebar | the page list itself |

Adding a page: create `docs/wiki/<Name>.md` (hyphens for spaces), link it from `Home.md` and `_Sidebar.md`, add a row to the map above.

## README

Always audited in update mode (it has no sync marker, so the check is not diff-gated). Read `README.md` and check each claim against its source; run any command or path it names (`ls` the path, `grep` the key). Fix what is wrong, missing or misleading; leave true prose alone.

| README section | Verify against |
|---|---|
| Intro, platform/arch claims | `build.yml` jobs (`build-windows`, `build-linux`), root `CLAUDE.md` Project Overview |
| Built-in extensions table | `ls extensions/` and root `CLAUDE.md` built-in list: every shipped extension is listed or deliberately folded into another row |
| Highlights | commands/keybindings in `extensions/*/package.json` (key, `Ctrl+Shift+Alt+G` etc.) |
| Install, Updating, Linux | `setup/CLAUDE.md`, `scripts/linux-smoke.sh`, `UPDATE_CHECK_INTERVAL_MS` in `extensions/null-tools/src/updater.ts`, release asset names in `build.yml` |
| Usage | `null` CLI flags in `docs/specs/safe-mode-design.md`, `product.json` `extensionRecommendations` and `configurationDefaults` |
| Privacy | every network call: `product.json` `enableTelemetry`, `fetch`/`https` use in `extensions/*/src` |
| Building, Development | `.github/workflows/*.yml` (name, cron, triggers), `VSCODIUM_TAG`, the layout tree vs `ls`, `scripts/*` it names |
| Links | every relative path exists (`docs/ROADMAP.md`, `patches/`, `docs/wiki/`, ...) |

Rules: keep it a landing page. If a fix needs more than a sentence or a table row, put the detail in the matching wiki page and link it. Do not add settings, per-command lists or version numbers. Report claims you cannot verify instead of guessing.

## Style

Plain language, short pages, one topic per heading. Link pages as `[Text](Page-Name)`, anchors as `[Text](Page-Name#lowercase-heading)`. Do not copy README prose wholesale; the README stays the short landing page and links here. No version numbers that go stale; say "latest release".

## Publish

Pushing publishes content to a public site, so confirm with the user first.

0. Commit first: `git status --short docs/wiki` must be empty, so only reviewed, committed pages go public.
1. First time only: the wiki repo does not exist until someone creates one page by hand at `github.com/TorresVisual/null-ide/wiki` (**Create the first page**, save). Check with `git ls-remote https://github.com/TorresVisual/null-ide.wiki.git`.
2. Clone it outside the repo, replace its pages, push:

```bash
W=$(mktemp -d)/wiki && git clone https://github.com/TorresVisual/null-ide.wiki.git "$W"
rm -f "$W"/*.md && cp docs/wiki/*.md "$W"/
git -C "$W" add -A && git -C "$W" diff --cached --stat   # show the user; stop if it removes pages you did not expect
git -C "$W" commit -m "Sync from null-ide@$(git rev-parse --short HEAD)" && git -C "$W" push
```

Only `*.md` is copied, so `.last-sync` stays local. The wiki's default branch is `master`; a plain `git push` handles it.

## Check mode

Run the README audit, step 2 and the link check only, and change nothing. Report: README claims that are wrong or missing, pages whose sources changed since `.last-sync`, broken links, and any setting key mentioned in `Configuration.md` that no longer exists in a `package.json`.
