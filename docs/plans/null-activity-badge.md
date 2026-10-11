# Null Activity Badge Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Render three README badges (coding time, daily average, top language) from the local activity log, save them as SVG, and — opt-in — publish them to a secret GitHub Gist through `null-accounts`.

**Architecture:** Pure `buildBadges` (over the existing `NullActivityApi` reads) and `renderBadge` (flat shields-style SVG) feed a `BadgePublisher` with injected deps (accounts, token, HTTP, state) and no `vscode` import. `gistClient.ts` talks to the Gist API through an injected `HttpJson`; `gistHttp.ts` is the only file that calls `fetch`. `badgeCommands.ts` is the `vscode` glue: two commands, the consent modal, and an opt-in hourly refresh of an existing Gist.

**Tech Stack:** TypeScript, `node --test`, global `fetch`, `crypto` (sha1 content hash), `null-accounts` public API.

**Spec:** `docs/specs/null-activity-badge-design.md`

All commands run from `extensions/null-activity/` unless a step says otherwise.

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Network code lives in `src/gistHttp.ts` only: `fetch` to `https://api.github.com/gists`, token only in the `Authorization` header, `redirect: 'error'`, `AbortSignal.timeout(15_000)`. No other file in `src/` calls `fetch`.
- Exactly three files are published: `null-activity-total.svg`, `null-activity-daily-average.svg`, `null-activity-top-language.svg`. Nothing else (no project names, file names or paths). The Gist is secret (`public: false`).
- Daily average = total tracked time ÷ number of days with any tracked time. Top language = most-used language id, excluding `''` (terminal/unknown). All-time (`ALL_TIME`), no range setting.
- Publishing is opt-in: the first manual publish shows a modal. `null-activity.badge.autoPublish` defaults to `false`, only refreshes an existing Gist, uses a silent token (`interactive: false`), never opens UI, and does nothing while `null-activity.enabled` is `false`.
- GitHub accounts on `github.com` with a token (`authMethod !== 'ssh'`). Tokens come from `getToken(account, ['gist'], { interactive })`; null-activity stores no token.
- Only `badgeCommands.ts` (and `extension.ts`) import `vscode`.
- No change to `Interval`, the interval log, `NullActivityApi`, `ActivityService`, the dashboard or the webview. No new dependency.
- Never hand-edit `out/`. Refresh it in the final chore commit (`chore: refresh null-activity compiled output`).
- A new test file does nothing until it is added to the `test` script in `package.json` (each task does this).
- Commit messages end with the `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` trailer. Never skip hooks, never push, never amend.

## Review Focus

Inputs the spec implies that a person will hit; each has a test in the task named.

1. A fresh install with an empty log: badges read `0m`, `0m`, `none` — no `NaN`, no divide by zero (Task 2, `empty log`).
2. Time that is only terminal activity (`language: ''`): the top language is the next real language, or `none`, never a blank value (Task 2, `top language skips…`).
3. The Gist was deleted on github.com: the next publish gets a 404 from `PATCH` and creates a new Gist instead of failing forever (Task 3, `404 on update…`).
4. No token, a refused scope (401/403), a thrown token provider, or a network failure: a readable one-line message, nothing thrown, no secret in the message, and auto-refresh never asks for sign-in (Tasks 3 and 4).
5. Hourly refresh with unchanged numbers makes no request; a manual publish racing an auto-refresh never interleaves (Task 4, `auto-refresh skips…`, `publishes are serialised`).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/badgeSvg.ts` | create | Pure `renderBadge(label, value, color)` |
| `src/badgeModel.ts` | create | Pure `buildBadges(api)`, `Badge`, `BadgeSource` |
| `src/gistClient.ts` | create | `HttpJson`, `publishGist`, `gistRawUrl` |
| `src/gistHttp.ts` | create | `fetchJson` — the only `fetch` |
| `src/badgePublisher.ts` | create | `BadgePublisher` (account, token, hash-skip, serialisation, state) |
| `src/badgeCommands.ts` | create | `registerBadges`: commands, consent, quick pick, auto-refresh timer |
| `src/extension.ts` | modify | Call `registerBadges` |
| `package.json` | modify | Commands, `badge.autoPublish` setting, test script entries |
| `src/test/badgeSvg.test.ts`, `badgeModel.test.ts`, `gistClient.test.ts`, `badgePublisher.test.ts` | create | Tests |
| `../../CLAUDE.md` | modify | null-activity paragraph |

---

### Task 1: SVG renderer

**Files:**
- Create: `src/badgeSvg.ts`
- Test: `src/test/badgeSvg.test.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: nothing.
- Produces: `renderBadge(label: string, value: string, color: string): string`.

- [ ] **Step 1: Write the failing test**

