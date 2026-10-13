"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const extensionSet_1 = require("./extensionSet");
(0, node_test_1.describe)('mergeExtensions', () => {
    (0, node_test_1.it)('first sync with no remote list uploads everything this device has', () => {
        assert.deepEqual((0, extensionSet_1.mergeExtensions)(['a', 'b'], null, undefined), { install: [], notifyRemoved: [], push: ['a', 'b'], nextBase: ['a', 'b'] });
    });
    (0, node_test_1.it)('first sync joins two different sets in both directions', () => {
        assert.deepEqual((0, extensionSet_1.mergeExtensions)(['a', 'b'], ['b', 'c'], undefined), {
            install: ['c'],
            notifyRemoved: [],
            push: ['a', 'b', 'c'],
            nextBase: ['a', 'b'],
        });
    });
    (0, node_test_1.it)('is stable once everything is installed', () => {
        assert.deepEqual((0, extensionSet_1.mergeExtensions)(['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b']), {
            install: [],
            notifyRemoved: [],
            push: undefined,
            nextBase: ['a', 'b', 'c'],
        });
    });
    (0, node_test_1.it)('an extension added elsewhere is to install, one removed elsewhere is only reported', () => {
        assert.deepEqual((0, extensionSet_1.mergeExtensions)(['a', 'b'], ['a', 'c'], ['a', 'b']), {
            install: ['c'],
            notifyRemoved: ['b'],
            push: undefined,
            nextBase: ['a', 'b'],
        });
    });
    (0, node_test_1.it)('an extension uninstalled here is removed from the cloud list', () => {
        assert.deepEqual((0, extensionSet_1.mergeExtensions)(['a'], ['a', 'b'], ['a', 'b']), { install: [], notifyRemoved: [], push: ['a'], nextBase: ['a'] });
    });
    (0, node_test_1.it)('both sides adding the same extension is not a change', () => {
        assert.deepEqual((0, extensionSet_1.mergeExtensions)(['a', 'x'], ['a', 'x'], ['a']), { install: [], notifyRemoved: [], push: undefined, nextBase: ['a', 'x'] });
    });
    (0, node_test_1.it)('a removal on both sides is a no-op', () => {
        assert.deepEqual((0, extensionSet_1.mergeExtensions)(['a'], ['a'], ['a', 'b']), { install: [], notifyRemoved: [], push: undefined, nextBase: ['a'] });
    });
    (0, node_test_1.it)('a device with nothing installed and no remote list creates an empty list', () => {
        assert.equal((0, extensionSet_1.mergeExtensions)([], null, undefined).push?.length, 0);
        assert.equal((0, extensionSet_1.mergeExtensions)([], [], undefined).push, undefined);
    });
});
(0, node_test_1.describe)('two devices converge', () => {
    const cloud = { ids: null };
    function sync(dev, interactive) {
        let merge = (0, extensionSet_1.mergeExtensions)([...dev.installed], cloud.ids, dev.base);
        if (interactive) {
            for (const id of merge.install)
                dev.installed.add(id);
            merge = (0, extensionSet_1.mergeExtensions)([...dev.installed], cloud.ids, dev.base);
        }
        if (merge.push)
            cloud.ids = merge.push;
        dev.base = merge.nextBase;
        return merge;
    }
    (0, node_test_1.it)('adds propagate, removals are reported and never re-uploaded', () => {
        const a = { installed: new Set(['x', 'y']) };
        const b = { installed: new Set(['y', 'z']) };
        sync(a, true);
        sync(b, true);
        sync(a, true);
        assert.deepEqual([...a.installed].sort(), ['x', 'y', 'z']);
        assert.deepEqual([...b.installed].sort(), ['x', 'y', 'z']);
        assert.equal(sync(a, true).push, undefined);
        assert.equal(sync(b, true).push, undefined);
        a.installed.delete('y');
        sync(a, true);
        assert.deepEqual(cloud.ids, ['x', 'z']);
        assert.deepEqual(sync(b, false).notifyRemoved, ['y']);
        assert.equal(b.installed.has('y'), true, 'a removal elsewhere never uninstalls here');
        const again = sync(b, false);
        assert.deepEqual(again.notifyRemoved, ['y']);
        assert.equal(again.push, undefined);
        assert.deepEqual(cloud.ids, ['x', 'z']);
        b.installed.delete('y');
        b.base = b.base.filter((id) => id !== 'y');
        const settled = sync(b, true);
        assert.deepEqual(settled.notifyRemoved, []);
        assert.equal(settled.push, undefined);
    });
});
(0, node_test_1.describe)('parseIds', () => {
    (0, node_test_1.it)('lowercases, sorts and de-duplicates a list of strings', () => {
        assert.deepEqual((0, extensionSet_1.parseIds)('["B.two","a.one","A.ONE"]'), ['a.one', 'b.two']);
    });
    (0, node_test_1.it)('rejects anything else', () => {
        for (const t of ['', 'nope', '{}', '[1]', '["a",2]'])
            assert.equal((0, extensionSet_1.parseIds)(t), undefined, t);
    });
});
(0, node_test_1.describe)('installedIds', () => {
    const manifest = JSON.stringify([
        { identifier: { id: 'Ms-Python.Python', uuid: '1' }, version: '1.0.0', metadata: { isBuiltin: false } },
        { identifier: { id: 'null.something' }, metadata: { isBuiltin: true } },
        { identifier: { id: 'machine.only' }, metadata: { isMachineScoped: true } },
        { identifier: { id: 'rust-lang.rust-analyzer' } },
        { nothing: true },
    ]);
    (0, node_test_1.it)('lists user extensions (enabled or not), lowercased, without built-ins or machine-scoped ones', () => {
        assert.deepEqual((0, extensionSet_1.installedIds)(manifest), ['ms-python.python', 'rust-lang.rust-analyzer']);
    });
    (0, node_test_1.it)('returns undefined rather than an empty list when the file cannot be read, so nothing is mistaken for "all uninstalled"', () => {
        for (const t of ['', '{ half a fi', '{}', 'null'])
            assert.equal((0, extensionSet_1.installedIds)(t), undefined, t);
    });
    (0, node_test_1.it)('an empty list is a real answer', () => {
        assert.deepEqual((0, extensionSet_1.installedIds)('[]'), []);
    });
});
//# sourceMappingURL=extensionSet.test.js.map