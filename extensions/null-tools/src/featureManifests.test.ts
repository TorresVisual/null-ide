import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import test from 'node:test';
import { collectFeatures } from './featureRegistry';

// out/ -> null-tools -> extensions
const extensionsDir = path.resolve(__dirname, '..', '..');

function readManifests() {
  return fs.readdirSync(extensionsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(extensionsDir, d.name, 'package.json'))
    .filter(p => fs.existsSync(p))
    .map(p => {
      const json = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { extensionId: `${json.publisher}.${json.name}`, packageJSON: json };
    });
}

test('the real manifests declare exactly the agreed launcher entries', () => {
  const warnings: string[] = [];
  const result = collectFeatures(readManifests(), m => warnings.push(m));
  assert.deepStrictEqual(warnings, []);
  assert.deepStrictEqual(
    result.map(c => [c.id, c.features.map(f => f.label)]),
    [
      ['develop', ['Dashboard', 'GitHub Issues', 'Commit Graph', 'Music Player']],
      ['insights', ['Activity Dashboard', 'Startup Report']],
      ['account', ['Accounts', 'Sync Status']],
      ['setup', ['Environment Check', 'Actions Settings', 'Formatting Settings']],
    ],
  );
});

test('every launcher command is declared by some extension', () => {
  const manifests = readManifests();
  const declared = new Set<string>();
  for (const { packageJSON } of manifests) {
    const commands = (packageJSON as { contributes?: { commands?: { command: string }[] } }).contributes?.commands ?? [];
    for (const c of commands) { declared.add(c.command); }
  }
  for (const category of collectFeatures(manifests)) {
    for (const feature of category.features) {
      assert.ok(declared.has(feature.command), `${feature.key} runs undeclared command ${feature.command}`);
    }
  }
});
