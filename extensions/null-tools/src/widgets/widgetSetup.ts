'use strict';

import { REPO_RE, WidgetRepo, parseRepos } from './widgetTypes';

export function mergeRepos(existing: WidgetRepo[], accountId: string, picked: string[]): WidgetRepo[] {
  const others = existing.filter(e => e.account !== accountId);
  return parseRepos([...others, ...picked.map(repo => ({ repo, account: accountId }))]);
}

export function repoChoices(raw: unknown): string[] {
  if (!Array.isArray(raw)) { return []; }
  return raw.map(r => (r as { full_name?: unknown } | null)?.full_name).filter((n): n is string => typeof n === 'string' && REPO_RE.test(n));
}

export function localPathsFrom(remotes: ReadonlyMap<string, string | null>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [dir, repo] of remotes) { if (repo && !out.has(repo.toLowerCase())) { out.set(repo.toLowerCase(), dir); } }
  return out;
}

/** The extension host runs with ELECTRON_RUN_AS_NODE and VSCODE_* set; a null.exe started from the widgets must not inherit them. */
export function widgetEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    const name = k.toUpperCase();
    if (name !== 'ELECTRON_RUN_AS_NODE' && !name.startsWith('VSCODE_')) { out[k] = v; }
  }
  return out;
}
