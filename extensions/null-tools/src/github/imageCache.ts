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
