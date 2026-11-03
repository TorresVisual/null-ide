import { win32 as win } from 'node:path';
import { ResolveError } from './uproject';

export interface TreeFs {
  list(dir: string): { name: string; isDirectory: boolean }[];   // [] when the folder is missing
  exists(p: string): boolean;
}

// A mount point: package paths under `name` ("/Game", "/MyPlugin") live in files under `root`.
export interface Mount { name: string; root: string }

const SKIP = new Set(['Binaries', 'Intermediate', 'Saved', 'Content', 'Source', 'DerivedDataCache', '.git']);

// Project content plus every plugin under <project>/Plugins that has a Content folder.
export function findMounts(projectDir: string, fs: TreeFs): Mount[] {
  const mounts: Mount[] = [{ name: '/Game', root: win.join(projectDir, 'Content') }];
  const walk = (dir: string, depth: number) => {
    const entries = fs.list(dir);
    const uplugin = entries.find((e) => !e.isDirectory && e.name.toLowerCase().endsWith('.uplugin'));
    if (uplugin) {
      const content = win.join(dir, 'Content');
      if (fs.exists(content)) mounts.push({ name: `/${win.basename(uplugin.name, win.extname(uplugin.name))}`, root: content });
    }
    if (depth >= 4) return;
    for (const e of entries) if (e.isDirectory && !SKIP.has(e.name)) walk(win.join(dir, e.name), depth + 1);
  };
  walk(win.join(projectDir, 'Plugins'), 0);
  return mounts;
}

const under = (root: string, file: string) => file.toLowerCase().startsWith(root.toLowerCase() + win.sep);

// Throws when the file is not under any mounted content root (an engine or unrelated .uasset).
export function toPackagePath(file: string, mounts: Mount[]): string {
  const f = win.normalize(file);
  const mount = mounts.find((m) => under(m.root, f));
  if (!mount || !f.toLowerCase().endsWith('.uasset')) {
    throw new ResolveError(
      `${file} is not a .uasset under the project's Content folder or a plugin's Content folder`,
    );
  }
  const rel = f.slice(mount.root.length + 1, -'.uasset'.length);
  return `${mount.name}/${rel.split(win.sep).join('/')}`;
}

// Every .uasset below `dir`, sorted (maps and other files are not exported).
export function uassetsIn(dir: string, fs: TreeFs): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.list(d)) {
      const p = win.join(d, e.name);
      if (e.isDirectory) walk(p);
      else if (e.name.toLowerCase().endsWith('.uasset')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}