Create `src/test/badgeSvg.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { renderBadge } from '../badgeSvg';

const widthOf = (svg: string) => Number(/<svg[^>]* width="(\d+)"/.exec(svg)?.[1]);

test('renders a two-segment flat badge sized from the text', () => {
  const svg = renderBadge('coding time', '1h', '#007ec6');
  assert.ok(svg.startsWith('<svg '));
  assert.ok(svg.endsWith('</svg>'));
  // 11 chars -> round(72.6) + 10 = 83; 2 chars -> round(13.2) + 10 = 23
  assert.strictEqual(widthOf(svg), 106);
  assert.strictEqual(svg.match(/<text /g)?.length, 2);
  assert.ok(svg.includes('>coding time</text>'));
  assert.ok(svg.includes('>1h</text>'));
  assert.ok(svg.includes('fill="#007ec6"'));
});

test('a longer value makes a wider badge', () => {
  assert.ok(widthOf(renderBadge('top language', 'typescript', '#000')) > widthOf(renderBadge('top language', 'c', '#000')));
});

test('text is XML-escaped so a value can never inject markup', () => {
  const svg = renderBadge('a&b', '<script>"x"</script>', '#000');
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('a&amp;b'));
  assert.ok(svg.includes('&lt;script&gt;&quot;x&quot;&lt;/script&gt;'));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsc -p tsconfig.json; node --test out/test/badgeSvg.test.js`
Expected: `tsc` error `Cannot find module '../badgeSvg'`.

- [ ] **Step 3: Write the implementation**

Create `src/badgeSvg.ts`:

```ts
'use strict';

// ponytail: width is estimated from the character count (Verdana 11px averages ~6.6px), not measured.
// Tune CHAR_PX if labels look cramped; add a per-character width table only if that is not enough.
const CHAR_PX = 6.6;
const PAD = 10;
const HEIGHT = 20;

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);
const segmentWidth = (text: string) => Math.round(text.length * CHAR_PX) + PAD;

/** A flat, shields.io-style two-segment badge: dark label, coloured value. */
export function renderBadge(label: string, value: string, color: string): string {
  const lw = segmentWidth(label);
  const vw = segmentWidth(value);
  const w = lw + vw;
  const l = escapeXml(label);
  const v = escapeXml(value);
  const title = `${l}: ${v}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${HEIGHT}" role="img" aria-label="${title}">` +
    `<title>${title}</title>` +
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<clipPath id="r"><rect width="${w}" height="${HEIGHT}" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${lw}" height="${HEIGHT}" fill="#555"/>` +
    `<rect x="${lw}" width="${vw}" height="${HEIGHT}" fill="${escapeXml(color)}"/>` +
    `<rect width="${w}" height="${HEIGHT}" fill="url(#s)"/></g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
    `<text x="${lw / 2}" y="14">${l}</text><text x="${lw + vw / 2}" y="14">${v}</text></g></svg>`
  );
}
```

- [ ] **Step 4: Register the test and run it**

In `package.json`, append ` out/test/badgeSvg.test.js` to the end of the `node --test …` list in the `test` script.

Run: `npm test`
Expected: all tests PASS, including the 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src/badgeSvg.ts extensions/null-activity/src/test/badgeSvg.test.ts extensions/null-activity/package.json
git commit -m "feat(null-activity): render flat SVG badges"
```

---

### Task 2: Badge model

**Files:**
- Create: `src/badgeModel.ts`
- Test: `src/test/badgeModel.test.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `ALL_TIME`, `formatDuration` from `./stats`; `NullActivityApi` from `./types`.
- Produces:
  - `interface Badge { file: string; label: string; value: string; color: string }`
  - `type BadgeSource = Pick<NullActivityApi, 'getDailyStats' | 'getLanguageStats'>`
  - `buildBadges(api: BadgeSource): Badge[]` — always three, in order total, daily average, top language.

- [ ] **Step 1: Write the failing test**

Create `src/test/badgeModel.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { BadgeSource, buildBadges } from '../badgeModel';

const MIN = 60_000;
const source = (days: number[], languages: Array<[string, number]>): BadgeSource => ({
  getDailyStats: () => days.map((ms, n) => ({ day: `2026-10-0${n + 1}`, ms })),
  getLanguageStats: () => languages.map(([language, ms]) => ({ language, ms })),
});
const values = (s: BadgeSource) => buildBadges(s).map((b) => b.value);

test('empty log: zeros and "none", never NaN', () => {
  assert.deepStrictEqual(values(source([], [])), ['0m', '0m', 'none']);
});

test('total is the sum of all days; the average is over days with time', () => {
  const badges = buildBadges(source([120 * MIN, 60 * MIN], [['typescript', 180 * MIN]]));
  assert.deepStrictEqual(badges.map((b) => b.value), ['3h 0m', '1h 30m', 'typescript']);
  assert.deepStrictEqual(badges.map((b) => b.label), ['coding time', 'daily average', 'top language']);
  assert.deepStrictEqual(badges.map((b) => b.file), [
    'null-activity-total.svg', 'null-activity-daily-average.svg', 'null-activity-top-language.svg',
  ]);
});

test('top language skips terminal/unknown time', () => {
  assert.strictEqual(values(source([60 * MIN], [['', 50 * MIN], ['rust', 10 * MIN]]))[2], 'rust');
  assert.strictEqual(values(source([60 * MIN], [['', 60 * MIN]]))[2], 'none');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsc -p tsconfig.json; node --test out/test/badgeModel.test.js`
Expected: `tsc` error `Cannot find module '../badgeModel'`.

- [ ] **Step 3: Write the implementation**

Create `src/badgeModel.ts`:

