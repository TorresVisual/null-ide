'use strict';

/** URI scheme of one side of a pull-request file; served by `PullContentProvider` from the Contents API. */
export const PULL_SCHEME = 'null-pr';

/** Per side. A binary or larger file is shown as `PLACEHOLDER`, so the diff editor always opens. */
export const MAX_SIDE_BYTES = 2 * 1024 * 1024;
export const PLACEHOLDER = 'Binary or too large to show — open the pull request on GitHub.';

export interface DocRef {
  owner: string;
  repo: string;
  pull: number;
  /** Repo path of the file on this side (the old name for the left side of a rename). */
  path: string;
  /** The commit whose content this document shows: the merge base (LEFT) or the PR head (RIGHT). */
  sha: string;
  /** The PR head commit; GitHub wants it as `commit_id` when a comment is posted, whichever side it is on. */
  head: string;
  side: 'LEFT' | 'RIGHT';
}

const SHA = /^[0-9a-f]{40}$/;
const NAME = /^[A-Za-z0-9._-]+$/;
const dotsOnly = (s: string): boolean => /^\.+$/.test(s);

/** The query half of the document URI. The path is the URI's own path, so the tab title and language mode come out right. */
export function docQuery(ref: DocRef): string {
  return new URLSearchParams({
    o: ref.owner, r: ref.repo, n: String(ref.pull), s: ref.sha, h: ref.head, d: ref.side,
  }).toString();
}

/** The reference a document URI encodes, or null when anything about it is off (it then never reaches the network). */
export function parseDocQuery(uriPath: string, query: string): DocRef | null {
  const params = new URLSearchParams(query);
  const owner = params.get('o') ?? '';
  const repo = params.get('r') ?? '';
  const pull = Number(params.get('n'));
  const sha = params.get('s') ?? '';
  const head = params.get('h') ?? '';
  const side = params.get('d');
  const path = uriPath.replace(/^\//, '');
  if (!NAME.test(owner) || dotsOnly(owner) || !NAME.test(repo) || dotsOnly(repo)) return null;
  if (!Number.isInteger(pull) || pull <= 0) return null;
  if (!SHA.test(sha) || !SHA.test(head)) return null;
  if (side !== 'LEFT' && side !== 'RIGHT') return null;
  if (!path || path.split('/').some(part => part === '..' || part === '')) return null;
  return { owner, repo, pull, path, sha, head, side };
}

/** File text for the editor. A NUL byte marks a binary file, which would only show as garbage. */
export function decodeBlob(bytes: Buffer): string {
  return bytes.includes(0) ? PLACEHOLDER : bytes.toString('utf8');
}
