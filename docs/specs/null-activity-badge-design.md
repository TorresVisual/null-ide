# Null Activity — Badge Design

Issue: [#113 WakaTime Replacement](https://github.com/TorresVisual/null-ide/issues/113)

## Goal

Three shareable README badges built from the local activity log — **coding time**, **daily average** and **top language** — rendered as SVG on the machine, saved to a folder on request, or published (opt-in) to a secret GitHub Gist through `null-accounts` so a README can embed them by URL. Only the three published strings leave the machine.

This is piece 4 of the decomposition in `docs/specs/null-activity-engine-design.md`. WakaTime import remains a separate later spec.

## Decisions

- **Three badges, one Gist.** Files `null-activity-total.svg`, `null-activity-daily-average.svg`, `null-activity-top-language.svg` in a single secret Gist (`public: false`: unlisted, anyone with the link can view; GitHub has no private-but-embeddable option).
- **All-time numbers.** Total = all tracked time. Daily average = total ÷ number of days with any tracked time (not days since install, so a break does not drag it down). Top language = most-used `languageId` excluding terminal/unknown time (`''`); shown as the id the dashboard shows. No range setting.
- **Reuse the engine API.** `buildBadges` takes `getDailyStats(ALL_TIME)` and `getLanguageStats(ALL_TIME)`; no engine, `Interval` or log change. Durations use the existing `formatDuration`.
- **shields.io flat look**, own renderer (two segments, label | value, no dependency, no request to shields.io). Text width is estimated from the character count (`CHAR_PX`), not measured.
- **Opt-in in two steps.** The first manual publish shows a modal naming exactly what is published. `null-activity.badge.autoPublish` (default `false`) then only *refreshes the existing Gist*, about hourly, with a silent token, and never while `null-activity.enabled` is off. Auto-publish never creates a Gist and never opens UI. Unchanged badges (same content hash) skip the request.
- **Accounts.** GitHub accounts on `github.com` that have a token (not SSH-only) from `null-accounts`. One account is used directly; several → quick pick; the chosen account and the Gist are remembered in `globalState` (`null-activity.badge`). Tokens come from `NullAccountsApi.getToken(account, ['gist'], { interactive })`; null-activity stores none.
- **A deleted Gist is recreated.** A `PATCH` answered with 404 falls back to creating a new Gist.
- **Network code in one file.** `gistHttp.ts` is the only place that calls `fetch`, only to `api.github.com`, token only in the `Authorization` header, `redirect: 'error'`, 15 s timeout. The engine, dashboard and git code stay network-free.

## Components

| File | Responsibility |
|---|---|
| `src/badgeSvg.ts` | Pure `renderBadge(label, value, color) → string` (escaped, flat style). |
| `src/badgeModel.ts` | Pure `buildBadges(api) → Badge[]`. |
| `src/gistClient.ts` | `publishGist(http, token, existingId, files)`, `gistRawUrl(owner, id, file)`; injected `HttpJson`. |
| `src/gistHttp.ts` | The real `HttpJson` over `fetch`. |
| `src/badgePublisher.ts` | `BadgePublisher`: account choice, token, hash-skip, serialisation, state; injected deps, no `vscode`. |
| `src/badgeCommands.ts` | `vscode` glue: `null-activity.publishBadges`, `null-activity.saveBadges`, the auto-publish timer, consent modal, account quick pick, null-accounts lookup. |

## Output

Publish copies Markdown for the three badges to the clipboard:

```
![coding time](https://gist.githubusercontent.com/<login>/<id>/raw/null-activity-total.svg)
```

The URL has no revision, so it always serves the latest file. (GitHub proxies README images and may cache them for a while.)

## Error handling

Every failure (no GitHub account, no token or `gist` scope, 401/403, other HTTP status, network failure, timeout) becomes a one-line message: an error toast for the manual command, an Output-channel line for auto-publish. Nothing throws out of the publisher.

## Out of scope

Unpublishing/deleting the Gist (delete it on github.com), GitHub Enterprise or GitLab snippets, per-range or per-project badges, custom colours or styles, `shields.io` endpoint JSON, WakaTime import.
