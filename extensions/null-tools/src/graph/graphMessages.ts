/// <reference path="./protocol.ts" />
'use strict';

const SHA = /^[0-9a-f]{40}$/;
const MAX_PATH = 4096;

export function isSha(value: unknown): value is string {
  return typeof value === 'string' && SHA.test(value);
}

/** The sha from a command argument: a bare sha, or an object that carries one (tree element, webview context). */
export function shaFromArg(arg: unknown): string | undefined {
  if (isSha(arg)) return arg;
  if (typeof arg === 'object' && arg !== null) {
    const sha = (arg as { sha?: unknown }).sha;
    if (isSha(sha)) return sha;
  }
  return undefined;
}

/** Validates an untrusted webview message; returns a fresh object holding only the known fields. */
export function parseWebviewMessage(raw: unknown): GraphWebviewToHost | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'ready':
    case 'loadMore':
    case 'refresh':
    case 'manageTrust':
      return { type: m.type };
    case 'select':
    case 'goto':
      return isSha(m.sha) ? { type: m.type, sha: m.sha } : undefined;
    case 'openDiff':
      if (!isSha(m.sha) || typeof m.file !== 'string') return undefined;
      if (m.file.length === 0 || m.file.length > MAX_PATH || m.file.includes('\0')) return undefined;
      return { type: 'openDiff', sha: m.sha, file: m.file };
    case 'banner':
      return m.action === 'continue' || m.action === 'skip' || m.action === 'abort' ? { type: 'banner', action: m.action } : undefined;
    default:
      return undefined;
  }
}

/** Why the graph cannot run here, or undefined when it can (the repo itself is checked with git afterwards). */
export function classifyWorkspace(input: { folderScheme: string | undefined; trusted: boolean }): GraphUnavailableReason | undefined {
  if (input.folderScheme === undefined) return 'no-folder';
  if (input.folderScheme !== 'file') return 'remote';
  if (!input.trusted) return 'untrusted';
  return undefined;
}

export function unavailableText(reason: GraphUnavailableReason): string {
  switch (reason) {
    case 'no-folder': return 'Open a folder to see its commit history.';
    case 'remote': return "Commit Graph isn't available in remote windows yet.";
    case 'untrusted': return "Commit Graph doesn't run in an untrusted workspace.";
    case 'not-a-repo': return 'The open folder is not a Git repository.';
    case 'no-git': return 'Git was not found. Install Git and reload the window.';
  }
}
