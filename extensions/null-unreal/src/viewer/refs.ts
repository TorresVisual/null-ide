import { win32 as win } from 'node:path';
import type { ExportDoc } from '../exportFormat';
import { entryPath } from '../cache';
import type { Mount } from '../packagePath';

// /Game/A/B -> <content root>\A\B.uasset, the inverse of toPackagePath. Undefined when no mount serves the package.
export function packageToFile(pkg: string, mounts: Mount[]): string | undefined {
  const mount = mounts.find((m) => pkg.startsWith(m.name + '/'));
  if (!mount) return undefined;
  const rel = pkg.slice(mount.name.length + 1).split('/');
  return win.join(mount.root, ...rel) + '.uasset';
}

// Absolute path of a sidecar file beside the entry JSON; undefined when the export does not name a readable one.
export function sidecarFile(assets: string, doc: ExportDoc, key: string): string | undefined {
  const v = doc.sidecars[key];
  if (typeof v !== 'string') return undefined;
  return win.join(win.dirname(entryPath(assets, doc.package)), v);
}

// Every package gets an entry: the PNG path when it is cached, null when it is not (a placeholder, never a guess).
export function thumbnailMap(packages: string[], pngFor: (pkg: string) => string | undefined): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const p of packages) out[p] = pngFor(p) ?? null;
  return out;
}
