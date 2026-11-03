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
const cache_1 = require("./cache");
const ASSETS = 'C:\\P\\Saved\\NullUnreal\\assets';
const cur = { engineVersion: '5.8.4', sourceMtime: 100, sourceSize: 2000 };
const doc = (over = {}) => JSON.stringify({
    schema: 1, ...cur, package: '/Game/A/T', kind: 'texture', class: 'Texture2D',
    references: { dependencies: [] }, data: {}, sidecars: { preview: 'T.png' }, ...over,
});
function io(files) {
    return { readFile: (p) => files[p], exists: (p) => p in files };
}
const files = (json, withPng = true) => ({
    [(0, cache_1.entryPath)(ASSETS, '/Game/A/T')]: json,
    ...(withPng ? { [`${ASSETS}\\Game\\A\\T.png`]: 'png' } : {}),
});
(0, node_test_1.test)('the entry for a package sits under assets/<package path>.json', () => {
    assert.equal((0, cache_1.entryPath)(ASSETS, '/Game/A/T'), `${ASSETS}\\Game\\A\\T.json`);
    assert.equal((0, cache_1.assetsDir)('C:\\P'), ASSETS);
});
(0, node_test_1.test)('a matching entry is a hit', () => {
    assert.equal((0, cache_1.lookup)(ASSETS, '/Game/A/T', cur, io(files(doc()))).state, 'hit');
});
(0, node_test_1.test)('no file is an absent miss', () => {
    assert.deepEqual((0, cache_1.lookup)(ASSETS, '/Game/A/T', cur, io({})), { state: 'miss', reason: 'absent' });
});
(0, node_test_1.test)('a corrupt file, or one for another package, is a corrupt miss', () => {
    assert.deepEqual((0, cache_1.lookup)(ASSETS, '/Game/A/T', cur, io(files('{"sch'))), { state: 'miss', reason: 'corrupt' });
    assert.deepEqual((0, cache_1.lookup)(ASSETS, '/Game/A/T', cur, io(files(doc({ package: '/Game/Other' })))), { state: 'miss', reason: 'corrupt' });
});
(0, node_test_1.test)('a changed mtime, size, engine version or schema is a stale miss', () => {
    for (const changed of [{ sourceMtime: 101 }, { sourceSize: 2001 }, { engineVersion: '5.8.5' }, { schema: 2 }]) {
        assert.deepEqual((0, cache_1.lookup)(ASSETS, '/Game/A/T', cur, io(files(doc(changed)))), { state: 'miss', reason: 'stale' }, JSON.stringify(changed));
    }
});
(0, node_test_1.test)('a deleted sidecar makes the entry stale; an unreadable sidecar entry needs no file', () => {
    assert.deepEqual((0, cache_1.lookup)(ASSETS, '/Game/A/T', cur, io(files(doc(), false))), { state: 'miss', reason: 'stale' });
    const unreadable = doc({ sidecars: { preview: { unreadable: 'no exporter' } } });
    assert.equal((0, cache_1.lookup)(ASSETS, '/Game/A/T', cur, io(files(unreadable, false))).state, 'hit');
});
//# sourceMappingURL=cache.test.js.map