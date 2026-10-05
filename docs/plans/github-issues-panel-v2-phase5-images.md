# GitHub Issues Panel v2, Phase 5 (Images): Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Images in issues work end to end: they show as thumbnails in the detail tab and the composer preview (today they are text chips), pasting/dropping/attaching an image in any composer uploads it and inserts the markdown, and *Copy as prompt* includes the comments and the local file path of every image so Claude Code can Read them. This finishes #107.

**Architecture:** The webview can't load GitHub's images (they need a token it doesn't have, and its CSP only allows avatars), so the extension host downloads each image once into `.null/issue-images/` and the webview shows the local file through `asWebviewUri`. Pure URL/cache-name logic lives in `imageUrls.ts`, file cache and exclude handling in `imageCache.ts`, upload (orphan branch `null-issue-assets` + Contents API, one upload at a time) in `imageUpload.ts`. The webview side is one DOM file (`imageResolve.ts`) that swaps the `.img-placeholder` chips Phase 3 left behind, plus paste/drop/attach handling in the existing composer.

**Tech Stack:** TypeScript 5.8, VS Code extension API (`^1.85.0`), Node `https`/`fs`/`crypto`, vanilla DOM webviews, GitHub REST (git data + contents APIs), `node:test`.

**Spec:** [docs/specs/github-issues-panel-v2-design.md](../specs/github-issues-panel-v2-design.md) (this plan covers "Delivery phases → 5. Images (#107)" and the "Images (#107)" section). Phases 1–4 are on `main`. Phase 6 (branch → issue, #54) is a separate plan.

**Deviations from the spec's Images section** (each one is deliberate):
- **The token goes only to `github.com` and `api.github.com`, and only on the first request.** The spec said every `*.githubusercontent.com` host. Verified live (2026-10-05) that the signed `private-user-images.githubusercontent.com` URLs load with no token, so the token never has to leave GitHub's own hosts, and redirects (which land on signed storage URLs) never carry it.
- **The cache key drops the query string for `private-user-images.githubusercontent.com` URLs only.** GitHub re-signs those (`?jwt=…`, 5-minute expiry) on every detail fetch, so keying on the full URL would re-download the same image on every refresh and grow the cache without bound. Every other URL keeps its query.
- **The file extension comes from the response's content type, else from the URL's file name.** The Contents API with the raw media type answers `application/vnd.github.raw+json` (verified live), so the content type alone can't name the type. A non-image content type (an HTML error page) is refused even if the URL ends in `.png`.
- **The exclude line is `**/.null/issue-images/`** (not `.null/issue-images/`) so it also matches when the workspace folder is a subfolder of the repo, and the file is found with `git rev-parse --git-path info/exclude` so linked worktrees (`.git` is a file there) write to the shared exclude file.
- **The detail webview's `localResourceRoots` gains `<workspace>/.null/issue-images`.** The spec only said the CSP stays; without this, `asWebviewUri` files outside `lib/` don't load.
- **`resolveImage(url, { root, token })` and `uploadImage(repo, token, file)`** replace the spec's `resolveImage(url)` / `uploadImage(bytes, filename)`: the host layer is vscode-free and takes what it needs, so `node --test` can exercise it with a stub network. `cacheFileName(url, ext)` takes the extension, not the content type.
- **The upload stand-in text is `![Uploading name…](#upload-<n>)`**, unique per upload, so two pastes of `image.png` can't swap each other's result. The spec had `![Uploading name…]()`.
- **No reserved size for a loading thumbnail.** The layout shifts when an image appears. `ponytail:` comment in `imageResolve.ts`; add `width`/`height` from the `<img>` tag if it bothers anyone.
- **Copy as prompt** pages the whole conversation (up to 1000 timeline items), leaves out collapsed (minimized) comments, downloads at most 30 images, and when comments or images can't be fetched still copies what it has and shows a warning. The spec only said "resolves every image first".
- **The toolbar's attach button is outside `COMPOSER_TOOLS`** (that list is text edits only, and its test pins it at 9 entries).
- Verified against live GitHub on 2026-10-05, read-only, on `TorresVisual/null-ide` (private): (1) issue images in `bodyHTML` are `<img … src="https://private-user-images.githubusercontent.com/<uid>/<id>-<uuid>.png?jwt=…&amp;…">` (the `&` is entity-encoded) with `width`/`height`/`style` attributes; (2) such a URL answers `200 image/png` with and without `Authorization`; (3) `GET /repos/…/contents/<file>?ref=` with `Accept: application/vnd.github.raw+json` answers the raw bytes with `Content-Type: application/vnd.github.raw+json; charset=utf-8`; (4) `POST /markdown` (gfm, repo context) renders `![x](https://github.com/o/r/blob/<branch>/<path>?raw=true)` as `<a …><img src="https://github.com/o/r/blob/<branch>/<path>?raw=true"></a>`, and renders a `github.com/user-attachments/assets/<uuid>` link as the signed private-user-images URL; (5) the `null-issue-assets` branch doesn't exist yet (`GET git/ref/heads/null-issue-assets` → 404). **Not verified:** the upload endpoints (blob → tree → commit → ref, contents PUT), because running them creates a branch in a real repo. Task 5 ends with a live smoke test that needs the user's go-ahead for a repo.

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

- Work only inside `D:\Coding\Apps\null-ide\` (CLAUDE.md scope rule). All paths below are relative to `extensions/null-tools/` unless they start with `docs/` or `CLAUDE.md`. Run all `npm`/`npx` commands from `extensions/null-tools/`.
- Edit TypeScript sources only; never hand-edit compiled output (`out/*.js`, `lib/issues.js`, `lib/issueDetail.js`, `out/webview-shared.js`). `out/` and `lib/*.js` **are tracked in git**: after `npm run compile`, stage the compiled files that belong to the task in the same commit as their source. The tree is clean before each task, so `git status --short` then `git add -A .` (from `extensions/null-tools/`) stages exactly the task's source plus its compiled output. Never stage anything else. `npm test` compiles `out/` too (host `tsc` + the shared webview bundle); `npm run compile` is what builds `lib/issueDetail.js`.
- Unit tests only cover files that don't `import 'vscode'` (repo convention): `imageUrls.ts`, `imageCache.ts`, `imageUpload.ts` and `promptFormat.ts` must stay vscode-free. The main `tsconfig.json` has an explicit `include` list: every new `*.test.ts` must be added there *and* to the `test` script in `package.json`. Webview helpers are tested through `tsconfig.webview-shared.json` → `out/webview-shared.js` (see `src/webviewComposer.test.ts`).
- Webview files are `module: none` scripts: no `import`/`export`. Top-level names share one global scope per bundle, so every top-level identifier must be unique across all files of a bundle (`grep -rn "function <name>" src/webview` before adding one). `issueDetail.ts` already declares `DOMPurify` and `acquireVsCodeApi` globally.
- Objects created inside the `vm` sandbox have a different `Object.prototype`/`Array.prototype`: copy with `JSON.parse(JSON.stringify(x))` (the `plain` helper in the test) before `assert.deepStrictEqual`.
- No new runtime or dev dependencies: Node's `https`, `fs`, `crypto`, `child_process` only.
- **The GitHub token is only ever sent to `github.com` / `api.github.com`, on the first request of a fetch, never on a redirect hop** (`tokenForUrl`). Only `https:` URLs are fetched.
- Interpolate only escaped text into webview `innerHTML`. Anything that reaches the DOM from GitHub HTML still goes through `neutralizeImagesHtml` + `DOMPurify.sanitize`; the thumbnail `<img>` is built with DOM properties (`img.src`, `img.alt`), never string markup.
- Colors: theme variables only (`var(--vscode-*)`), no hex fallbacks in new CSS.
- Commit messages: conventional style (`feat(null-tools): …`), ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Don't push.

## Review Focus

1. **The token reaching a host that isn't GitHub's own.** A redirect from `github.com/user-attachments/…` to signed storage, a look-alike host (`github.com.evil.example`, `https://github.com@evil.example/`), `http:`/`file:`/`data:` URLs. Pinned in Task 1 (`tokenForUrl …`, `imageFetchPlan refuses …`); the redirect hop itself is manual, Task 7 scenario 1 (it runs through `fetchBytes`, which needs HTTPS and is not unit-testable).
2. **A refresh re-downloading every image, or writing the cache forever.** GitHub re-signs private image URLs on each fetch; the same image must map to the same file, a half-written file must never count as a cache hit, and the same URL requested twice at once must download once. Pinned in Task 1 (`cacheKeyUrl …`) and Task 2 (`resolveImage downloads once …`, `… shares one download …`).
3. **Something that isn't an image ending up in the cache or on the branch.** An HTML login/error page served with a `.png` URL, an oversized file, a `.png.exe`, an SVG (displayed only through `<img>`, which never runs scripts). Pinned in Task 1 (`imageExtension refuses …`), Task 2 (`resolveImage rejects …`), Task 5 (`checkUpload …`). Known limit, not covered: an upload is judged by the reported type and file name, not its bytes.
4. **Uploads racing each other.** Three screenshots pasted in a row must create the `null-issue-assets` branch once (a second `POST git/refs` answers 422), commit one at a time (parallel commits to one branch conflict), and a failed upload must not poison the next one or leave a stale "branch exists" belief. Pinned in Task 5 (`uploadImage …` tests with a fake API).
5. **A paste that was meant as text, or a stand-in that never goes away.** Copying a spreadsheet cell puts text *and* an image on the clipboard: the text must paste. A failed or refused upload must remove its `![Uploading…](#upload-n)` stand-in and say why; a stand-in the user already deleted must not be re-inserted. Pinned in Task 6 (`replacePlaceholder …`, `insertAtCaret …`); the text-paste rule and the failure path are manual, Task 7 scenarios 7 and 8.

---

### Task 1: URL and cache-name helpers (`imageUrls.ts`)

**Files:**
- Create: `src/github/imageUrls.ts`
- Create: `src/github/imageUrls.test.ts`
- Modify: `tsconfig.json` (`include`), `package.json` (`test` script)

**Interfaces:**
- Consumes: nothing from earlier tasks (Node `crypto` only).
- Produces (all pure, vscode-free):
  - `IMAGE_TYPES: Record<string, string>` (ext → MIME for `png jpg gif webp svg`), `MAX_IMAGE_BYTES = 10 * 1024 * 1024`
  - `extractImageUrls(html: string): string[]` — entity-decoded `src` of every non-emoji `<img>`, no repeats, in order
  - `imageExtension(contentType: string | null, url: string): string | null`
  - `cacheKeyUrl(url: string): string`, `cacheFileName(url: string, ext: string): string`, `cacheFileNames(url: string): string[]`
  - `type ImageFetchPlan = { kind: 'contents'; owner: string; repo: string; ref: string; path: string } | { kind: 'direct'; url: string }`, `imageFetchPlan(url: string): ImageFetchPlan | null`
  - `tokenForUrl(url: string, token: string | null, hop: number): string | null`

- [ ] **Step 1: Write the failing test**

Create `src/github/imageUrls.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import {
  cacheFileName, cacheFileNames, cacheKeyUrl, extractImageUrls, imageExtension, imageFetchPlan, tokenForUrl,
} from './imageUrls';

const SIGNED = 'https://private-user-images.githubusercontent.com/91338024/659308528-2aaf4603-a019-489f-82f2-9a57c6854c55.png';

test('extractImageUrls decodes entities (signed URLs carry &amp;), skips emoji and repeats, ignores data-canonical-src', () => {
  const html = `<p><a href="x"><img width="10" alt="Image" src="${SIGNED}?jwt=a.b&amp;x=1" class="js-gh-image-fallback"></a>`
    + '<img class="emoji" alt="👍" src="https://github.githubassets.com/e.png">'
    + `<img src="${SIGNED}?jwt=a.b&amp;x=1">`
    + '<img data-canonical-src="https://x/orig.png" src="https://camo.githubusercontent.com/abc"></p>';
  assert.deepStrictEqual(extractImageUrls(html), [`${SIGNED}?jwt=a.b&x=1`, 'https://camo.githubusercontent.com/abc']);
});

test('extractImageUrls decodes one level only and finds nothing in markup without images', () => {
  assert.deepStrictEqual(extractImageUrls('<img src="https://x/a?q=&amp;lt;">'), ['https://x/a?q=&lt;']);
  assert.deepStrictEqual(extractImageUrls('<p>no pictures, just <code>&lt;img&gt;</code></p>'), []);
  assert.deepStrictEqual(extractImageUrls(''), []);
});

test('imageExtension trusts a real image content type, and falls back to the file name for GitHub raw answers', () => {
  assert.strictEqual(imageExtension('image/png', 'https://x/y'), 'png');
  assert.strictEqual(imageExtension('image/jpeg; charset=x', 'https://x/y'), 'jpg');
  assert.strictEqual(imageExtension('image/svg+xml', 'https://x/y'), 'svg');
  assert.strictEqual(
    imageExtension('application/vnd.github.raw+json; charset=utf-8', 'https://github.com/o/r/blob/b/2026/10/a.PNG?raw=true'), 'png');
  assert.strictEqual(imageExtension(null, 'https://x/a.jpeg'), 'jpg');
  assert.strictEqual(imageExtension('application/octet-stream', 'https://x/a.webp'), 'webp');
});

test('imageExtension refuses what is not a stored image type: HTML error pages, other images, unknown names', () => {
  assert.strictEqual(imageExtension('text/html; charset=utf-8', 'https://x/a.png'), null);
  assert.strictEqual(imageExtension('application/json', 'https://x/a.png'), null);
  assert.strictEqual(imageExtension('image/tiff', 'https://x/a.png'), null);
  assert.strictEqual(imageExtension(null, 'https://x/a.exe'), null);
  assert.strictEqual(imageExtension(null, 'https://x/a.png.exe'), null);
  assert.strictEqual(imageExtension(null, 'https://x/a.constructor'), null);
  assert.strictEqual(imageExtension(null, 'https://x/noextension'), null);
  assert.strictEqual(imageExtension(null, 'not a url'), null);
});

test('cacheKeyUrl ignores the jwt GitHub re-signs private images with, but nothing else', () => {
  assert.strictEqual(cacheKeyUrl(`${SIGNED}?jwt=AAA`), cacheKeyUrl(`${SIGNED}?jwt=BBB&x=1`));
  assert.notStrictEqual(cacheKeyUrl('https://camo.githubusercontent.com/a'), cacheKeyUrl('https://camo.githubusercontent.com/b'));
  assert.notStrictEqual(cacheKeyUrl('https://example.com/i?id=1'), cacheKeyUrl('https://example.com/i?id=2'));
  assert.strictEqual(cacheKeyUrl('not a url'), 'not a url');
});

test('cache file names are stable, flat, and cover every stored type', () => {
  const names = cacheFileNames(`${SIGNED}?jwt=AAA`);
  assert.strictEqual(names.length, 5);
  assert.ok(names.includes(cacheFileName(`${SIGNED}?jwt=BBB`, 'png')));
  for (const name of names) assert.match(name, /^[0-9a-f]{40}\.(png|jpg|gif|webp|svg)$/);
});

test('imageFetchPlan sends repo file links through the Contents API and everything else straight out', () => {
  assert.deepStrictEqual(
    imageFetchPlan('https://github.com/TorresVisual/null-ide/blob/null-issue-assets/2026/10/a%20b.png?raw=true'),
    { kind: 'contents', owner: 'TorresVisual', repo: 'null-ide', ref: 'null-issue-assets', path: '2026/10/a b.png' });
  assert.deepStrictEqual(
    imageFetchPlan('https://github.com/o/r/raw/main/x.png'), { kind: 'contents', owner: 'o', repo: 'r', ref: 'main', path: 'x.png' });
  assert.deepStrictEqual(
    imageFetchPlan('https://github.com/user-attachments/assets/2aaf4603'),
    { kind: 'direct', url: 'https://github.com/user-attachments/assets/2aaf4603' });
  assert.deepStrictEqual(imageFetchPlan(`${SIGNED}?jwt=a`), { kind: 'direct', url: `${SIGNED}?jwt=a` });
});

test('imageFetchPlan refuses non-https URLs, other schemes and garbage, without throwing', () => {
  for (const url of ['http://github.com/a.png', 'file:///C:/a.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'nope', '']) {
    assert.strictEqual(imageFetchPlan(url), null, url);
  }
  assert.strictEqual(imageFetchPlan('https://github.com/o/r/blob/main/%zz.png'), null);
});

test('tokenForUrl gives the token to GitHub itself on the first request only', () => {
  assert.strictEqual(tokenForUrl('https://github.com/user-attachments/assets/1', 't', 0), 't');
  assert.strictEqual(tokenForUrl('https://api.github.com/repos/o/r/contents/a.png', 't', 0), 't');
  assert.strictEqual(tokenForUrl('https://github.com/user-attachments/assets/1', 't', 1), null); // a redirect hop
  assert.strictEqual(tokenForUrl('https://private-user-images.githubusercontent.com/1/2.png', 't', 0), null);
  assert.strictEqual(tokenForUrl('https://camo.githubusercontent.com/abc', 't', 0), null);
  assert.strictEqual(tokenForUrl('https://github.com.evil.example/a.png', 't', 0), null);
  assert.strictEqual(tokenForUrl('https://github.com@evil.example/a.png', 't', 0), null);
  assert.strictEqual(tokenForUrl('https://evil.example/?github.com', 't', 0), null);
  assert.strictEqual(tokenForUrl('https://github.com/a.png', null, 0), null);
  assert.strictEqual(tokenForUrl('nope', 't', 0), null);
});
```

- [ ] **Step 2: Register the test and run it to verify it fails**

In `tsconfig.json`, add `"src/github/imageUrls.test.ts"` to the `include` array right after `"src/github/createExtras.test.ts"`. In `package.json`, append ` out/github/imageUrls.test.js` to the end of the `node --test …` list in the `test` script.

Run: `npm test`
Expected: FAIL at the first `tsc` step: `Cannot find module './imageUrls'`.

- [ ] **Step 3: Write the implementation**

Create `src/github/imageUrls.ts`:

```ts
'use strict';

// Pure URL logic for issue images: which URLs in rendered HTML are real images, where each one is fetched from,
// whether the token may be sent, and what the cached file is called. No fs and no network, so node:test runs it.

import { createHash } from 'crypto';

/** The image types the panel stores and uploads, by file extension. */
export const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const ENTITIES: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };

/** One pass, so `&amp;lt;` becomes `&lt;` and not `<`. */
const decodeEntities = (text: string): string => text.replace(/&(?:amp|quot|#39|lt|gt);/g, entity => ENTITIES[entity]);

/**
 * The `src` of every non-emoji `<img>` in GitHub-rendered HTML, in order and without repeats. Entity-decoded:
 * GitHub writes the `&` of a signed URL's query as `&amp;`.
 */
export function extractImageUrls(html: string): string[] {
  const urls: string[] = [];
  for (const tag of html.match(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    if (/\bclass="[^"]*\bemoji\b/i.test(tag)) continue;
    const src = /\ssrc="([^"]*)"/i.exec(tag)?.[1]; // `\s` so data-canonical-src doesn't match
    if (!src) continue;
    const url = decodeEntities(src);
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** Content types that don't say what the bytes are (the Contents API's raw media type is one), so the file name decides. */
const UNINFORMATIVE_TYPES = ['', 'application/octet-stream', 'binary/octet-stream'];

/**
 * The extension to store an image under, or null when it isn't one of IMAGE_TYPES. A content type that names
 * something else (an HTML error page, a TIFF) wins over a misleading file name.
 */
export function imageExtension(contentType: string | null, url: string): string | null {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  const byType = Object.keys(IMAGE_TYPES).find(ext => IMAGE_TYPES[ext] === type);
  if (byType) return byType;
  if (!UNINFORMATIVE_TYPES.includes(type) && !type.startsWith('application/vnd.github.raw')) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const ext = /\.([a-z0-9]+)$/i.exec(pathname)?.[1].toLowerCase();
  const normalized = ext === 'jpeg' ? 'jpg' : ext;
  return normalized && Object.keys(IMAGE_TYPES).includes(normalized) ? normalized : null; // not `in`: that also matches "constructor"
}

/**
 * The URL minus what changes without the image changing. GitHub re-signs `private-user-images` links (`?jwt=…`, valid
 * for 5 minutes) on every fetch, so the same image would otherwise be downloaded again on each refresh.
 * Other hosts keep their query: `example.com/i?id=1` and `?id=2` are different images.
 */
export function cacheKeyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'private-user-images.githubusercontent.com') {
      u.search = '';
      u.hash = '';
    }
    return u.href;
  } catch {
    return url;
  }
}