```ts
'use strict';

import { ALL_TIME, formatDuration } from './stats';
import { NullActivityApi } from './types';

export interface Badge {
  file: string;
  label: string;
  value: string;
  color: string;
}

export type BadgeSource = Pick<NullActivityApi, 'getDailyStats' | 'getLanguageStats'>;

/** Total time, average per active day, and most-used language — all-time. */
export function buildBadges(api: BadgeSource): Badge[] {
  const days = api.getDailyStats(ALL_TIME);
  const total = days.reduce((sum, d) => sum + d.ms, 0);
  const average = days.length ? total / days.length : 0;
  const top = api.getLanguageStats(ALL_TIME).find((l) => l.language !== '');
  return [
    { file: 'null-activity-total.svg', label: 'coding time', value: formatDuration(total), color: '#007ec6' },
    { file: 'null-activity-daily-average.svg', label: 'daily average', value: formatDuration(average), color: '#4c1' },
    { file: 'null-activity-top-language.svg', label: 'top language', value: top?.language ?? 'none', color: '#fe7d37' },
  ];
}
```

- [ ] **Step 4: Register the test and run it**

In `package.json`, append ` out/test/badgeModel.test.js` to the `node --test …` list in the `test` script.

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src/badgeModel.ts extensions/null-activity/src/test/badgeModel.test.ts extensions/null-activity/package.json
git commit -m "feat(null-activity): build the badge set from activity stats"
```

---

### Task 3: Gist client and HTTP transport

**Files:**
- Create: `src/gistClient.ts`, `src/gistHttp.ts`
- Test: `src/test/gistClient.test.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface HttpReply { status: number; body: unknown }`
  - `type HttpJson = (method: 'POST' | 'PATCH', url: string, headers: Record<string, string>, body: Record<string, unknown>) => Promise<HttpReply>`
  - `interface GistFile { name: string; content: string }`
  - `type PublishResult = { ok: true; id: string; owner: string } | { ok: false; message: string }`
  - `publishGist(http: HttpJson, token: string, existingId: string | undefined, files: GistFile[]): Promise<PublishResult>` — never throws.
  - `gistRawUrl(owner: string, id: string, file: string): string`
  - `fetchJson: HttpJson` (in `gistHttp.ts`)

- [ ] **Step 1: Write the failing test**

Create `src/test/gistClient.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { GistFile, HttpJson, HttpReply, gistRawUrl, publishGist } from '../gistClient';

const files: GistFile[] = [{ name: 'a.svg', content: '<svg/>' }, { name: 'b.svg', content: '<svg b/>' }];
const OK = { id: 'g1', owner: { login: 'alice' } };

function fake(replies: Array<HttpReply | Error>) {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: Record<string, any> }> = [];
  const http: HttpJson = async (method, url, headers, body) => {
    calls.push({ method, url, headers, body });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next!;
  };
  return { http, calls };
}

test('creates a secret gist and reports its id and owner', async () => {
  const { http, calls } = fake([{ status: 201, body: OK }]);
  const result = await publishGist(http, 'tok', undefined, files);
  assert.deepStrictEqual(result, { ok: true, id: 'g1', owner: 'alice' });
  assert.strictEqual(calls[0].method, 'POST');
  assert.strictEqual(calls[0].url, 'https://api.github.com/gists');
  assert.strictEqual(calls[0].headers.Authorization, 'Bearer tok');
  assert.strictEqual(calls[0].body.public, false);
  assert.deepStrictEqual(calls[0].body.files, { 'a.svg': { content: '<svg/>' }, 'b.svg': { content: '<svg b/>' } });
});

test('updates an existing gist in place', async () => {
  const { http, calls } = fake([{ status: 200, body: OK }]);
  assert.deepStrictEqual(await publishGist(http, 'tok', 'g1', files), { ok: true, id: 'g1', owner: 'alice' });
  assert.strictEqual(calls[0].method, 'PATCH');
  assert.strictEqual(calls[0].url, 'https://api.github.com/gists/g1');
  assert.ok(!('public' in calls[0].body));
});

test('404 on update means the gist was deleted: create a new one', async () => {
  const { http, calls } = fake([{ status: 404, body: { message: 'Not Found' } }, { status: 201, body: { id: 'g2', owner: { login: 'alice' } } }]);
  assert.deepStrictEqual(await publishGist(http, 'tok', 'g1', files), { ok: true, id: 'g2', owner: 'alice' });
  assert.deepStrictEqual(calls.map((c) => c.method), ['PATCH', 'POST']);
});

test('401/403 explain the missing scope and never echo the token', async () => {
  for (const status of [401, 403]) {
    const result = await publishGist(fake([{ status, body: { message: 'Bad credentials' } }]).http, 'secret-token', undefined, files);
    assert.strictEqual(result.ok, false);
    const message = (result as { message: string }).message;
    assert.ok(message.includes(`HTTP ${status}`));
    assert.ok(message.includes('gist'));
    assert.ok(!message.includes('secret-token'));
  }
});

test('other statuses and malformed success bodies become a message', async () => {
  const server = await publishGist(fake([{ status: 500, body: { message: 'boom' } }]).http, 't', undefined, files);
  assert.deepStrictEqual(server, { ok: false, message: 'GitHub answered HTTP 500: boom' });
  const malformed = await publishGist(fake([{ status: 201, body: { nope: true } }]).http, 't', undefined, files);
  assert.deepStrictEqual(malformed, { ok: false, message: 'GitHub answered HTTP 201.' });
});

