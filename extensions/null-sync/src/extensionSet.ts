'use strict';

export interface Merge {
  /** IDs on the remote list that this device does not have yet. */
  install: string[];
  /** Removed elsewhere but still installed here: reported, never uninstalled automatically. */
  notifyRemoved: string[];
  /** The new remote list, or `undefined` when the remote already has it. */
  push: string[] | undefined;
  /** What to remember as agreed: installed here and on the remote, plus the removals still being reported. */
  nextBase: string[];
}

const sorted = (ids: Iterable<string>): string[] => [...new Set(ids)].sort();
const sameSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Three-way set merge. `base` is what both sides agreed on at the last sync (`undefined` = never synced, so nothing
 * has been removed by either side). IDs pending install are deliberately left out of `nextBase`: remembering them
 * would make the next run read them as "uninstalled here" and push their removal. Removals still being reported are kept
 * in it for the opposite reason: dropping them would make the next run read them as new local additions and re-upload them.
 */
export function mergeExtensions(local: string[], remote: string[] | null, base: string[] | undefined): Merge {
  const mine = new Set(local);
  const theirs = new Set(remote ?? []);
  const agreed = new Set(base ?? []);

  const install = [...theirs].filter((id) => !agreed.has(id) && !mine.has(id));
  const notifyRemoved = [...agreed].filter((id) => !theirs.has(id) && mine.has(id));

  const next = new Set([...theirs, ...[...mine].filter((id) => !agreed.has(id))]);
  for (const id of agreed) {
    if (!mine.has(id)) next.delete(id);
  }

  return {
    install: sorted(install),
    notifyRemoved: sorted(notifyRemoved),
    push: remote !== null && sameSet(next, theirs) ? undefined : sorted(next),
    nextBase: sorted([...[...mine].filter((id) => next.has(id)), ...notifyRemoved]),
  };
}

/** The decrypted remote list: a JSON array of extension IDs; `undefined` if it is anything else. */
export function parseIds(text: string): string[] | undefined {
  try {
    const list = JSON.parse(text) as unknown;
    return Array.isArray(list) && list.every((id) => typeof id === 'string')
      ? sorted((list as string[]).map((id) => id.toLowerCase()))
      : undefined;
  } catch {
    return undefined;
  }
}

interface ManifestEntry {
  identifier?: { id?: unknown };
  metadata?: { isBuiltin?: unknown; isMachineScoped?: unknown };
}

/**
 * User-installed extension IDs from `extensions.json`. That file lists disabled extensions too (`vscode.extensions.all`
 * does not). `undefined` when the text is not a list, so an unreadable file is never mistaken for "everything was uninstalled".
 */
export function installedIds(manifestText: string): string[] | undefined {
  try {
    const list = JSON.parse(manifestText) as unknown;
    if (!Array.isArray(list)) return undefined;
    return sorted(
      (list as ManifestEntry[]).flatMap((entry) =>
        typeof entry?.identifier?.id === 'string' && entry.metadata?.isBuiltin !== true && entry.metadata?.isMachineScoped !== true
          ? [entry.identifier.id.toLowerCase()]
          : [],
      ),
    );
  } catch {
    return undefined;
  }
}