const cacheBaseName = (url: string): string => createHash('sha1').update(cacheKeyUrl(url)).digest('hex');

export const cacheFileName = (url: string, ext: string): string => `${cacheBaseName(url)}.${ext}`;

/** Every file name a cached copy of `url` could have (the type isn't known before a download), for the existence probe. */
export function cacheFileNames(url: string): string[] {
  const base = cacheBaseName(url);
  return Object.keys(IMAGE_TYPES).map(ext => `${base}.${ext}`);
}

export type ImageFetchPlan =
  | { kind: 'contents'; owner: string; repo: string; ref: string; path: string }
  | { kind: 'direct'; url: string };

/**
 * How to download `url`: a file in a repo (`github.com/o/r/blob/<ref>/<path>`, what uploaded images link to) goes
 * through the Contents API; everything else is fetched as is. null for anything that isn't a plain https URL.
 * `ref` can't contain a slash: a branch like `feature/x` fails to resolve and the image just stays a chip.
 */
export function imageFetchPlan(url: string): ImageFetchPlan | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const m = u.hostname === 'github.com' ? /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/.exec(u.pathname) : null;
  if (!m) return { kind: 'direct', url: u.href };
  try {
    return { kind: 'contents', owner: m[1], repo: m[2], ref: decodeURIComponent(m[3]), path: decodeURIComponent(m[4]) };
  } catch {
    return null; // malformed %-escape
  }
}

/**
 * The token for one request of an image fetch: only GitHub's own hosts, only the first request. A redirect (to a signed
 * storage URL, say) must never carry it, and `github.com.evil.example` or `github.com@evil.example` aren't GitHub.
 */
export function tokenForUrl(url: string, token: string | null, hop: number): string | null {
  if (!token || hop > 0) return null;
  try {
    const host = new URL(url).hostname;
    return host === 'github.com' || host === 'api.github.com' ? token : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all existing tests plus the nine new `imageUrls` ones).

- [ ] **Step 5: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): add pure URL and cache-name helpers for Issues images" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Image download and local cache (`imageCache.ts`, `fetchBytes`, store method)

**Files:**
- Create: `src/github/imageCache.ts`
- Create: `src/github/imageCache.test.ts`
- Modify: `src/github/githubApi.ts` (imports, `fetchBytes`, `fetchRepoFile`), `src/github/issuesStore.ts` (import + `resolveImage`), `tsconfig.json` (`include`), `package.json` (`test` script)

