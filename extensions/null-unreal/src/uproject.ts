import * as path from 'node:path';

export interface Uproject { file: string; dir: string; name: string; engineAssociation: string }
export interface ProjectFs { readdir(dir: string): string[]; readFile(p: string): string; exists(p: string): boolean }

// Exit-code-2 errors: usage or resolution problems the caller can act on.
export class ResolveError extends Error {}

function uprojectsIn(dir: string, fs: ProjectFs): string[] {
  return fs.readdir(dir)
    .filter((n) => n.toLowerCase().endsWith('.uproject'))
    .map((n) => path.join(dir, n));
}

function pickOne(dir: string, found: string[]): string {
  if (found.length === 1) return found[0];
  if (found.length === 0) throw new ResolveError(`no .uproject in ${dir}; pass --project <file>`);
  const names = found.map((f) => path.basename(f)).join(', ');
  throw new ResolveError(`several .uproject files in ${dir} (${names}); pass --project <file>`);
}

function load(file: string, fs: ProjectFs): Uproject {
  let json: { EngineAssociation?: unknown };
  try {
    json = JSON.parse(fs.readFile(file).replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new ResolveError(`could not read ${file}: ${(e as Error).message}`);
  }
  return {
    file,
    dir: path.dirname(file),
    name: path.basename(file, '.uproject'),
    engineAssociation: typeof json?.EngineAssociation === 'string' ? json.EngineAssociation : '',
  };
}

export function resolveProject(cwd: string, explicit: string | undefined, fs: ProjectFs): Uproject {
  if (explicit !== undefined) {
    const p = path.resolve(cwd, explicit);
    if (p.toLowerCase().endsWith('.uproject')) {
      if (!fs.exists(p)) throw new ResolveError(`no such project file: ${p}`);
      return load(p, fs);
    }
    if (!fs.exists(p)) throw new ResolveError(`no such project directory: ${p}`);
    return load(pickOne(p, uprojectsIn(p, fs)), fs);
  }
  let dir = path.resolve(cwd);
  for (;;) {
    const found = uprojectsIn(dir, fs);
    if (found.length > 0) return load(pickOne(dir, found), fs);
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new ResolveError(`no .uproject found from ${cwd} up to the drive root; pass --project <file>`);
    }
    dir = parent;
  }
}
