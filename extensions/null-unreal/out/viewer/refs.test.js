"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const node_path_1 = require("node:path");
const packagePath_1 = require("../packagePath");
const refs_1 = require("./refs");
const mounts = [
    { name: '/Game', root: 'D:\P\Content' },
    { name: '/MyPlugin', root: 'D:\P\Plugins\MyPlugin\Content' },
];
(0, node_test_1.test)('packageToFile inverts toPackagePath, plugin mounts included', () => {
    for (const pkg of ['/Game/A/B', '/MyPlugin/X']) {
        const file = (0, refs_1.packageToFile)(pkg, mounts);
        node_assert_1.strict.ok(file);
        node_assert_1.strict.equal((0, packagePath_1.toPackagePath)(file, mounts), pkg);
    }
});
(0, node_test_1.test)('packageToFile is undefined for a package no mount serves', () => {
    node_assert_1.strict.equal((0, refs_1.packageToFile)('/Engine/Foo', mounts), undefined);
});
const doc = (sidecars) => ({ package: '/Game/A/T', sidecars });
(0, node_test_1.test)('sidecarFile resolves a file beside the entry JSON', () => {
    const assets = node_path_1.win32.join('D:\P', 'Saved', 'NullUnreal', 'assets');
    node_assert_1.strict.equal((0, refs_1.sidecarFile)(assets, doc({ preview: 'T.png' }), 'preview'), node_path_1.win32.join(assets, 'Game', 'A', 'T.png'));
});
(0, node_test_1.test)('sidecarFile is undefined for unreadable or missing sidecars', () => {
    const assets = 'D:\P\Saved\NullUnreal\assets';
    node_assert_1.strict.equal((0, refs_1.sidecarFile)(assets, doc({ preview: { unreadable: 'x' } }), 'preview'), undefined);
    node_assert_1.strict.equal((0, refs_1.sidecarFile)(assets, doc({}), 'preview'), undefined);
});
(0, node_test_1.test)('thumbnailMap gives null for packages without a cached preview', () => {
    const map = (0, refs_1.thumbnailMap)(['/Game/T', '/Game/U'], (p) => (p === '/Game/T' ? 'a.png' : undefined));
    node_assert_1.strict.deepEqual(map, { '/Game/T': 'a.png', '/Game/U': null });
});
//# sourceMappingURL=refs.test.js.map