**Interfaces:**
- Consumes: Task 1's `IMAGE_TYPES`, `MAX_IMAGE_BYTES`, `cacheFileName`, `cacheFileNames`, `cacheKeyUrl`, `imageExtension`, `imageFetchPlan`, `ImageFetchPlan`, `tokenForUrl`; existing `getNullDir(root)` (`src/scratchNotesStorage.ts`), `ApiError`, `formatApiError`, `IssuesStore.ensureSession`.
- Produces:
  - `githubApi.ts`: `interface FetchedBytes { bytes: Buffer; contentType: string | null }`, `fetchBytes(url, token, accept, maxBytes, hop?): Promise<FetchedBytes>`, `fetchRepoFile(owner, repo, ref, filePath, token, maxBytes): Promise<FetchedBytes>`
  - `imageCache.ts`: `EXCLUDE_LINE = '**/.null/issue-images/'`, `issueImagesDir(root): string`, `withExcludeLine(existing, line): string`, `ensureExcluded(root, line?): void`, `interface ImageSource { root: string; token: string | null; fetch?: (plan: ImageFetchPlan, token: string | null) => Promise<FetchedBytes> }` (`ImageFetchPlan` here is the non-null plan), `resolveImage(url, source): Promise<string>` (absolute local path), `mapLimit(items, limit, fn): Promise<R[]>`
  - `IssuesStore.resolveImage(url: string): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `src/github/imageCache.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EXCLUDE_LINE, ensureExcluded, issueImagesDir, mapLimit, resolveImage, withExcludeLine } from './imageCache';
import { MAX_IMAGE_BYTES } from './imageUrls';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const SIGNED = 'https://private-user-images.githubusercontent.com/1/2-3.png';
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'null-img-'));
const git = (cwd: string, ...args: string[]): void => { execFileSync('git', args, { cwd, stdio: 'ignore' }); };

/** A network stand-in that answers with `bytes` and records how often it was asked. */
function stub(bytes: Buffer = PNG, contentType: string | null = 'image/png') {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (plan: { kind: string }) => { calls.push(plan.kind); return { bytes, contentType }; },
  };
}

test('resolveImage downloads once, then serves the cached file, even for a re-signed URL', async () => {
  const root = tmp();
  const net = stub();
  const first = await resolveImage(`${SIGNED}?jwt=AAA`, { root, token: 't', fetch: net.fetch });
  const second = await resolveImage(`${SIGNED}?jwt=BBB`, { root, token: 't', fetch: net.fetch });
  assert.strictEqual(first, second);
  assert.strictEqual(path.dirname(first), issueImagesDir(root));
  assert.deepStrictEqual(fs.readFileSync(first), PNG);
  assert.strictEqual(net.calls.length, 1);
  assert.deepStrictEqual(fs.readdirSync(issueImagesDir(root)), [path.basename(first)]); // no half-written .part left behind
});

test('resolveImage shares one download between simultaneous requests for the same image', async () => {
  const root = tmp();
  const net = stub();
  const [a, b] = await Promise.all([
    resolveImage(`${SIGNED}?jwt=AAA`, { root, token: null, fetch: net.fetch }),
    resolveImage(`${SIGNED}?jwt=BBB`, { root, token: null, fetch: net.fetch }),
  ]);
  assert.strictEqual(a, b);
  assert.strictEqual(net.calls.length, 1);
});

test('resolveImage rejects an HTML page served as an image and writes nothing', async () => {
  const root = tmp();
  await assert.rejects(
    resolveImage('https://github.com/user-attachments/assets/x.png', { root, token: null, fetch: stub(Buffer.from('<html>'), 'text/html').fetch }),
    /Not an image/);
  assert.strictEqual(fs.existsSync(issueImagesDir(root)), false);
});

test('resolveImage rejects a file over the size cap', async () => {
  const root = tmp();
  await assert.rejects(
    resolveImage(SIGNED, { root, token: null, fetch: stub(Buffer.alloc(MAX_IMAGE_BYTES + 1)).fetch }), /larger than/);
  assert.strictEqual(fs.existsSync(issueImagesDir(root)), false);
});

test('resolveImage refuses a URL it must not fetch, without calling the network', async () => {
  const net = stub();
  await assert.rejects(resolveImage('http://example.com/a.png', { root: tmp(), token: 't', fetch: net.fetch }), /Not a fetchable image URL/);
  assert.strictEqual(net.calls.length, 0);
});

test('a failed download is not remembered: the next request tries again', async () => {
  const root = tmp();
  let attempts = 0;
  const flaky = async () => {
    if (attempts++ === 0) throw new Error('offline');
    return { bytes: PNG, contentType: 'image/png' };
  };
  await assert.rejects(resolveImage(SIGNED, { root, token: null, fetch: flaky }), /offline/);
  assert.ok((await resolveImage(SIGNED, { root, token: null, fetch: flaky })).endsWith('.png'));
});

test('mapLimit keeps the order and never runs more than the limit at once', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async n => {
    running++;
    peak = Math.max(peak, running);
    await new Promise(resolve => setTimeout(resolve, 5));
    running--;
    return n * 2;
  });
  assert.deepStrictEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.strictEqual(peak, 2);
  assert.deepStrictEqual(await mapLimit([], 4, async n => n), []);
});

test('withExcludeLine appends the line once, keeping existing text and a trailing newline', () => {
  assert.strictEqual(withExcludeLine('', EXCLUDE_LINE), `${EXCLUDE_LINE}\n`);
  assert.strictEqual(withExcludeLine('# comment\n', EXCLUDE_LINE), `# comment\n${EXCLUDE_LINE}\n`);
  assert.strictEqual(withExcludeLine('# comment', EXCLUDE_LINE), `# comment\n${EXCLUDE_LINE}\n`);
  const done = `a\r\n${EXCLUDE_LINE}\r\n`;
  assert.strictEqual(withExcludeLine(done, EXCLUDE_LINE), done);
});

test('ensureExcluded writes the line once into a repository\'s info/exclude', () => {
  const repo = tmp();
  git(repo, 'init');
  ensureExcluded(repo);
  ensureExcluded(repo);
  const text = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
  assert.strictEqual(text.split('\n').filter(line => line === EXCLUDE_LINE).length, 1);
});

test('ensureExcluded from a linked worktree edits the shared exclude file (.git is a file there)', () => {
  const main = tmp();
  git(main, 'init');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init');
  const worktree = path.join(tmp(), 'wt');
  git(main, 'worktree', 'add', worktree, '-b', 'wt-branch');
  ensureExcluded(worktree);
  assert.ok(fs.readFileSync(path.join(main, '.git', 'info', 'exclude'), 'utf8').includes(EXCLUDE_LINE));
});

test('ensureExcluded outside a repository does nothing and does not throw', () => {
  assert.doesNotThrow(() => ensureExcluded(tmp()));
});
```

- [ ] **Step 2: Register the test and run it to verify it fails**

In `tsconfig.json`, add `"src/github/imageCache.test.ts"` after `"src/github/imageUrls.test.ts"`. In `package.json`, append ` out/github/imageCache.test.js` to the `test` script list.

Run: `npm test`
Expected: FAIL at `tsc`: `Cannot find module './imageCache'`.

- [ ] **Step 3: Add the byte transport to `githubApi.ts`**

Add to the imports at the top of `src/github/githubApi.ts` (after `import { stripPullRequests } from './issueFilter';`):

```ts
import { tokenForUrl } from './imageUrls';
```

Append at the end of the file:

```ts
export interface FetchedBytes { bytes: Buffer; contentType: string | null }

/**
 * GET a file as bytes (an image). `request()` above decodes the body as UTF-8, which would corrupt binary, so this is its
 * own transport. Redirects are followed by hand, up to 5, so the token (see `tokenForUrl`) is only ever sent on the first
 * request. A body past `maxBytes` aborts the download. Not unit-tested: it needs HTTPS (Task 7, scenario 1).
 */
export function fetchBytes(url: string, token: string | null, accept: string, maxBytes: number, hop = 0): Promise<FetchedBytes> {
  return new Promise((resolve, reject) => {
    if (hop > 5) {
      reject(new Error('Too many redirects'));
      return;
    }
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new Error('Invalid image URL'));
      return;
    }
    if (target.protocol !== 'https:') {
      reject(new Error('Only https images can be fetched'));
      return;
    }
    const headers: Record<string, string> = { Accept: accept, 'User-Agent': 'Null-IDE' };
    const auth = tokenForUrl(url, token, hop);
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const req = https.get(target, { headers }, res => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        fetchBytes(new URL(res.headers.location, target).href, token, accept, maxBytes, hop + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { if (data.length < 2000) data += chunk; });
        res.on('end', () => reject(new ApiError(formatApiError(status, data), status)));
        return;
      }
      const tooBig = (): void => {
        res.destroy();
        reject(new Error(`Image is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`));
      };
      if (Number(res.headers['content-length']) > maxBytes) {
        tooBig();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) tooBig();
        else chunks.push(chunk);
      });
      res.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType: res.headers['content-type'] ?? null }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Image request timed out')));
  });
}

/** A file of a repo at `ref`, as bytes, through the Contents API's raw media type (works for private repos, unlike a github.com page URL). */
export function fetchRepoFile(
  owner: string, repo: string, ref: string, filePath: string, token: string | null, maxBytes: number,
): Promise<FetchedBytes> {
  const apiPath = filePath.split('/').map(encodeURIComponent).join('/');
  return fetchBytes(
    `https://api.github.com/repos/${owner}/${repo}/contents/${apiPath}?ref=${encodeURIComponent(ref)}`,
    token, 'application/vnd.github.raw+json', maxBytes);
}
```

- [ ] **Step 4: Write `imageCache.ts`**

Create `src/github/imageCache.ts`:

```ts
'use strict';

// The local copy of every issue image the panel shows. The webview can't fetch GitHub's images itself (they need the
// token, and its CSP only allows avatars), so the host downloads each one once into <workspace>/.null/issue-images/
// and the webview loads the file through asWebviewUri. No `vscode` import: node:test runs this with a stub network.

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getNullDir } from '../scratchNotesStorage';
import { FetchedBytes, fetchBytes, fetchRepoFile } from './githubApi';
import {
  ImageFetchPlan, MAX_IMAGE_BYTES, cacheFileName, cacheFileNames, cacheKeyUrl, imageExtension, imageFetchPlan,
} from './imageUrls';

/** `**\/` so it also matches when the workspace folder is a subfolder of the repository. */
export const EXCLUDE_LINE = '**/.null/issue-images/';

export const issueImagesDir = (workspaceRoot: string): string => path.join(getNullDir(workspaceRoot), 'issue-images');

/** `existing` exclude-file text with `line` added; unchanged when the line is already there. */
export function withExcludeLine(existing: string, line: string): string {
  if (existing.split(/\r?\n/).some(l => l.trim() === line)) return existing;
  return `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${line}\n`;
}

/**
 * Adds the cache folder to the repository's `info/exclude` (local to this clone, so no tracked file changes and nothing to
 * commit). `--git-path` finds the file in a linked worktree too, where `.git` is a file, not a folder. Silent outside a repo.
 */
export function ensureExcluded(workspaceRoot: string, line: string = EXCLUDE_LINE): void {
  try {
    const rel = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: workspaceRoot, encoding: 'utf8', timeout: 5000 }).trim();
    const file = path.resolve(workspaceRoot, rel);
    let existing = '';
    try {
      existing = fs.readFileSync(file, 'utf8');
    } catch {
      // no exclude file yet
    }
    const next = withExcludeLine(existing, line);
    if (next !== existing) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, next);
    }
  } catch {
    // not a repository, or git isn't installed: the cache folder just isn't excluded
  }
}