test('a network failure is a result, not a throw', async () => {
  const result = await publishGist(fake([new Error('ETIMEDOUT')]).http, 't', undefined, files);
  assert.deepStrictEqual(result, { ok: false, message: 'Could not reach GitHub (ETIMEDOUT).' });
});

test('raw URL has no revision so it always serves the latest file', () => {
  assert.strictEqual(gistRawUrl('alice', 'g1', 'a.svg'), 'https://gist.githubusercontent.com/alice/g1/raw/a.svg');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsc -p tsconfig.json; node --test out/test/gistClient.test.js`
Expected: `tsc` error `Cannot find module '../gistClient'`.

- [ ] **Step 3: Write the implementation**

Create `src/gistClient.ts`:

```ts
'use strict';

export interface HttpReply {
  status: number;
  body: unknown;
}

/** Resolves any HTTP response; rejects only on a network failure. */
export type HttpJson = (
  method: 'POST' | 'PATCH',
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
) => Promise<HttpReply>;

export interface GistFile {
  name: string;
  content: string;
}

export type PublishResult = { ok: true; id: string; owner: string } | { ok: false; message: string };

const API = 'https://api.github.com/gists';
const DESCRIPTION = 'Null Activity badges';

export const gistRawUrl = (owner: string, id: string, file: string): string =>
  `https://gist.githubusercontent.com/${owner}/${id}/raw/${file}`;

function serverSays(body: unknown): string {
  const message = typeof body === 'string' ? body : (body as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' ? message.slice(0, 200) : '';
}

/**
 * Creates the secret gist, or updates `existingId` in place (creating a new one if it was deleted).
 * Never throws; the token only ever goes in the Authorization header.
 */
export async function publishGist(
  http: HttpJson,
  token: string,
  existingId: string | undefined,
  files: GistFile[],
): Promise<PublishResult> {
  const content = Object.fromEntries(files.map((f) => [f.name, { content: f.content }]));
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const create = () => http('POST', API, headers, { description: DESCRIPTION, public: false, files: content });

  let reply: HttpReply;
  try {
    reply = existingId
      ? await http('PATCH', `${API}/${encodeURIComponent(existingId)}`, headers, { description: DESCRIPTION, files: content })
      : await create();
    if (existingId && reply.status === 404) reply = await create();
  } catch (err) {
    return { ok: false, message: `Could not reach GitHub (${err instanceof Error ? err.message : String(err)}).` };
  }

  const said = serverSays(reply.body);
  if (reply.status === 401 || reply.status === 403) {
    return { ok: false, message: `GitHub refused (HTTP ${reply.status}): the sign-in needs the "gist" scope.${said ? ` ${said}` : ''}` };
  }
  const body = reply.body as { id?: unknown; owner?: { login?: unknown } } | undefined;
  if ((reply.status === 200 || reply.status === 201) && typeof body?.id === 'string' && typeof body.owner?.login === 'string') {
    return { ok: true, id: body.id, owner: body.owner.login };
  }
  return { ok: false, message: `GitHub answered HTTP ${reply.status}${said ? `: ${said}` : '.'}` };
}
```

Create `src/gistHttp.ts`:

```ts
'use strict';

import { HttpJson } from './gistClient';

/** The only network call in this extension. */
export const fetchJson: HttpJson = async (method, url, headers, body) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'null-ide', ...headers },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { /* keep the raw text */ }
  return { status: res.status, body: parsed };
};
```

- [ ] **Step 4: Register the test and run it**

In `package.json`, append ` out/test/gistClient.test.js` to the `node --test …` list in the `test` script.

Run: `npm test`
Expected: all tests PASS (`tsc` also compiles `gistHttp.ts`; if it cannot find `fetch`, compare with `extensions/null-accounts/tsconfig.json`, which compiles the same code).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src/gistClient.ts extensions/null-activity/src/gistHttp.ts extensions/null-activity/src/test/gistClient.test.ts extensions/null-activity/package.json
git commit -m "feat(null-activity): publish files to a secret GitHub gist"
```

---

### Task 4: Badge publisher

**Files:**
- Create: `src/badgePublisher.ts`
- Test: `src/test/badgePublisher.test.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `BadgeSource`, `buildBadges`, `Badge` (Task 2); `renderBadge` (Task 1); `HttpJson`, `publishGist`, `gistRawUrl` (Task 3).
- Produces:
  - `interface BadgeAccount { id: string; username: string }`
  - `interface PublishedState { gistId: string; accountId: string; owner: string; hash: string }`
  - `interface BadgePublisherDeps { source: BadgeSource; accounts(): Promise<BadgeAccount[]>; chooseAccount(accounts: BadgeAccount[]): Promise<BadgeAccount | undefined>; token(accountId: string, interactive: boolean): Promise<string | undefined>; http: HttpJson; state: { get(): PublishedState | undefined; set(state: PublishedState): void } }`
  - `type PublishOutcome = { ok: true; changed: boolean; markdown: string } | { ok: false; message: string }`
  - `class BadgePublisher { constructor(deps); publish(opts: { interactive: boolean }): Promise<PublishOutcome> }` — never rejects; calls run one at a time.

- [ ] **Step 1: Write the failing test**

Create `src/test/badgePublisher.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { BadgeAccount, BadgePublisher, PublishedState } from '../badgePublisher';
import { HttpJson } from '../gistClient';
import { DailyStat, LanguageStat } from '../types';

const MIN = 60_000;
const alice: BadgeAccount = { id: 'a1', username: 'alice' };
const bob: BadgeAccount = { id: 'b1', username: 'bob' };

interface Options {
  accounts?: BadgeAccount[];
  token?: string | undefined;
  tokenError?: boolean;
  state?: PublishedState;
  choose?: BadgeAccount;
  gate?: Promise<void>;
}

function setup(over: Options = {}) {
  const calls: Array<{ method: string; url: string; body: Record<string, any> }> = [];
  const days: DailyStat[] = [{ day: '2026-10-08', ms: 60 * MIN }];
  const languages: LanguageStat[] = [{ language: 'typescript', ms: 60 * MIN }];
  const tokenAsked: boolean[] = [];
  let state = over.state;
  const http: HttpJson = async (method, url, _headers, body) => {
    calls.push({ method, url, body });
    if (over.gate && calls.length === 1) await over.gate;
    return { status: method === 'POST' ? 201 : 200, body: { id: 'g1', owner: { login: 'alice' } } };
  };
  const publisher = new BadgePublisher({
    source: { getDailyStats: () => days, getLanguageStats: () => languages },
    accounts: async () => over.accounts ?? [alice],
    chooseAccount: async () => over.choose,
    token: async (_id, interactive) => {
      tokenAsked.push(interactive);
      if (over.tokenError) throw new Error('keychain locked');
      return 'token' in over ? over.token : 'tok';
    },
    http,
    state: { get: () => state, set: (s) => { state = s; } },
  });
  return { publisher, calls, days, tokenAsked, getState: () => state };
}

test('first manual publish creates a secret gist, remembers it and returns README markdown', async () => {
  const t = setup();
  const out = await t.publisher.publish({ interactive: true });
  if (!out.ok) throw new Error(out.message);
  assert.strictEqual(t.calls.length, 1);
  assert.strictEqual(t.calls[0].method, 'POST');
  assert.strictEqual(t.calls[0].body.public, false);
  assert.deepStrictEqual(Object.keys(t.calls[0].body.files), [
    'null-activity-total.svg', 'null-activity-daily-average.svg', 'null-activity-top-language.svg',
  ]);
  assert.strictEqual(t.getState()?.gistId, 'g1');
  assert.strictEqual(t.getState()?.accountId, 'a1');
  const lines = out.markdown.split('\n');
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0], '![coding time](https://gist.githubusercontent.com/alice/g1/raw/null-activity-total.svg)');
});

