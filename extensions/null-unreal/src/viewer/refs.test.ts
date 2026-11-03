import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { win32 as win } from 'node:path';
import { Mount, toPackagePath } from '../packagePath';
import { ExportDoc } from '../exportFormat';
import { packageToFile, sidecarFile, thumbnailMap } from './refs';

const mounts: Mount[] = [
  { name: '/Game', root: 'D:\P\Content' },
  { name: '/MyPlugin', root: 'D:\P\Plugins\MyPlugin\Content' },
];

test('packageToFile inverts toPackagePath, plugin mounts included', () => {
  for (const pkg of ['/Game/A/B', '/MyPlugin/X']) {
    const file = packageToFile(pkg, mounts);
    assert.ok(file);
    assert.equal(toPackagePath(file, mounts), pkg);
  }
});

test('packageToFile is undefined for a package no mount serves', () => {
  assert.equal(packageToFile('/Engine/Foo', mounts), undefined);
});

const doc = (sidecars: ExportDoc['sidecars']) => ({ package: '/Game/A/T', sidecars }) as unknown as ExportDoc;

test('sidecarFile resolves a file beside the entry JSON', () => {
  const assets = win.join('D:\P', 'Saved', 'NullUnreal', 'assets');
  assert.equal(sidecarFile(assets, doc({ preview: 'T.png' }), 'preview'), win.join(assets, 'Game', 'A', 'T.png'));
});

test('sidecarFile is undefined for unreadable or missing sidecars', () => {
  const assets = 'D:\P\Saved\NullUnreal\assets';
  assert.equal(sidecarFile(assets, doc({ preview: { unreadable: 'x' } }), 'preview'), undefined);
  assert.equal(sidecarFile(assets, doc({}), 'preview'), undefined);
});

test('thumbnailMap gives null for packages without a cached preview', () => {
  const map = thumbnailMap(['/Game/T', '/Game/U'], (p) => (p === '/Game/T' ? 'a.png' : undefined));
  assert.deepEqual(map, { '/Game/T': 'a.png', '/Game/U': null });
});