export interface ImageSource {
  /** The workspace folder; the cache lives under it. */
  root: string;
  token: string | null;
  /** The network. Defaults to GitHub; a test passes a stub. */
  fetch?: (plan: ImageFetchPlan, token: string | null) => Promise<FetchedBytes>;
}

const fetchFromGithub = (plan: ImageFetchPlan, token: string | null): Promise<FetchedBytes> =>
  plan.kind === 'contents'
    ? fetchRepoFile(plan.owner, plan.repo, plan.ref, plan.path, token, MAX_IMAGE_BYTES)
    : fetchBytes(plan.url, token, 'image/*,*/*;q=0.8', MAX_IMAGE_BYTES);

const excludedRoots = new Set<string>();
/** Downloads in progress, so two requests for one image (a re-render, two posts quoting it) share a download. */
const inFlight = new Map<string, Promise<string>>();

async function download(url: string, source: ImageSource): Promise<string> {
  const dir = issueImagesDir(source.root);
  for (const name of cacheFileNames(url)) {
    const cached = path.join(dir, name);
    if (fs.existsSync(cached)) return cached;
  }
  const plan = imageFetchPlan(url);
  if (!plan) throw new Error('Not a fetchable image URL');
  const { bytes, contentType } = await (source.fetch ?? fetchFromGithub)(plan, source.token);
  const ext = imageExtension(contentType, url);
  if (!ext) throw new Error(`Not an image (${contentType ?? 'unknown type'})`);
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`Image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB`);
  if (!excludedRoots.has(source.root)) {
    ensureExcluded(source.root);
    excludedRoots.add(source.root);
  }
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, cacheFileName(url, ext));
  // Written aside and renamed, so a crash mid-write never leaves a truncated file that a later lookup would trust.
  const partial = `${file}.part`;
  fs.writeFileSync(partial, bytes);
  fs.renameSync(partial, file);
  return file;
}

/**
 * Absolute path of the local copy of the image at `url`, downloading it first if needed. Rejects, with a reason, for a URL
 * that isn't plain https, a response that isn't an allowed image type, or one over the size cap.
 * ponytail: the cache is never cleaned up; add an age-based sweep if .null/issue-images grows noticeably.
 */
export function resolveImage(url: string, source: ImageSource): Promise<string> {
  const key = `${source.root}\n${cacheKeyUrl(url)}`;
  let pending = inFlight.get(key);
  if (!pending) {
    pending = download(url, source).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
  }
  return pending;
}

/** `fn` over `items`, at most `limit` at a time, results in the order of `items`. `fn` must not reject. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
```

Note: the doc comment on `EXCLUDE_LINE` writes `**\/` so the `*/` inside it doesn't close the comment; keep it exactly like that.

- [ ] **Step 5: Add the store method**

In `src/github/issuesStore.ts`, add to the imports (after the `./githubApi` import line):

```ts
import { resolveImage } from './imageCache';
```

Add this method right after `renderPreview` (the one ending `return renderMarkdown(text, \`${repo.owner}/${repo.repo}\`, token);\n  }`):

```ts
  /** Local file for an image shown in a post or the preview; downloads it once into `.null/issue-images`. */
  async resolveImage(url: string): Promise<string> {
    const { token } = await this.ensureSession(false);
    return resolveImage(url, { root: this.getCwd()!, token }); // ensureSession succeeded, so there is a workspace folder
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS (the ten new `imageCache` tests included). If `ensureExcluded from a linked worktree` fails with a git identity error, the `-c user.name … -c user.email …` flags are the fix, already in the test; if `git` isn't on `PATH` the three git tests can't run, so stop and say so rather than skipping them.

- [ ] **Step 7: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): download Issues images into a local cache with the token kept on GitHub's hosts" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Thumbnails in the detail tab and the composer preview

**Files:**
- Create: `src/webview/imageResolve.ts`
- Modify: `src/webview/detailHtml.ts` (`neutralizeImagesHtml`), `src/webview/composer.ts` (preview), `src/webview/issueDetail.ts` (calls + messages), `src/issueDetailPanel.ts` (handler, `localResourceRoots`, `_post` guard), `src/webviewDetail.test.ts`, `tsconfig.webview-issue-detail.json` (`include`), `lib/issueDetail.css`

**Interfaces:**
- Consumes: Task 2's `IssuesStore.resolveImage(url)`, `issueImagesDir(root)`, `mapLimit`; existing `neutralizeImagesHtml`, `composerWaiting`, `Composer`, `IssueDetailPanel._post`.
- Produces:
  - webview globals (`imageResolve.ts`): `resolveImagesIn(container: ParentNode, post: (message: unknown) => void): void`, `imageResolved(url: string, src: string): void`, `imageFailed(url: string, reason: string): void`, `retryFailedImages(): void`
  - host → webview messages `imageResolved{url, src}` and `imageFailed{url, message}`; webview → host `resolveImages{urls: string[]}`
  - `neutralizeImagesHtml` placeholders now also carry `data-alt`

- [ ] **Step 1: Write the failing test**

In `src/webviewDetail.test.ts`, add after the `neutralizeImagesHtml does not let a raw < in alt text become markup` test:

```ts
test('neutralizeImagesHtml keeps the alt text, escaped, in data-alt for the thumbnail', () => {
  const out = html.neutralizeImagesHtml('<img src="https://x/y.png" alt="a &quot;b&quot; <i>">');
  assert.ok(out.includes('data-alt="a &quot;b&quot; &lt;i&gt;"'), out);
  assert.ok(!out.includes('<i>'));
});
```

Run: `npm test`
Expected: FAIL: the `data-alt` assertion (the span has no `data-alt` yet).

- [ ] **Step 2: Carry the alt text on the placeholder**

In `src/webview/detailHtml.ts`, replace the doc comment and the return line of `neutralizeImagesHtml`:

```ts
/**
 * GitHub's image URLs need a token the webview doesn't have, and its CSP only allows avatars, so an <img> in
 * rendered markdown would be a broken icon. Emoji become their text; any other image becomes a labelled
 * placeholder that opens the image externally. (Phase 5 swaps this for real thumbnails.)
 */
```

with

```ts
/**
 * GitHub's image URLs need a token the webview doesn't have, and its CSP only allows avatars, so an <img> in
 * rendered markdown would be a broken icon. Emoji become their text; any other image becomes a labelled
 * placeholder that opens the image externally. imageResolve.ts swaps each placeholder for a real thumbnail once
 * the host has downloaded the file; `data-src` is the original URL, `data-alt` the (escaped) alt text.
 */
```

and replace

```ts
    return `<span class="img-placeholder" data-src="${attr('src')}" title="Open image on github.com">${octicon('image')} ${alt || 'image'}</span>`;
```

with

```ts
    return `<span class="img-placeholder" data-src="${attr('src')}" data-alt="${alt}" title="Open image on github.com">${octicon('image')} ${alt || 'image'}</span>`;
```

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Write the webview module**

Create `src/webview/imageResolve.ts`:

```ts
'use strict';

// Thumbnails for the images in rendered markdown (posts and the composer's preview). neutralizeImagesHtml leaves a
// `.img-placeholder` chip per image; this asks the host for a local copy of each (it downloads with the token, which the
// webview doesn't have) and swaps the chip for an <img> once the copy exists. DOM only, so no unit tests: which URLs are
// images and where they come from is decided host-side (imageUrls.ts).
// ponytail: no reserved size, so the layout shifts when an image appears; add width/height from the <img> tag if it bothers anyone.

/** Webview URI of each image's local copy, by the URL the post carries. Outlives renders: the timeline is rebuilt often. */
const resolvedImages = new Map<string, string>();
/** Why an image failed, by URL, so a re-render shows the reason again without asking the host twice. */
const failedImages = new Map<string, string>();
/** URLs already sent to the host. */
const requestedImages = new Set<string>();

function markImageFailed(placeholder: HTMLElement, reason: string): void {
  placeholder.classList.add('img-failed');
  placeholder.title = `Couldn't load this image (${reason}). Click to open it on github.com.`;
}

function showImage(placeholder: HTMLElement, src: string): void {
  const url = placeholder.dataset.src ?? '';
  const img = document.createElement('img');
  img.className = 'post-img';
  img.alt = placeholder.dataset.alt ?? '';
  img.addEventListener('error', () => {
    // The local file wouldn't load (deleted, or outside the folders the webview may read): fall back to the chip, once.
    resolvedImages.delete(url);
    failedImages.set(url, 'the local copy could not be read');
    markImageFailed(placeholder, 'the local copy could not be read');
    img.replaceWith(placeholder);
  }, { once: true });
  img.src = src;
  placeholder.replaceWith(img);
}

/** Thumbnails for the placeholders in `container`: known ones right away, new ones after one batched request to the host. */
function resolveImagesIn(container: ParentNode, post: (message: unknown) => void): void {
  const wanted: string[] = [];
  container.querySelectorAll<HTMLElement>('.img-placeholder[data-src]').forEach(el => {
    const url = el.dataset.src!;
    const src = resolvedImages.get(url);
    const failure = failedImages.get(url);
    if (src) showImage(el, src);
    else if (failure) markImageFailed(el, failure);
    else if (!requestedImages.has(url)) {
      requestedImages.add(url);
      wanted.push(url);
    }
  });
  if (wanted.length > 0) post({ type: 'resolveImages', urls: wanted });
}

/** The host has the file: every chip for that URL, wherever it is on the page, becomes the image. */
function imageResolved(url: string, src: string): void {
  resolvedImages.set(url, src);
  document.querySelectorAll<HTMLElement>('.img-placeholder[data-src]').forEach(el => {
    if (el.dataset.src === url) showImage(el, src);
  });
}

function imageFailed(url: string, reason: string): void {
  failedImages.set(url, reason);
  document.querySelectorAll<HTMLElement>('.img-placeholder[data-src]').forEach(el => {
    if (el.dataset.src === url) markImageFailed(el, reason);
  });
}

/** Forgets failures so the next render asks again: a refresh, after the user fixed their connection. */
function retryFailedImages(): void {
  for (const url of failedImages.keys()) requestedImages.delete(url);
  failedImages.clear();
}
```

In `tsconfig.webview-issue-detail.json`, add `"src/webview/imageResolve.ts",` on the line after `"src/webview/composerText.ts",` (it must come before `composer.ts` and `issueDetail.ts`).

- [ ] **Step 4: Wire it into the detail tab and the composer preview**

In `src/webview/issueDetail.ts`, in `renderTimeline()`, right after the line `    mountEditComposer();` add:

```ts
    resolveImagesIn($('timeline'), post);
