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