test('no GitHub account: a message, and GitHub is not called', async () => {
  const t = setup({ accounts: [] });
  const out = await t.publisher.publish({ interactive: true });
  assert.strictEqual(out.ok, false);
  assert.match((out as { message: string }).message, /GitHub account/);
  assert.strictEqual(t.calls.length, 0);
});

test('auto-refresh never starts publishing and never asks for a token', async () => {
  const t = setup();
  const out = await t.publisher.publish({ interactive: false });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(t.calls.length, 0);
  assert.deepStrictEqual(t.tokenAsked, []);
});

test('auto-refresh skips unchanged badges and updates changed ones, silently', async () => {
  const t = setup();
  await t.publisher.publish({ interactive: true });
  const same = await t.publisher.publish({ interactive: false });
  assert.deepStrictEqual(same.ok && same.changed, false);
  assert.strictEqual(t.calls.length, 1);

  t.days[0].ms = 120 * MIN;
  const changed = await t.publisher.publish({ interactive: false });
  assert.deepStrictEqual(changed.ok && changed.changed, true);
  assert.strictEqual(t.calls.length, 2);
  assert.strictEqual(t.calls[1].method, 'PATCH');
  assert.ok(t.calls[1].url.endsWith('/gists/g1'));
  assert.strictEqual(t.tokenAsked[t.tokenAsked.length - 1], false);
});

test('a manual publish always pushes, even when nothing changed', async () => {
  const t = setup();
  await t.publisher.publish({ interactive: true });
  await t.publisher.publish({ interactive: true });
  assert.deepStrictEqual(t.calls.map((c) => c.method), ['POST', 'PATCH']);
});

test('no token, or a token provider that throws: a failure, GitHub not called', async () => {
  const none = setup({ token: undefined });
  assert.strictEqual((await none.publisher.publish({ interactive: true })).ok, false);
  assert.strictEqual(none.calls.length, 0);

  const broken = setup({ tokenError: true });
  const out = await broken.publisher.publish({ interactive: true });
  assert.strictEqual(out.ok, false);
  assert.match((out as { message: string }).message, /keychain locked/);
  assert.strictEqual(broken.calls.length, 0);
});

test('several accounts: asks which one; cancelling stops, choosing remembers it', async () => {
  const cancelled = setup({ accounts: [alice, bob] });
  assert.strictEqual((await cancelled.publisher.publish({ interactive: true })).ok, false);
  assert.strictEqual(cancelled.calls.length, 0);

  const chosen = setup({ accounts: [alice, bob], choose: bob });
  assert.strictEqual((await chosen.publisher.publish({ interactive: true })).ok, true);
  assert.strictEqual(chosen.getState()?.accountId, 'b1');
});