```

In the `window.addEventListener('message', …)` switch, in `case 'detail':` add `retryFailedImages();` as the first statement after `createForm = null;`:

```ts
      case 'detail': {
        createForm = null;
        if (!msg.afterWrite) retryFailedImages();
```

and add these two cases right before `case 'candidates':`:

```ts
      case 'imageResolved': imageResolved(msg.url, msg.src); break;
      case 'imageFailed': imageFailed(msg.url, msg.message); break;
```

In `src/webview/composer.ts`, in `showPreview()`, right after the line `      preview.innerHTML = DOMPurify.sanitize(neutralizeImagesHtml(msg.html));` add:

```ts
      resolveImagesIn(preview, opts.post);
```

- [ ] **Step 5: Host: resolve images, let the webview read the cache, guard `_post`**

In `src/issueDetailPanel.ts`:

1. Add imports after `import { draftKey } from './github/issueDrafts';`:

```ts
import { issueImagesDir, mapLimit } from './github/imageCache';
```

2. Add to the `InboundMessage` union, after `| { type: 'saveDraft'; number: number; body: string }`:

```ts
  | { type: 'resolveImages'; urls: string[] }
```

3. Replace the `localResourceRoots` line in the constructor:

```ts
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib')],
```

with

```ts
      // The cache folder too: images the host downloaded are shown through asWebviewUri, which only serves these roots.
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'lib'), ...cacheRoots],
```

and add this line immediately before `this.panel = vscode.window.createWebviewPanel(` (inside the constructor body):

```ts
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const cacheRoots = cwd ? [vscode.Uri.file(issueImagesDir(cwd))] : [];
```

4. Guard `_post` against a tab that closed while a slow request was in flight. Add a field after `private loadedAt = 0;`:

```ts
  private disposed = false;
```

set it in the dispose handler (add as the first line inside `this.panel.onDidDispose(() => {`):

```ts
      this.disposed = true;
```

and replace `_post`:

```ts
  private _post(message: unknown): void {
    void this.panel.webview.postMessage(message);
  }
```

with

```ts
  private _post(message: unknown): void {
    if (!this.disposed) void this.panel.webview.postMessage(message); // a reply can outlive its tab
  }
```

5. Add the handler case right before `case 'saveDraft':`:

```ts
      case 'resolveImages': {
        // At most 50 per message and 4 downloads at a time; a failure is reported per image and never stops the rest.
        const urls = (Array.isArray(msg.urls) ? msg.urls : []).filter((u): u is string => typeof u === 'string').slice(0, 50);
        await mapLimit(urls, 4, async url => {
          try {
            const file = await this.store.resolveImage(url);
            this._post({ type: 'imageResolved', url, src: this.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString() });
          } catch (err) {
            this._post({ type: 'imageFailed', url, message: (err as Error).message });
          }
        });
        break;
      }
```

- [ ] **Step 6: Styles**

Append to `lib/issueDetail.css` right after the `.img-placeholder { … }` rule (the block ending `color:var(--vscode-textLink-foreground);\n}`):

```css
.img-placeholder.img-failed { color:var(--vscode-errorForeground); }
.post-body img.post-img { max-width:100%; height:auto; border-radius:6px; vertical-align:middle; }
```

- [ ] **Step 7: Build and verify**

Run: `npm test && npm run compile`
Expected: both succeed. (The thumbnails themselves are checked against a real install in Task 7, scenarios 1 to 3.)

- [ ] **Step 8: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): show Issues images as thumbnails from a local cache" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: *Copy as prompt* with comments and local image paths

**Files:**
- Create: `src/issuePrompt.ts`
- Modify: `src/github/promptFormat.ts`, `src/github/promptFormat.test.ts`, `src/github/issuesStore.ts` (`getConversation`), `src/issueDetailPanel.ts` (`copyAsPrompt`), `src/issuesListController.ts` (`copyPrompt`)

**Interfaces:**
- Consumes: Task 1's `extractImageUrls`; Task 2's `mapLimit`, `IssuesStore.resolveImage`; existing `IssuesStore.getDetail`, `getTimelinePage`; `IssuePost`, `GithubIssue`.
- Produces:
  - `interface PromptComment { author: string; createdAt: string; body: string }`, `formatIssueAsPrompt(issue: GithubIssue, comments?: PromptComment[], imagePaths?: string[]): string` (the two new parameters default to empty, so existing calls and tests are unchanged)
  - `IssuesStore.getConversation(issueNumber): Promise<{ post: IssuePost; comments: IssuePost[] }>`
  - `buildIssuePrompt(store: IssuesStore, issue: GithubIssue): Promise<{ text: string; warning: string | null }>`

- [ ] **Step 1: Write the failing test**

Append to `src/github/promptFormat.test.ts`:

```ts
test('formatIssueAsPrompt lists comments and local image files between the body and the link', () => {
  const text = formatIssueAsPrompt(
    makeIssue({ number: 7, title: 'Crash', body: 'It crashes', html_url: 'https://github.com/x/y/issues/7' }),
    [
      { author: 'ann', createdAt: '2026-09-25T10:00:00Z', body: 'Same here' },
      { author: 'bob', createdAt: '2026-09-26T08:00:00Z', body: 'Fixed in main\n\nthanks' },
    ],
    ['D:\\p\\.null\\issue-images\\a.png']);
  assert.strictEqual(text, [
    '#7 Crash',
    'It crashes',
    '--- Comments ---\n@ann (2026-09-25): Same here\n\n@bob (2026-09-26): Fixed in main\n\nthanks',
    'Images (local files; open with the Read tool):\n- D:\\p\\.null\\issue-images\\a.png',
    'https://github.com/x/y/issues/7',
  ].join('\n\n'));
});

test('formatIssueAsPrompt skips empty comments and leaves out sections with nothing in them', () => {
  const text = formatIssueAsPrompt(
    makeIssue({ number: 8, title: 'T', body: '', html_url: 'u' }),
    [{ author: 'a', createdAt: '2026-01-01T00:00:00Z', body: '  ' }], []);
  assert.strictEqual(text, '#8 T\n\nu');
});
```

Run: `npm test`
Expected: FAIL at `tsc` (`Expected 1 arguments, but got 3`).

- [ ] **Step 2: Implement `formatIssueAsPrompt`**

Replace the whole of `src/github/promptFormat.ts` with:

```ts
'use strict';

import { GithubIssue } from './types';

export interface PromptComment { author: string; createdAt: string; body: string }

/**
 * The issue as plain text for pasting into an AI chat: title, body, comments, then the local files of its images
 * (so the assistant can open them), then the link. Empty sections are left out.
 */
export function formatIssueAsPrompt(issue: GithubIssue, comments: PromptComment[] = [], imagePaths: string[] = []): string {
  const parts = [`#${issue.number} ${issue.title}`];
  const body = issue.body?.trim();
  if (body) parts.push(body);
  const spoken = comments.filter(c => c.body.trim());
  if (spoken.length > 0) {
    parts.push(`--- Comments ---\n${spoken.map(c => `@${c.author} (${c.createdAt.slice(0, 10)}): ${c.body.trim()}`).join('\n\n')}`);
  }
  if (imagePaths.length > 0) {
    parts.push(`Images (local files; open with the Read tool):\n${imagePaths.map(p => `- ${p}`).join('\n')}`);
  }
  parts.push(issue.html_url);
  return parts.join('\n\n');
}
```

Run: `npm test`
Expected: PASS (the two original tests and the two new ones).

- [ ] **Step 3: Store method: the whole conversation**

In `src/github/issuesStore.ts`, add this method right after `getTimelinePage`:

```ts
  /**
   * The issue body and every visible comment, paging past the first 100 timeline items, for Copy as prompt.
   * Collapsed (minimized) comments are spam or off-topic, so they stay out.
   * ponytail: 1000 timeline items at most; a longer thread is cut off there.
   */
  async getConversation(issueNumber: number): Promise<{ post: IssuePost; comments: IssuePost[] }> {
    const detail = await this.getDetail(issueNumber);
    const items = [...detail.timeline];
    let cursor = detail.hasMoreTimeline ? detail.timelineCursor : null;
    for (let pages = 0; cursor && pages < 9; pages++) {
      const page = await this.getTimelinePage(issueNumber, cursor);
      items.push(...page.items);
      cursor = page.hasMore ? page.cursor : null;
    }
    const comments = items.filter((i): i is { kind: 'comment' } & IssuePost => i.kind === 'comment' && !i.minimizedReason);
    return { post: detail.post, comments };
  }
```

- [ ] **Step 4: Glue: build the prompt**

Create `src/issuePrompt.ts`:

```ts
'use strict';

// Copy as prompt: fetches the whole conversation, downloads its images into the local cache and formats the lot.
// Thin glue over tested pieces (extractImageUrls, resolveImage, formatIssueAsPrompt); it needs the store, so it has no unit test.

import { IssuesStore } from './github/issuesStore';
import { GithubIssue } from './github/types';
import { mapLimit } from './github/imageCache';
import { extractImageUrls } from './github/imageUrls';
import { formatIssueAsPrompt } from './github/promptFormat';

const MAX_PROMPT_IMAGES = 30;

/**
 * The prompt text for `issue`, plus a warning when it is less complete than it should be. It never throws: offline, the issue
 * body alone still beats nothing, and one image that won't download shouldn't cost the rest.
 */
export async function buildIssuePrompt(store: IssuesStore, issue: GithubIssue): Promise<{ text: string; warning: string | null }> {
  let conversation: Awaited<ReturnType<IssuesStore['getConversation']>>;
  try {
    conversation = await store.getConversation(issue.number);
  } catch (err) {
    return { text: formatIssueAsPrompt(issue), warning: `Copied without comments or images: ${(err as Error).message}` };
  }
  const { post, comments } = conversation;
  const all = extractImageUrls([post, ...comments].map(p => p.bodyHTML).join('\n'));
  const found = await mapLimit(all.slice(0, MAX_PROMPT_IMAGES), 4, url => store.resolveImage(url).then(file => file, () => null));
  const paths = found.filter((file): file is string => file !== null);
  const missed = all.length - paths.length;
  return {
    text: formatIssueAsPrompt(
      { ...issue, body: post.body },
      comments.map(c => ({ author: c.author.login, createdAt: c.createdAt, body: c.body })),
      paths),
    warning: missed > 0 ? `${missed} image${missed === 1 ? '' : 's'} couldn't be downloaded and ${missed === 1 ? 'is' : 'are'} not in the prompt.` : null,
  };
}
```

- [ ] **Step 5: Use it from the detail tab and the list**

In `src/issueDetailPanel.ts`: replace the import `import { formatIssueAsPrompt } from './github/promptFormat';` with `import { buildIssuePrompt } from './issuePrompt';`, and replace the `copyAsPrompt` case:

```ts
      case 'copyAsPrompt': {
        const issue = this.store.getByNumber(number);
        if (!issue) break;
        await vscode.env.clipboard.writeText(formatIssueAsPrompt(issue));
        this._post({ type: 'copied' });
        break;
      }
```

with

```ts
      case 'copyAsPrompt': {
        const issue = this.store.getByNumber(number);
        if (!issue) break;
        const { text, warning } = await buildIssuePrompt(this.store, issue);
        await vscode.env.clipboard.writeText(text);
        this._post({ type: 'copied' });
        if (warning) void vscode.window.showWarningMessage(warning);
        break;
      }
```

In `src/issuesListController.ts`: replace `import { formatIssueAsPrompt } from './github/promptFormat';` with `import { buildIssuePrompt } from './issuePrompt';`, and replace

```ts
      case 'copyPrompt':
        await vscode.env.clipboard.writeText(formatIssueAsPrompt(issue));
        this._post({ type: 'rowActionDone', action, number });
        break;
```

with

```ts
      case 'copyPrompt': {
        const { text, warning } = await buildIssuePrompt(this._store, issue);
        await vscode.env.clipboard.writeText(text);
        if (warning) void vscode.window.showWarningMessage(warning);
        this._post({ type: 'rowActionDone', action, number });
        break;
      }
```

- [ ] **Step 6: Build and verify**

Run: `npm test && npm run compile`
Expected: both succeed. (The clipboard content is checked in Task 7, scenarios 5 and 6.)

- [ ] **Step 7: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): include comments and local image paths in Copy as prompt" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Image upload (`imageUpload.ts`, git data + contents APIs, host handler)

**Files:**
- Create: `src/github/imageUpload.ts`
- Create: `src/github/imageUpload.test.ts`
- Modify: `src/github/githubApi.ts` (`PUT`, `getRefSha`, `createOrphanBranch`, `putFile`), `src/github/issuesStore.ts` (`uploadImage`), `src/issueDetailPanel.ts` (handler), `tsconfig.json` (`include`), `package.json` (`test` script)

**Interfaces:**
- Consumes: Task 1's `IMAGE_TYPES`, `MAX_IMAGE_BYTES`, `imageExtension`; existing `ApiError`, `requestJson`, `IssuesStore.ensureSession`, `IssueDetailPanel._post`, `GithubRepoRef`.
- Produces:
  - `githubApi.ts`: `getRefSha(owner, repo, branch, token): Promise<string | null>`, `createOrphanBranch(owner, repo, branch, readme, token): Promise<void>`, `putFile(owner, repo, branch, filePath, base64, message, token): Promise<void>`
  - `imageUpload.ts`: `ASSET_BRANCH = 'null-issue-assets'`, `uploadPath(now: Date, uuid: string, ext: string): string`, `imageMarkdown(repo: GithubRepoRef, filePath: string, name: string): string`, `checkUpload(name: string, mime: string, byteLength: number): { ext: string } | { error: string }`, `class UploadRejected extends Error`, `interface UploadApi`, `uploadImage(repo: GithubRepoRef, token: string, file: { name: string; mime: string; bytes: Buffer }, api?: UploadApi): Promise<string>` (the markdown to insert)
  - `IssuesStore.uploadImage(name: string, mime: string, bytes: Buffer): Promise<string>`
  - webview → host `uploadImage{requestId, name, mime, dataBase64}`; host → webview `uploadResult{requestId, markdown?, error?}`

- [ ] **Step 1: Write the failing test**

Create `src/github/imageUpload.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { MAX_IMAGE_BYTES } from './imageUrls';
import { ASSET_BRANCH, UploadApi, UploadRejected, checkUpload, imageMarkdown, uploadImage, uploadPath } from './imageUpload';

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 5));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const file = (name = 'image.png') => ({ name, mime: 'image/png', bytes: PNG });

