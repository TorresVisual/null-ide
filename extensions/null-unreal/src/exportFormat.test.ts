import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ExportDoc, parseExport, parseManifest, summarize } from './exportFormat';

const doc = (over: Record<string, unknown> = {}) => ({
  schema: 1, engineVersion: '5.8.4', sourceMtime: 1, sourceSize: 2, package: '/Game/T', kind: 'texture', class: 'Texture2D',
  references: { dependencies: [] }, data: { width: 4, height: 2, compression: 'TC_MASKS' }, sidecars: {}, ...over,
});

test('a well-formed export parses', () => {
  assert.equal(parseExport(JSON.stringify(doc()))?.package, '/Game/T');
});

test('unparseable, truncated and wrong-shaped exports are rejected, never thrown', () => {
  assert.equal(parseExport('{"schema":1,"engi'), undefined);
  assert.equal(parseExport('[]'), undefined);
  assert.equal(parseExport(JSON.stringify(doc({ kind: 'blueprint' }))), undefined);
  assert.equal(parseExport(JSON.stringify(doc({ sourceMtime: 'x' }))), undefined);
  assert.equal(parseExport(JSON.stringify(doc({ references: {} }))), undefined);
});

test('a manifest maps each package to its status', () => {
  const m = parseManifest(JSON.stringify({ schema: 1, assets: { '/Game/A': { status: 'exported' }, '/Game/B': { status: 'failed', error: 'boom' } } }));
  assert.deepEqual(m, { '/Game/A': { status: 'exported' }, '/Game/B': { status: 'failed', error: 'boom' } });
});

test('a manifest with an unknown status or a broken file is rejected', () => {
  assert.equal(parseManifest(JSON.stringify({ assets: { '/Game/A': { status: 'maybe' } } })), undefined);
  assert.equal(parseManifest('{"assets":'), undefined);
});

test('summarize gives one line per kind', () => {
  const d = (kind: string, data: Record<string, unknown>) => parseExport(JSON.stringify(doc({ kind, data })))! as ExportDoc;
  assert.equal(summarize(d('material', { expressions: [1, 2, 3], parameters: [1] })), 'Material, 3 expressions, 1 parameters');
  assert.equal(summarize(d('texture', { width: 4, height: 2, compression: 'TC_MASKS' })), 'Texture 4x2, TC_MASKS');
  assert.equal(summarize(d('skeletal-mesh', { bones: [1, 2], lods: [1] })), 'Skeletal mesh, 2 bones, 1 LODs');
  assert.equal(summarize(d('material-instance', { parent: '/Game/M' })), 'Material instance of /Game/M');
  assert.equal(summarize(d('generic', {})), 'Texture2D (generic export)');
});
