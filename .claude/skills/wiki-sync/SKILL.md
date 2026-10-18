---
name: wiki-sync
description: Use when the user runs /wiki-sync, asks to update, check or publish the Null IDE GitHub Wiki, or after a change to user-facing behavior (a setting, command, keybinding, installer step, built-in extension, or privacy/network call) that the wiki may now describe wrongly.
---

# Wiki sync

The wiki source is `docs/wiki/*.md` in this repo (reviewed in PRs, versioned with the code). The GitHub Wiki (`TorresVisual/null-ide.wiki.git`) is a published copy. Edit the source, never the wiki on github.com.

Modes: `/wiki-sync` (default: update), `check` (report drift, change nothing), `publish` (push to the wiki).

## Update

1. **Find drift.** `cat docs/wiki/.last-sync` is the commit the pages last matched. Run `git diff --stat <sha>..HEAD -- <sources>` for the sources in the map below; no `.last-sync` means review every page.
2. **Read the changed sources**, then the page(s) they map to. Fix only what is now wrong or missing; do not rewrite pages that are still true.
3. **Verify against code, not memory.** Settings: `contributes.configuration` in `extensions/*/package.json` (key, default). Commands and keybindings: `contributes.commands` / `keybindings`. Install steps: `README.md`, `setup/CLAUDE.md`. Never document something you did not find in a source.
4. **Check links:** `node .claude/skills/wiki-sync/check-links.mjs`. It must print `ok`.
5. **Record the sync:** write `git rev-parse HEAD` to `docs/wiki/.last-sync`, commit with the docs (`docs(wiki): ...`).
6. Report which pages changed and why. Offer `publish`; do not run it unprompted.

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
| Home, _Sidebar | the page list itself |

Adding a page: create `docs/wiki/<Name>.md` (hyphens for spaces), link it from `Home.md` and `_Sidebar.md`, add a row to the map above.

## Style

Plain language, short pages, one topic per heading. Link pages as `[Text](Page-Name)`, anchors as `[Text](Page-Name#lowercase-heading)`. Do not copy README prose wholesale; the README stays the short landing page and links here. No version numbers that go stale; say "latest release".

## Publish

Pushing publishes content to a public site, so confirm with the user first.

1. First time only: the wiki repo does not exist until someone creates one page by hand at `github.com/TorresVisual/null-ide/wiki` (**Create the first page**, save). Check with `git ls-remote https://github.com/TorresVisual/null-ide.wiki.git`.
2. Clone it outside the repo, replace its pages, push:

```bash
W=$(mktemp -d)/wiki && git clone https://github.com/TorresVisual/null-ide.wiki.git "$W"
rm -f "$W"/*.md && cp docs/wiki/*.md "$W"/
git -C "$W" add -A && git -C "$W" commit -m "Sync from null-ide@$(git rev-parse --short HEAD)" && git -C "$W" push
```

Only `*.md` is copied, so `.last-sync` stays local. The wiki's default branch is `master`; a plain `git push` handles it.

## Check mode

Run steps 1 and 4 only. Report: pages whose sources changed since `.last-sync`, broken links, and any setting key mentioned in `Configuration.md` that no longer exists in a `package.json`.