/**
 * A GitHub stand-in. uploadImage remembers which repos' assets branch exists, across calls, so every test below
 * uses its own repo name.
 */
function fakeApi(over: Partial<UploadApi> = {}) {
  const log: string[] = [];
  let active = 0;
  let peak = 0;
  let branch = false;
  const api: UploadApi = {
    getRefSha: async () => { log.push('get'); return branch ? 'sha' : null; },
    createOrphanBranch: async () => { log.push('create'); await tick(); branch = true; },
    putFile: async (_owner, _repo, _branch, filePath) => {
      log.push(`put ${filePath}`);
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
    },
    ...over,
  };
  return { api, log, peak: () => peak };
}

test('uploadPath is yyyy/mm/<uuid>.<ext> in UTC', () => {
  assert.strictEqual(uploadPath(new Date('2026-10-05T23:59:00Z'), 'abc', 'png'), '2026/10/abc.png');
  assert.strictEqual(uploadPath(new Date('2026-03-01T00:00:00Z'), 'abc', 'webp'), '2026/03/abc.webp');
});

test('imageMarkdown links the file on the assets branch with ?raw=true and keeps the alt text from breaking the syntax', () => {
  const repo = { owner: 'o', repo: 'r' };
  assert.strictEqual(
    imageMarkdown(repo, '2026/10/u.png', 'Screen Shot.png'),
    `![Screen Shot](https://github.com/o/r/blob/${ASSET_BRANCH}/2026/10/u.png?raw=true)`);
  assert.ok(imageMarkdown(repo, 'p.png', 'a]b[c.png').startsWith('![a b c]('));
  assert.ok(imageMarkdown(repo, 'p.png', '.png').startsWith('![image]('));
});

test('checkUpload accepts the five image types and names the problem otherwise', () => {
  assert.deepStrictEqual(checkUpload('a.png', 'image/png', 10), { ext: 'png' });
  assert.deepStrictEqual(checkUpload('a.jpeg', 'image/jpeg', 10), { ext: 'jpg' });
  assert.deepStrictEqual(checkUpload('a.webp', '', 10), { ext: 'webp' }); // a dropped file can have no MIME type
  assert.match((checkUpload('a.tiff', 'image/tiff', 10) as { error: string }).error, /PNG, JPG, GIF, WebP and SVG/);
  assert.match((checkUpload('a.png.exe', 'application/octet-stream', 10) as { error: string }).error, /PNG, JPG/);
  assert.match((checkUpload('a.png', 'image/png', 0) as { error: string }).error, /empty/);
  assert.match((checkUpload('a.png', 'image/png', MAX_IMAGE_BYTES + 1) as { error: string }).error, /10 MB/);
});

test('three parallel uploads create the assets branch once and commit one at a time', async () => {
  const net = fakeApi();
  const markdown = await Promise.all([1, 2, 3].map(() => uploadImage({ owner: 'o', repo: 'parallel' }, 't', file(), net.api)));
  assert.strictEqual(net.log.filter(l => l === 'create').length, 1);
  assert.strictEqual(net.log.filter(l => l.startsWith('put ')).length, 3);
  assert.strictEqual(net.peak(), 1);
  assert.strictEqual(new Set(markdown).size, 3); // a fresh file name each time
  for (const md of markdown) assert.match(md, /^!\[image\]\(https:\/\/github\.com\/o\/parallel\/blob\/null-issue-assets\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png\?raw=true\)$/);
});

test('an assets branch that already exists is not created again', async () => {
  const net = fakeApi({ getRefSha: async () => 'sha' });
  await uploadImage({ owner: 'o', repo: 'existing' }, 't', file(), net.api);
  assert.deepStrictEqual(net.log.map(l => l.split(' ')[0]), ['put']);
});

test('a failed upload does not block the next one, and the branch is looked up again', async () => {
  let failOnce = true;
  const net = fakeApi({
    putFile: async () => {
      if (failOnce) { failOnce = false; throw new Error('GitHub API 403: Resource not accessible'); }
    },
  });
  await assert.rejects(uploadImage({ owner: 'o', repo: 'flaky' }, 't', file(), net.api), /403/);
  await uploadImage({ owner: 'o', repo: 'flaky' }, 't', file(), net.api);
  assert.strictEqual(net.log.filter(l => l === 'get').length, 2);
});

test('a refused file never reaches GitHub', async () => {
  const net = fakeApi();
  await assert.rejects(uploadImage({ owner: 'o', repo: 'refused' }, 't', { name: 'a.txt', mime: 'text/plain', bytes: PNG }, net.api), UploadRejected);
  assert.deepStrictEqual(net.log, []);
});
```

- [ ] **Step 2: Register the test and run it to verify it fails**

In `tsconfig.json`, add `"src/github/imageUpload.test.ts"` after `"src/github/imageCache.test.ts"`. In `package.json`, append ` out/github/imageUpload.test.js` to the `test` script list.

Run: `npm test`
Expected: FAIL at `tsc`: `Cannot find module './imageUpload'`.

- [ ] **Step 3: Add the GitHub calls**

In `src/github/githubApi.ts`, `request` and `requestJson` only accept `'GET' | 'PATCH' | 'POST' | 'DELETE'`. Add `'PUT'` to both unions: in `request` change `method: 'GET' | 'PATCH' | 'POST' | 'DELETE', body?: unknown,` to `method: 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE', body?: unknown,`, and in `requestJson` change `method: 'GET' | 'PATCH' | 'POST' | 'DELETE' = 'GET', body?: unknown,` to `method: 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown,`.

Append at the end of the file:

```ts
/** The commit a branch points at, or null when the branch doesn't exist. */
export async function getRefSha(owner: string, repo: string, branch: string, token: string | null): Promise<string | null> {
  try {
    const ref = await requestJson<{ object: { sha: string } }>(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
    return ref.object.sha;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Creates `branch` with a single commit that has no parent (so it carries none of the repo's history): blob → tree → commit → ref. */
export async function createOrphanBranch(owner: string, repo: string, branch: string, readme: string, token: string | null): Promise<void> {
  const git = `/repos/${owner}/${repo}/git`;
  const blob = await requestJson<{ sha: string }>(`${git}/blobs`, token, 'POST', { content: readme, encoding: 'utf-8' });
  const tree = await requestJson<{ sha: string }>(`${git}/trees`, token, 'POST', {
    tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: blob.sha }],
  });
  const commit = await requestJson<{ sha: string }>(`${git}/commits`, token, 'POST', {
    message: 'Create the issue assets branch', tree: tree.sha, parents: [],
  });
  try {
    await requestJson(`${git}/refs`, token, 'POST', { ref: `refs/heads/${branch}`, sha: commit.sha });
  } catch (err) {
    // Another window created it a moment ago: that is the outcome we wanted.
    if (!(err instanceof ApiError && err.status === 422 && /already exists/i.test(err.message))) throw err;
  }
}

/** Creates a file on `branch` (Contents API). `base64` is the file's bytes. */
export async function putFile(
  owner: string, repo: string, branch: string, filePath: string, base64: string, message: string, token: string | null,
): Promise<void> {
  const apiPath = filePath.split('/').map(encodeURIComponent).join('/');
  await requestJson(`/repos/${owner}/${repo}/contents/${apiPath}`, token, 'PUT', { message, content: base64, branch });
}
```

- [ ] **Step 4: Write `imageUpload.ts`**

Create `src/github/imageUpload.ts`:

```ts
'use strict';

// Attaching an image to an issue: the file is committed to an orphan branch of the repo (GitHub has no public API for
// the drag-and-drop uploads of its own site) and the issue text links to it. No `vscode` import: node:test runs this
// against a fake GitHub.

import { randomUUID } from 'crypto';
import { createOrphanBranch, getRefSha, putFile } from './githubApi';
import { MAX_IMAGE_BYTES, imageExtension } from './imageUrls';
import { GithubRepoRef } from './types';

export const ASSET_BRANCH = 'null-issue-assets';

const README = `# ${ASSET_BRANCH}

Images attached to issues from Null IDE. The issue text links to the files on this branch.
It has no parent commit, so it carries none of the project's history, and nothing else lives here.
`;

/** The file's place on the assets branch: `yyyy/mm/<uuid>.<ext>`, so no two uploads can collide. */
export function uploadPath(now: Date, uuid: string, ext: string): string {
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${uuid}.${ext}`;
}

/** The markdown for the uploaded file; `?raw=true` is how github.com serves a repo file as an image. */
export function imageMarkdown(repo: GithubRepoRef, filePath: string, name: string): string {
  const alt = name.replace(/\.[^.]+$/, '').replace(/[[\]\r\n]/g, ' ').trim() || 'image';
  return `![${alt}](https://github.com/${repo.owner}/${repo.repo}/blob/${ASSET_BRANCH}/${filePath}?raw=true)`;
}

/** A file the panel refuses to upload (wrong type, empty, too big); the message is for the user. */
export class UploadRejected extends Error {}

/** The host's own check, whatever the webview already did. */
export function checkUpload(name: string, mime: string, byteLength: number): { ext: string } | { error: string } {
  const ext = imageExtension(mime, `https://x.invalid/${encodeURIComponent(name)}`);
  if (!ext) return { error: 'Only PNG, JPG, GIF, WebP and SVG images can be attached.' };
  if (byteLength === 0) return { error: 'That image is empty.' };
  if (byteLength > MAX_IMAGE_BYTES) return { error: `Images can be at most ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.` };
  return { ext };
}

