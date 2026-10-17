// Generates builtins.json: the built-in extensions null-setup may leave off disk.
// Usage: node scripts/gen-builtins.mjs <out.json>
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NULL_PUBLISHER = 'null.';

/**
 * @param config  parsed setup/builtins.config.json
 * @param readPackage  (id) => package.json object, or undefined for a built-in that is not an extension of this repo
 * @param repoExtensionIds  every extensions/<id> folder that has a package.json
 */
export function build(config, readPackage, repoExtensionIds) {
  const listed = new Set(config.builtins.map((b) => b.id));
  for (const id of repoExtensionIds) {
    if (!listed.has(id)) throw new Error(`extensions/${id} is not listed in setup/builtins.config.json`);
  }
  const builtins = config.builtins.map((c) => {
    const pkg = readPackage(c.id);
    const label = c.label ?? pkg?.displayName;
    const description = c.description ?? pkg?.description;
    if (!label || !description) throw new Error(`${c.id}: needs a label and a description (config or package.json)`);
    const fromPackage = (pkg?.extensionDependencies ?? [])
      .filter((d) => d.startsWith(NULL_PUBLISHER))
      .map((d) => d.slice(NULL_PUBLISHER.length));
    return {
      id: c.id,
      label,
      description,
      default: c.default ?? true,
      locked: c.locked ?? false,
      requires: [...new Set([...(c.requires ?? []), ...fromPackage])],
    };
  });
  return { schema: 1, builtins, settings: config.settings ?? [], marketplace: config.marketplace ?? [] };
}

export function main(out) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(readFileSync(join(root, 'setup', 'builtins.config.json'), 'utf8'));
  const extDir = join(root, 'extensions');
  const ids = readdirSync(extDir).filter((d) => existsSync(join(extDir, d, 'package.json')));
  const read = (id) => {
    const p = join(extDir, id, 'package.json');
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined;
  };
  const manifest = build(config, read, ids);
  if (out) writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('usage: node gen-builtins.mjs <out.json>');
    process.exit(2);
  }
  main(process.argv[2]);
}
