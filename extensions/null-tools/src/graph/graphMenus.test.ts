import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import test from 'node:test';

// out/graph -> out -> null-tools
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
type MenuItem = { command?: string; when?: string; group?: string };
const menus = manifest.contributes.menus as Record<string, MenuItem[]>;

test('Null: Pull is in the Commit Graph tab title, only on that tab, only when the graph is ready, and not mid-operation', () => {
  const items = menus['editor/title'].filter((m) => m.command === 'null.graph.pull');
  assert.strictEqual(items.length, 1);
  assert.strictEqual(
    items[0].when,
    "activeWebviewPanelId == 'null.commitGraph' && null.graph.state == ready && !null.graph.operationInProgress",
  );
});

test('the sidebar view keeps its own Null: Pull button', () => {
  const items = menus['view/title'].filter((m) => m.command === 'null.graph.pull');
  assert.strictEqual(items.length, 1);
  assert.match(items[0].when ?? '', /view == null\.graphView/);
});