/** The GitHub calls an upload needs, so a test can swap in a fake. */
export interface UploadApi {
  getRefSha(owner: string, repo: string, branch: string, token: string): Promise<string | null>;
  createOrphanBranch(owner: string, repo: string, branch: string, readme: string, token: string): Promise<void>;
  putFile(owner: string, repo: string, branch: string, filePath: string, base64: string, message: string, token: string): Promise<void>;
}

const githubUploadApi: UploadApi = { getRefSha, createOrphanBranch, putFile };

/** Repos whose assets branch is known to exist. Dropped again when an upload fails, in case the branch was deleted. */
const ready = new Set<string>();
/**
 * Uploads run one at a time: commits to one branch in parallel conflict, and the first upload of a repo creates the branch
 * (a second create answers 422). ponytail: one queue for every repo; split per repo if uploads to several repos ever matter.
 */
let queue: Promise<unknown> = Promise.resolve();

/** Uploads one image and returns the markdown to insert. Rejects with `UploadRejected` for a file that isn't allowed, never reaching GitHub. */
export function uploadImage(
  repo: GithubRepoRef, token: string, file: { name: string; mime: string; bytes: Buffer }, api: UploadApi = githubUploadApi,
): Promise<string> {
  const check = checkUpload(file.name, file.mime, file.bytes.length);
  if ('error' in check) return Promise.reject(new UploadRejected(check.error));
  const key = `${repo.owner}/${repo.repo}`;
  const run = async (): Promise<string> => {
    try {
      if (!ready.has(key)) {
        if (!(await api.getRefSha(repo.owner, repo.repo, ASSET_BRANCH, token))) {
          await api.createOrphanBranch(repo.owner, repo.repo, ASSET_BRANCH, README, token);
        }
        ready.add(key);
      }
      const filePath = uploadPath(new Date(), randomUUID(), check.ext);
      await api.putFile(repo.owner, repo.repo, ASSET_BRANCH, filePath, file.bytes.toString('base64'), `Add ${filePath}`, token);
      return imageMarkdown(repo, filePath, file.name);
    } catch (err) {
      ready.delete(key);
      throw err;
    }
  };
  const result = queue.then(run, run);
  queue = result.then(() => undefined, () => undefined);
  return result;
}
```

- [ ] **Step 5: Store method and host handler**

In `src/github/issuesStore.ts`, add to the imports (after the `./imageCache` import):

```ts
import { uploadImage } from './imageUpload';
```

and add this method right after `resolveImage`:

```ts
  /** Commits an image to the repo's `null-issue-assets` branch and returns the markdown that links it. Prompts for sign-in like every write. */
  async uploadImage(name: string, mime: string, bytes: Buffer): Promise<string> {
    const { repo, token } = await this.ensureSession(true);
    return uploadImage(repo, token, { name, mime, bytes });
  }
```

In `src/issueDetailPanel.ts`: add the import (after the `./github/imageCache` import added in Task 3):

```ts
import { UploadRejected } from './github/imageUpload';
```

add to the `InboundMessage` union after `| { type: 'resolveImages'; urls: string[] }`:

```ts
  | { type: 'uploadImage'; requestId: number; name: string; mime: string; dataBase64: string }
```

add the handler case right before `case 'saveDraft':`:

```ts
      case 'uploadImage':
        try {
          const bytes = Buffer.from(String(msg.dataBase64), 'base64');
          this._post({ type: 'uploadResult', requestId: msg.requestId, markdown: await this.store.uploadImage(String(msg.name), String(msg.mime), bytes) });
        } catch (err) {
          const message = (err as Error).message;
          this._post({ type: 'uploadResult', requestId: msg.requestId, error: message });
          if (err instanceof UploadRejected) void vscode.window.showErrorMessage(message);
          else void this._offerAttachOnGithub(message);
        }
        break;
```

and add this method right after `_cwd()`:

```ts
  /** An upload failed (no push access, offline): github.com can still take the image, so offer to open the page that does. */
  private async _offerAttachOnGithub(message: string): Promise<void> {
    const repo = this.store.getRepo();
    if (!repo) return;
    const url = this.creating || !this.issueNumber
      ? `https://github.com/${repo.owner}/${repo.repo}/issues/new`
      : this.store.getByNumber(this.issueNumber)?.html_url;
    if (!url) return;
    const choice = await vscode.window.showErrorMessage(`Couldn't attach the image: ${message}`, 'Attach on github.com');
    if (choice) await vscode.env.openExternal(vscode.Uri.parse(url));
  }
```

- [ ] **Step 6: Run the tests**

Run: `npm test && npm run compile`
Expected: PASS and a clean compile (the six new `imageUpload` tests included).

- [ ] **Step 7: Live smoke test of the upload endpoints (ask the user first)**

The upload calls are the one part of this plan not yet run against real GitHub. **Ask the user which repository to use before running this**: it creates the branch `null-issue-assets` (one commit with a `README.md`, then one commit per upload) in that repo. A scratch repo is best; if they pick a real one, offer the cleanup line below.

From `extensions/null-tools/`, with `OWNER`/`REPO` replaced:

```bash
node -e "
const { uploadImage } = require('./out/github/imageUpload');
const { resolveImage } = require('./out/github/imageCache');
const token = require('child_process').execSync('gh auth token').toString().trim();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
(async () => {
  const [owner, repo] = process.argv.slice(1);
  const md = await uploadImage({ owner, repo }, token, { name: 'smoke.png', mime: 'image/png', bytes: png });
  console.log(md);
  const url = /\((.*)\)/.exec(md)[1];
  console.log(await resolveImage(url, { root: require('os').tmpdir(), token }));
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
" OWNER REPO
```

Expected: the markdown line `![smoke](https://github.com/OWNER/REPO/blob/null-issue-assets/2026/10/<uuid>.png?raw=true)`, then a path under the OS temp dir ending in `.png`. Also run `gh api repos/OWNER/REPO/git/ref/heads/null-issue-assets --jq .object.sha` (a SHA, not 404) and `gh api "repos/OWNER/REPO/contents/README.md?ref=null-issue-assets" --jq .name` (`README.md`). Run the first command a second time: it must not create the branch again (still one `README.md` commit; `gh api repos/OWNER/REPO/commits?sha=null-issue-assets --jq length` is the README commit plus one per upload). If any call fails, the message names the GitHub step; fix `githubApi.ts` before going on. To clean up a scratch branch afterwards, only if the user agrees: `gh api -X DELETE repos/OWNER/REPO/git/refs/heads/null-issue-assets`.

- [ ] **Step 8: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): upload Issues images to an orphan assets branch" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Paste, drop and attach in the composer

**Files:**
- Modify: `src/webview/composerText.ts`, `src/webviewComposer.test.ts`, `src/webview/composer.ts`, `src/webview/issueDetail.ts`

**Interfaces:**
- Consumes: Task 5's host messages (`uploadImage` out, `uploadResult{requestId, markdown?, error?}` back); existing `composerWaiting`, `composerSeq`, `composerReceive`, `replaceAll`, `changed`, `setMode`, `octicon('image')`, `ComposerEdit`.
- Produces (webview globals, pure, in `composerText.ts`): `uploadingPlaceholder(name: string, id: number): string`, `insertAtCaret(value: string, start: number, end: number, text: string): ComposerEdit`, `replacePlaceholder(value: string, caret: number, placeholder: string, replacement: string): ComposerEdit | null`

- [ ] **Step 1: Write the failing tests**

In `src/webviewComposer.test.ts`, in the `const text = sandbox as unknown as { … }` block, add these three lines after `  quoteMarkdown(t: string): string;`:

```ts
  uploadingPlaceholder(name: string, id: number): string;
  insertAtCaret(v: string, start: number, end: number, t: string): Edit;
  replacePlaceholder(v: string, caret: number, placeholder: string, replacement: string): Edit | null;
```

Append at the end of the file:

```ts
test('uploadingPlaceholder is unique per upload and cannot break out of the image syntax', () => {
  assert.strictEqual(text.uploadingPlaceholder('image.png', 3), '![Uploading image.png…](#upload-3)');
  assert.notStrictEqual(text.uploadingPlaceholder('image.png', 3), text.uploadingPlaceholder('image.png', 4));
  assert.strictEqual(text.uploadingPlaceholder('a]b[c\nd.png', 1), '![Uploading a b c d.png…](#upload-1)');
});

test('insertAtCaret puts the stand-in on its own line and the caret just after it', () => {
  assert.deepStrictEqual(plain(text.insertAtCaret('', 0, 0, 'X')), { value: 'X', start: 1, end: 1 });
  assert.deepStrictEqual(plain(text.insertAtCaret('see:', 4, 4, 'X')), { value: 'see:\nX', start: 6, end: 6 });
  assert.deepStrictEqual(plain(text.insertAtCaret('ab', 1, 1, 'X')), { value: 'a\nX\nb', start: 3, end: 3 });
  assert.deepStrictEqual(plain(text.insertAtCaret('a\nb', 2, 2, 'X')), { value: 'a\nX\nb', start: 3, end: 3 });
  assert.deepStrictEqual(plain(text.insertAtCaret('hello world', 0, 5, 'X')), { value: 'X\n world', start: 1, end: 1 });
});

test('replacePlaceholder swaps the stand-in for the markdown and keeps the caret where the user left it', () => {
  const p = '![Uploading a.png…](#upload-1)';
  const r = '![a](https://x)';
  const before = `hi\n${p}\nbye`;
  const atEnd = text.replacePlaceholder(before, before.length, p, r)!;
  assert.strictEqual(atEnd.value, `hi\n${r}\nbye`);
  assert.strictEqual(atEnd.start, atEnd.value.length); // moved by the length difference
  assert.strictEqual(text.replacePlaceholder(before, 1, p, r)!.start, 1); // before the stand-in: untouched
  assert.strictEqual(text.replacePlaceholder(before, 5, p, r)!.start, 3 + r.length); // inside it: right after the result
});

test('replacePlaceholder with an empty replacement removes the stand-in; one the user deleted is left alone', () => {
  const p = '![Uploading a.png…](#upload-1)';
  assert.strictEqual(text.replacePlaceholder(`a${p}b`, 0, p, '')!.value, 'ab');
  assert.strictEqual(text.replacePlaceholder('the user deleted it', 3, p, 'x'), null);
});
```

Run: `npm test`
Expected: FAIL: `text.uploadingPlaceholder is not a function` (the three new tests; the rest pass).

- [ ] **Step 2: Implement the pure helpers**

Append to `src/webview/composerText.ts` (before nothing: at the end of the file; first run `grep -rn "function uploadingPlaceholder\|function insertAtCaret\|function replacePlaceholder" src/webview` and make sure it finds nothing):

```ts
/** The text that stands in for an image while it uploads. The id makes it unique, so two uploads of `image.png` can't swap results. */
function uploadingPlaceholder(name: string, id: number): string {
  return `![Uploading ${name.replace(/[[\]\r\n]/g, ' ')}…](#upload-${id})`;
}

/** Replaces the selection with `text`, on a line of its own: a newline is added on a side that isn't already at a line break. */
function insertAtCaret(value: string, start: number, end: number, text: string): ComposerEdit {
  const before = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
  const after = end < value.length && value[end] !== '\n' ? '\n' : '';
  const caret = start + before.length + text.length;
  return { value: value.slice(0, start) + before + text + after + value.slice(end), start: caret, end: caret };
}

/**
 * Swaps `placeholder` for `replacement` (empty removes it) and moves the caret so the user's place in the text survives.
 * null when the placeholder is gone, so a stand-in the user already deleted is not put back.
 */
function replacePlaceholder(value: string, caret: number, placeholder: string, replacement: string): ComposerEdit | null {
  const at = value.indexOf(placeholder);
  if (at < 0) return null;
  const stop = at + placeholder.length;
  const moved = caret >= stop ? caret + replacement.length - placeholder.length : caret > at ? at + replacement.length : caret;
  return { value: value.slice(0, at) + replacement + value.slice(stop), start: moved, end: moved };
}
```

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: The composer: attach button, paste, drop, upload**

In `src/webview/composer.ts`:

1. In the `el.innerHTML` template, replace the tools line

```ts
        `<button type="button" class="icon-btn" data-tool="${t.id}" title="${t.title}" aria-label="${t.title}">${octicon(t.icon)}</button>`).join('')}</div>
