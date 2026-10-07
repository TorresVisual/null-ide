'use strict';
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const node_test_1 = require("node:test");
const libraryCache_1 = require("../library/libraryCache");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-music-cache-'));
(0, node_test_1.after)(() => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
const cacheFile = () => path.join(dir, `c${n++}`, 'library-cache.json');
(0, node_test_1.test)('lookup reuses an entry only when mtime and size both match', () => {
    const c = new libraryCache_1.LibraryCache(cacheFile());
    c.set('/m/a.mp3', 100, 5, { title: 'A' });
    node_assert_1.default.deepStrictEqual(c.lookup('/m/a.mp3', 100, 5), { title: 'A' });
    node_assert_1.default.strictEqual(c.lookup('/m/a.mp3', 101, 5), undefined);
    node_assert_1.default.strictEqual(c.lookup('/m/a.mp3', 100, 6), undefined);
    node_assert_1.default.strictEqual(c.lookup('/m/other.mp3', 100, 5), undefined);
});
(0, node_test_1.test)('an untagged file caches as {} and still counts as a hit', () => {
    const c = new libraryCache_1.LibraryCache(cacheFile());
    c.set('/m/a.mp3', 1, 1, {});
    node_assert_1.default.deepStrictEqual(c.lookup('/m/a.mp3', 1, 1), {});
});
(0, node_test_1.test)('save writes atomically, load restores, prune drops unseen files', async () => {
    const file = cacheFile();
    const c = new libraryCache_1.LibraryCache(file);
    c.set('/m/a.mp3', 1, 1, { title: 'A' });
    c.set('/m/b.mp3', 2, 2, { title: 'B' });
    c.prune(new Set(['/m/a.mp3']));
    await c.save();
    node_assert_1.default.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['library-cache.json']); // no .tmp left
    const again = new libraryCache_1.LibraryCache(file);
    await again.load();
    node_assert_1.default.deepStrictEqual([...again.entries()], [['/m/a.mp3', { title: 'A' }]]);
});
(0, node_test_1.test)('setDuration persists the learned duration', async () => {
    const file = cacheFile();
    const c = new libraryCache_1.LibraryCache(file);
    c.set('/m/a.mp3', 1, 1, { title: 'A' });
    await c.save();
    c.setDuration('/m/a.mp3', 123000);
    await c.save();
    const again = new libraryCache_1.LibraryCache(file);
    await again.load();
    node_assert_1.default.strictEqual(again.lookup('/m/a.mp3', 1, 1)?.durationMs, 123000);
});
(0, node_test_1.test)('corrupt or wrong-version caches are discarded', async () => {
    const file = cacheFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json');
    const a = new libraryCache_1.LibraryCache(file);
    await a.load();
    node_assert_1.default.deepStrictEqual([...a.entries()], []);
    fs.writeFileSync(file, JSON.stringify({ version: libraryCache_1.CACHE_VERSION + 1, entries: { '/m/a.mp3': { mtime: 1, size: 1, tags: {} } } }));
    const b = new libraryCache_1.LibraryCache(file);
    await b.load();
    node_assert_1.default.deepStrictEqual([...b.entries()], []);
});
(0, node_test_1.test)('a clean cache does not touch disk and an unwritable path never throws', async () => {
    const file = cacheFile();
    await new libraryCache_1.LibraryCache(file).save();
    node_assert_1.default.strictEqual(fs.existsSync(file), false);
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'x');
    const c = new libraryCache_1.LibraryCache(path.join(blocker, 'library-cache.json'));
    c.set('/m/a.mp3', 1, 1, {});
    await c.save(); // resolves
});
//# sourceMappingURL=libraryCache.test.js.map