test('the remembered account is used without asking; a removed account starts over with a new gist', async () => {
  const remembered = setup({ accounts: [alice, bob], state: { gistId: 'g1', accountId: 'b1', owner: 'bob', hash: 'old' } });
  await remembered.publisher.publish({ interactive: true });
  assert.strictEqual(remembered.calls[0].method, 'PATCH');

  const removed = setup({ accounts: [alice], state: { gistId: 'old', accountId: 'gone', owner: 'x', hash: 'old' } });
  await removed.publisher.publish({ interactive: true });
  assert.strictEqual(removed.calls[0].method, 'POST');
  assert.strictEqual(removed.getState()?.accountId, 'a1');
});

test('publishes are serialised: a second call waits for the first', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const t = setup({ gate });
  const first = t.publisher.publish({ interactive: true });
  const second = t.publisher.publish({ interactive: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(t.calls.length, 1);
  release();
  await Promise.all([first, second]);
  assert.deepStrictEqual(t.calls.map((c) => c.method), ['POST', 'PATCH']);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsc -p tsconfig.json; node --test out/test/badgePublisher.test.js`
Expected: `tsc` error `Cannot find module '../badgePublisher'`.

- [ ] **Step 3: Write the implementation**

Create `src/badgePublisher.ts`:

```ts
'use strict';

import * as crypto from 'crypto';
import { Badge, BadgeSource, buildBadges } from './badgeModel';
import { renderBadge } from './badgeSvg';
import { HttpJson, gistRawUrl, publishGist } from './gistClient';

export interface BadgeAccount {
  id: string;
  username: string;
}

/** What is remembered between runs (globalState). `hash` is of the rendered SVGs, to skip no-op refreshes. */
export interface PublishedState {
  gistId: string;
  accountId: string;
  owner: string;
  hash: string;
}

export interface BadgePublisherDeps {
  source: BadgeSource;
  /** GitHub accounts on github.com that can have a token. */
  accounts(): Promise<BadgeAccount[]>;
  /** Only called when no remembered account applies and there is more than one. */
  chooseAccount(accounts: BadgeAccount[]): Promise<BadgeAccount | undefined>;
  /** `interactive: false` must never show UI. */
  token(accountId: string, interactive: boolean): Promise<string | undefined>;
  http: HttpJson;
  state: { get(): PublishedState | undefined; set(state: PublishedState): void };
}

export type PublishOutcome = { ok: true; changed: boolean; markdown: string } | { ok: false; message: string };

const fail = (message: string): PublishOutcome => ({ ok: false, message });

const markdownFor = (badges: Badge[], owner: string, id: string): string =>
  badges.map((b) => `![${b.label}](${gistRawUrl(owner, id, b.file)})`).join('\n');

export class BadgePublisher {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: BadgePublisherDeps) {}

  /**
   * Interactive (a user command) may pick an account, sign in and always pushes. Non-interactive (the hourly
   * refresh) only updates an existing gist, silently, and skips when nothing changed. Calls run one at a time;
   * never rejects.
   */
  publish(opts: { interactive: boolean }): Promise<PublishOutcome> {
    const run = this.tail.then(() => this.run(opts.interactive));
    this.tail = run;
    return run;
  }

  private async run(interactive: boolean): Promise<PublishOutcome> {
    try {
      const { deps } = this;
      const badges = buildBadges(deps.source);
      const files = badges.map((b) => ({ name: b.file, content: renderBadge(b.label, b.value, b.color) }));
      const hash = crypto.createHash('sha1').update(files.map((f) => f.content).join('\n')).digest('hex');
      const accounts = await deps.accounts();
      const prior = deps.state.get();

      let account = accounts.find((a) => a.id === prior?.accountId);
      if (!account) {
        if (!interactive) return fail('Badges have not been published yet.');
        if (accounts.length === 0) return fail('Add a GitHub account (github.com) in Null Accounts first.');
        account = accounts.length === 1 ? accounts[0] : await deps.chooseAccount(accounts);
        if (!account) return fail('Cancelled.');
      }

      const existing = prior?.accountId === account.id ? prior : undefined;
      if (!interactive && existing?.hash === hash) {
        return { ok: true, changed: false, markdown: markdownFor(badges, existing.owner, existing.gistId) };
      }

      const token = await deps.token(account.id, interactive);
      if (!token) {
        return fail(interactive ? 'GitHub did not provide a token with the gist scope.' : 'No GitHub token is available without signing in.');
      }
      const result = await publishGist(deps.http, token, existing?.gistId, files);
      if (!result.ok) return result;
      deps.state.set({ gistId: result.id, accountId: account.id, owner: result.owner, hash });
      return { ok: true, changed: true, markdown: markdownFor(badges, result.owner, result.id) };
    } catch (err) {
      return fail(`Could not publish badges (${err instanceof Error ? err.message : String(err)}).`);
    }
  }
}
```

- [ ] **Step 4: Register the test and run it**

In `package.json`, append ` out/test/badgePublisher.test.js` to the `node --test …` list in the `test` script.

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src/badgePublisher.ts extensions/null-activity/src/test/badgePublisher.test.ts extensions/null-activity/package.json
git commit -m "feat(null-activity): publish badges through null-accounts"
```

---

### Task 5: Commands, setting and wiring

**Files:**
- Create: `src/badgeCommands.ts`
- Modify: `src/extension.ts`, `package.json`

**Interfaces:**
- Consumes: `BadgePublisher`, `BadgeAccount`, `PublishedState` (Task 4); `buildBadges` (Task 2); `renderBadge` (Task 1); `fetchJson` (Task 3); `ActivityService` (`enabled`, `getDailyStats`, `getLanguageStats`).
- Produces: `registerBadges(context: vscode.ExtensionContext, service: ActivityService, log: (message: string) => void): void`; commands `null-activity.publishBadges`, `null-activity.saveBadges`; setting `null-activity.badge.autoPublish`.

This glue touches `vscode`, the clipboard and a real GitHub account, so it has no unit test (everything it decides is covered by Tasks 1–4); Task 6 verifies it by hand.

- [ ] **Step 1: Create the glue**

Create `src/badgeCommands.ts`:

```ts
'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { buildBadges } from './badgeModel';
import { BadgeAccount, BadgePublisher, PublishedState } from './badgePublisher';
import { renderBadge } from './badgeSvg';
import { fetchJson } from './gistHttp';

const STATE_KEY = 'null-activity.badge';
const REFRESH_MS = 60 * 60_000;
const FIRST_REFRESH_MS = 60_000;

/** The part of null-accounts' public API used here (a separate extension, so no shared import). */
interface AccountRecord {
  id: string;
  provider: string;
  host: string;
  username: string;
  authMethod: string;
}
interface AccountsApi {
  getAccounts(): AccountRecord[];
  getToken(account: AccountRecord, scopes?: string[], options?: { interactive?: boolean }): Promise<string | undefined>;
}

export function registerBadges(context: vscode.ExtensionContext, service: ActivityService, log: (message: string) => void): void {
  const accountsApi = async () => vscode.extensions.getExtension<AccountsApi>('null.null-accounts')?.activate();

  const publisher = new BadgePublisher({
    source: service,
    accounts: async (): Promise<BadgeAccount[]> =>
      (await accountsApi())?.getAccounts().filter((a) => a.provider === 'github' && a.host === 'github.com' && a.authMethod !== 'ssh') ?? [],
    chooseAccount: async (accounts) =>
      (await vscode.window.showQuickPick(
        accounts.map((account) => ({ label: `@${account.username}`, account })),
        { placeHolder: 'Publish badges with which GitHub account?' },
      ))?.account,
    token: async (accountId, interactive) => {
      const api = await accountsApi();
      const account = api?.getAccounts().find((a) => a.id === accountId);
      return api && account ? api.getToken(account, ['gist'], { interactive }) : undefined;
    },
    http: fetchJson,
    state: {
      get: () => context.globalState.get<PublishedState>(STATE_KEY),
      set: (state) => void context.globalState.update(STATE_KEY, state),
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('null-activity.publishBadges', async () => {
      if (!context.globalState.get(STATE_KEY)) {
        const answer = await vscode.window.showWarningMessage(
          'Publish three badges to a secret GitHub Gist? It contains only your total coding time, daily average and top language. Anyone with the link can view it.',
          { modal: true },
          'Publish',
        );
        if (answer !== 'Publish') return;
      }
      const outcome = await publisher.publish({ interactive: true });
      if (!outcome.ok) {
        void vscode.window.showErrorMessage(`Null Activity: ${outcome.message}`);
        return;
      }
      await vscode.env.clipboard.writeText(outcome.markdown);
      void vscode.window.showInformationMessage('Null Activity: badges published. The Markdown for your README is on the clipboard.');
    }),

    vscode.commands.registerCommand('null-activity.saveBadges', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Save Badges Here',
      });
      if (!picked) return;
      try {
        for (const b of buildBadges(service)) fs.writeFileSync(path.join(picked[0].fsPath, b.file), renderBadge(b.label, b.value, b.color));
        void vscode.window.showInformationMessage(`Null Activity: saved 3 badges to ${picked[0].fsPath}.`);
      } catch (err) {
        void vscode.window.showErrorMessage(`Null Activity: could not save badges (${err instanceof Error ? err.message : String(err)}).`);
      }
    }),
  );

  const refresh = () => {
    if (!service.enabled || !vscode.workspace.getConfiguration('null-activity').get('badge.autoPublish')) return;
    void publisher.publish({ interactive: false }).then((outcome) =>
      log(outcome.ok ? (outcome.changed ? 'Badges refreshed.' : 'Badges unchanged.') : `Badge refresh skipped: ${outcome.message}`),
    );
  };
  const first = setTimeout(refresh, FIRST_REFRESH_MS);
  const timer = setInterval(refresh, REFRESH_MS);
  context.subscriptions.push({ dispose: () => { clearTimeout(first); clearInterval(timer); } });
}
```

- [ ] **Step 2: Wire it into `extension.ts`**

In `src/extension.ts`, add the import after `import { registerCommands } from './commands';`:

```ts
import { registerBadges } from './badgeCommands';
```

(keep imports alphabetical: place it before `./commands`), and after the `registerCommands(context, service, storageDir, dashboard);` line add:

```ts
  registerBadges(context, service, (message) => output.appendLine(message));
```

- [ ] **Step 3: Declare commands and the setting**

In `package.json`, add to `contributes.commands` (after the `deleteAll` entry, adding a comma):

```json
      { "command": "null-activity.publishBadges", "title": "Null Activity: Publish Badges to a Gist…" },
      { "command": "null-activity.saveBadges", "title": "Null Activity: Save Badges as SVG…" }
```

and to `contributes.configuration.properties` (after `sessionGap`, adding a comma):

```json
        "null-activity.badge.autoPublish": {
          "type": "boolean",
          "default": false,
          "description": "Refresh the published badge Gist about once an hour while Null IDE is open. Only updates a Gist you already published with \"Publish Badges to a Gist\"; sends your total coding time, daily average and top language to GitHub."
        }
```

- [ ] **Step 4: Compile and run the tests**

Run: `npm test`
Expected: `tsc` compiles with no errors; all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-activity/src/badgeCommands.ts extensions/null-activity/src/extension.ts extensions/null-activity/package.json
git commit -m "feat(null-activity): publish and save badges from commands"
```

---

### Task 6: Docs, compiled output and verification

**Files:**
- Modify: `CLAUDE.md` (repo root), `extensions/null-activity/out/` (generated)

- [ ] **Step 1: Update CLAUDE.md**

In the `### null-activity` paragraph of `CLAUDE.md`:

1. Replace `(issue #113; engine, dashboard and git statistics — badge and WakaTime import are later specs)` with `(issue #113; engine, dashboard, git statistics and badges — WakaTime import is a later spec)`.
2. Replace `No network code.` with `The only network code is `gistHttp.ts` (opt-in badge publishing); the engine, dashboard and git code have none.`
3. Insert before `Designs:` a new sentence: `**Badges** (`badgeModel.ts` + `badgeSvg.ts` pure: total time, average per active day and top language, flat shields-style SVG; `gistClient.ts` + `badgePublisher.ts` with injected deps and no `vscode`; `badgeCommands.ts` is the `vscode` glue): `null-activity.saveBadges` writes the three SVGs to a folder; `null-activity.publishBadges` publishes them to one secret Gist through null-accounts (`getToken(account, ['gist'], …)`, github.com accounts only) after a one-time consent modal, remembers `{ gistId, accountId, owner, hash }` in `globalState` (`null-activity.badge`) and copies the README Markdown. `null-activity.badge.autoPublish` (default off) only refreshes that Gist hourly with a silent token, skips unchanged content, and does nothing while `null-activity.enabled` is off.`
4. Append `docs/specs/null-activity-badge-design.md` to the designs list and `docs/plans/null-activity-badge.md` to the plans list.

- [ ] **Step 2: Refresh the compiled output**

Run: `npm run compile`
Expected: no errors. Then `git status --short extensions/null-activity` shows only new/changed `out/` files for the badge modules and `extension.js`.

- [ ] **Step 3: Full test run**

Run: `npm test`
Expected: all tests PASS, no skipped badge files (the count includes the four new files).

- [ ] **Step 4: Commit docs and output separately**

```bash
git add CLAUDE.md
git commit -m "docs: document null-activity badges"
git add extensions/null-activity/out
git commit -m "chore: refresh null-activity compiled output"
```

- [ ] **Step 5: Verify against the real app**

Run `/verify-local null-activity` (syncs the build into the installed Null IDE and runs the existing integration specs).
Expected: existing specs still pass.

Then by hand in that Null IDE — **ask the user before this step: it publishes to their real GitHub account**:
1. `Null Activity: Save Badges as SVG…` → pick a folder → open the three files in a browser; they render, labels are readable and not clipped.
2. `Null Activity: Publish Badges to a Gist…` → the consent modal appears → confirm → GitHub may ask for the `gist` scope → "badges published" and the clipboard holds three Markdown lines; open one URL, it serves the SVG.
3. Run it again: the same Gist is updated (no second Gist on github.com).
4. Delete the Gist on github.com, run the command again: a new Gist is created.
5. Set `null-activity.badge.autoPublish` to `true`, reload; after about a minute the Output channel "Null Activity" shows `Badges unchanged.` or `Badges refreshed.`

---

## Self-Review

- **Spec coverage:** three badges and file names (Task 2), flat renderer with escaping (Task 1), secret Gist create/update/recreate-on-404 and raw URLs (Task 3), account selection, token scope, opt-in rules, hash skip, serialisation, state (Task 4), consent modal, save command, auto-publish setting, clipboard Markdown (Task 5), network confined to `gistHttp.ts` (Task 3, constraint), docs (Task 6). Out-of-scope items (unpublish, GHE/GitLab, ranges, styles) have no task by design.
- **Placeholders:** none; every step has code or an exact command.
- **Types:** `Badge`/`BadgeSource` (Task 2) are used unchanged in Task 4 and 5; `HttpJson`/`PublishResult`/`gistRawUrl` (Task 3) match Task 4's use; `BadgeAccount`/`PublishedState` (Task 4) match Task 5; `publish({ interactive })` is called identically in Tasks 4 and 5.
- **Review Focus:** each of the five lines maps to a named test above.