```

with

```ts
        `<button type="button" class="icon-btn" data-tool="${t.id}" title="${t.title}" aria-label="${t.title}">${octicon(t.icon)}</button>`).join('')}<button type="button" class="icon-btn" data-attach title="Attach an image" aria-label="Attach an image">${octicon('image')}</button><input type="file" class="composer-file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" multiple hidden></div>
```

2. After the line `  const tools = el.querySelector('.composer-tools') as HTMLElement;` add:

```ts
  const fileInput = el.querySelector('.composer-file') as HTMLInputElement;
```

3. Add this section right before the `// ---- events ---…` comment block:

```ts
  // ---- image upload -------------------------------------------------------------------------------------------

  const IMAGE_LIMIT = 10 * 1024 * 1024; // the host checks this again, and the allowed types

  function showHint(message: string): void {
    hint.textContent = message;
    hint.classList.remove('hidden');
  }

  function readBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
      reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Puts a stand-in at the caret right away, uploads in the background, then swaps in the markdown, or removes the stand-in
   * and says why. The result is written without refocusing: the user may be typing in another field by then.
   * ponytail: an upload that finishes after this composer was re-rendered (an edit form, on a refresh) leaves its stand-in in the text.
   */
  function attach(files: File[]): void {
    if (mode === 'preview') setMode('write');
    for (const file of files) {
      const name = file.name || 'image.png';
      if (file.size > IMAGE_LIMIT) {
        showHint(`${name} is larger than 10 MB.`);
        continue;
      }
      const id = ++composerSeq;
      const placeholder = uploadingPlaceholder(name, id);
      replaceAll(insertAtCaret(ta.value, ta.selectionStart, ta.selectionEnd, placeholder));
      composerWaiting.set(id, msg => {
        const done = replacePlaceholder(ta.value, ta.selectionStart, placeholder, msg.error ? '' : msg.markdown);
        if (done) {
          ta.value = done.value;
          ta.setSelectionRange(done.start, done.end);
          changed();
        }
        if (msg.error) showHint(msg.error);
      });
      readBase64(file).then(
        dataBase64 => opts.post({ type: 'uploadImage', requestId: id, name, mime: file.type, dataBase64 }),
        () => composerReceive({ requestId: id, error: 'Could not read the file.' } as { requestId: number }),
      );
    }
  }

  /** Image files in a paste or drop; a paste that also carries text (a copied spreadsheet cell) is a text paste. */
  function imageFiles(transfer: DataTransfer | null, ignoreIfText: boolean): File[] {
    if (!transfer || (ignoreIfText && transfer.getData('text/plain'))) return [];
    return Array.from(transfer.files).filter(f => f.type.startsWith('image/'));
  }
```

4. In the events section, after `ta.addEventListener('blur', closeSuggest);` add:

```ts
  ta.addEventListener('paste', e => {
    const files = imageFiles(e.clipboardData, true);
    if (files.length === 0) return;
    e.preventDefault();
    attach(files);
  });
  ta.addEventListener('dragover', e => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); // without this the browser never offers a drop
  });
  ta.addEventListener('drop', e => {
    const files = imageFiles(e.dataTransfer, false);
    if (files.length === 0) return;
    e.preventDefault();
    attach(files);
  });
  fileInput.addEventListener('change', () => {
    attach(Array.from(fileInput.files ?? []));
    fileInput.value = ''; // picking the same file again must fire `change` again
  });
```

5. In the `el.addEventListener('click', e => { … })` handler, replace

```ts
    const tool = target.closest<HTMLElement>('[data-tool]');
    if (tool) runTool(tool.dataset.tool!);
```

with

```ts
    if (target.closest('[data-attach]')) {
      fileInput.click();
      return;
    }
    const tool = target.closest<HTMLElement>('[data-tool]');
    if (tool) runTool(tool.dataset.tool!);
```

In `composerReceive` the parameter type is `{ requestId?: number }`; the `as { requestId: number }` cast above carries the `error` through at runtime (the waiting callback reads `msg.error`).

6. In `src/webview/issueDetail.ts`, add `case 'uploadResult':` to the existing routing group:

```ts
      case 'previewResult':
      case 'suggestions':
      case 'uploadResult':
        composerReceive(msg);
        break;
```

- [ ] **Step 4: Build and verify**

Run: `npm test && npm run compile`
Expected: both succeed. (The UI itself is checked against a real install in Task 7.)

- [ ] **Step 5: Commit**

```bash
git status --short
git add -A .
git commit -m "feat(null-tools): paste, drop or attach images in the Issues composer" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs and live verification

**Files:**
- Modify: `CLAUDE.md` (repo root), `docs/specs/github-issues-panel-v2-design.md`

- [ ] **Step 1: Update CLAUDE.md**

In the `null-tools` table row **GitHub Issues panel**, replace the phrase `sub-issue creation), sign-in,` with `sub-issue creation), image attach (paste, drop or toolbar; committed to an orphan \`null-issue-assets\` branch) with thumbnails cached in \`.null/issue-images/\`, *Copy as prompt* with comments and local image paths, sign-in,`.

- [ ] **Step 2: Correct the spec where this phase differs**

In `docs/specs/github-issues-panel-v2-design.md`, "Display: one path for every image":

- In step 2 ("The host calls `imageCache.resolveImage(url)` for each one."), the sentence is wrapped over two lines in the file: `GitHub-owned` ends one line and `hosts (\`github.com\`, \`*.githubusercontent.com\`) are fetched with the token;` starts the next. Replace `GitHub-owned hosts (\`github.com\`, \`*.githubusercontent.com\`) are fetched with the token;` (joining the two lines) with `Only \`github.com\` and \`api.github.com\` get the token, and only on the first request (a redirect never carries it);`.
- Replace `The webview CSP stays \`img-src ${cspSource} https://avatars.githubusercontent.com\`.` with `The webview CSP stays \`img-src ${cspSource} https://avatars.githubusercontent.com\`, and the detail webview's \`localResourceRoots\` gains \`.null/issue-images/\` (files outside \`lib/\` are not served otherwise).`
- Replace `On first write, \`.null/issue-images/\` is appended to \`.git/info/exclude\` (idempotent; no \`.gitignore\` edit).` with `On first write, \`**/.null/issue-images/\` is appended to the repository's \`info/exclude\` (found with \`git rev-parse --git-path\`, so linked worktrees work; idempotent; no \`.gitignore\` edit).`

In the Architecture table (the `imageCache.ts` and `imageUpload.ts` rows): change `resolveImage(url) downloads an image with the token when the host is GitHub-owned` to `resolveImage(url, { root, token }) downloads an image (the token goes only to github.com / api.github.com)`, `cacheFileName(url, contentType)` to `cacheFileName(url, ext)`, and `uploadImage(bytes, filename)` to `uploadImage(repo, token, { name, mime, bytes })`.

Read the passages first and match their exact text; if one has drifted, adapt the replacement to the same meaning.

- [ ] **Step 3: Verify against a real install**

Invoke the `verify-local` skill (it syncs the extension into the real local Null IDE install and runs the extension's integration specs). Then go through these by hand in that install, on `TorresVisual/null-ide` (private), and report each as passed or failed with what you saw. **Scenarios 4 onward upload to the real repo and create the `null-issue-assets` branch there: ask the user before starting them, and offer the cleanup `gh api -X DELETE repos/TorresVisual/null-ide/git/refs/heads/null-issue-assets` afterwards.**

1. **Existing image shows.** Open issue #98 (it has a pasted screenshot). The body shows a thumbnail, not an `image` chip. `.null/issue-images/<40 hex>.png` exists in the workspace and `git status` does not list it. (This exercises the signed-URL fetch and the redirect-free path; also open any issue whose image is a `github.com/user-attachments/…` link if one exists, to exercise the token-on-first-hop-only redirect.)
2. **Refresh doesn't re-download.** Count the files in `.null/issue-images/`, press *Refresh* in the issue's `⋯` menu twice (each refresh re-signs the URL), count again: unchanged.
3. **Offline.** Delete the cached file, go offline, reload the issue: the chip stays, turns red, and its tooltip says why; clicking it opens the image on github.com. Back online, *Refresh*: the thumbnail appears.
4. **Paste uploads.** Paste a screenshot into the comment box: a `![Uploading image.png…](#upload-N)` line appears at once, then becomes `![image](https://github.com/TorresVisual/null-ide/blob/null-issue-assets/2026/10/<uuid>.png?raw=true)`. Preview shows the picture. Post the comment: the image shows in the tab and on github.com. `gh api repos/TorresVisual/null-ide/git/ref/heads/null-issue-assets` answers a SHA, and the branch's first commit has no parent.
5. **Three in a row.** Paste three screenshots quickly (or drop three files at once): all three stand-ins resolve to different files, in the right places, with no error toast; the branch still has exactly one `README.md` commit plus one commit per image.
6. **Attach button and drop.** The toolbar's image button opens a file picker and uploads what you pick (if the picker doesn't open in the webview, say so: paste and drop are the fallback); dragging an image file onto the box uploads it. The same works in the New issue form and in a comment *edit*.
7. **Text paste still works.** Copy a few spreadsheet cells or a web-page selection with an image in it and paste: the text is inserted, no upload starts. Copying plain text pastes as before.
8. **Refused and failed uploads.** Drop a `.bmp` (an image type the panel doesn't store: the host refuses it with "Only PNG, JPG, GIF, WebP and SVG images can be attached.") and an image over 10 MB (the box shows "… is larger than 10 MB."): no stand-in left behind, nothing on the branch. The host checks the type the browser reports and the file name, not the file's bytes, so a text file renamed to `.png` is uploaded as a broken image: that is a known limit, not a failure of this scenario. In a clone of a repo you can't push to (any public repo you don't own, e.g. `octocat/Hello-World`), paste an image: the stand-in is removed, a notification names the failure with an **Attach on github.com** button that opens that repo's page.
9. **Copy as prompt.** On an issue with a screenshot and at least two comments, use `⋯` → *Copy as prompt* in the tab and the row action in the list: the clipboard holds title, body, a `--- Comments ---` block, an `Images (local files; open with the Read tool):` list whose paths exist on disk, then the link. Ask Claude Code to Read one of the paths. Offline, the same action copies title, body and link and shows a "Copied without comments or images" warning.
10. **Worktree.** Open a linked worktree of the repo (Null's worktree manager) as the workspace, open an issue with an image: the image shows, the main repo's `.git/info/exclude` contains `**/.null/issue-images/` exactly once, and `git status` in the worktree doesn't list `.null/issue-images`.
11. **Hostile alt text.** Comment `![<b>x</b>"onerror=alert(1)](https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000)` on a scratch issue: the chip/tooltip show the text literally, no markup, no script.

- [ ] **Step 4: Commit**

```bash
git status --short
git add CLAUDE.md docs/specs/github-issues-panel-v2-design.md
git commit -m "docs: describe Issues image upload, thumbnails and prompt images" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

If any step 3 scenario failed, fix it as a follow-up commit (`fix(null-tools): …`) before this one, and say which scenario it was.
