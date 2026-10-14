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
const zlib = __importStar(require("node:zlib"));
const node_test_1 = require("node:test");
const activityBlob_1 = require("../activityBlob");
const iv = (start, over = {}) => ({
    start, end: start + 60_000, project: { key: 'k', name: 'proj' }, language: 'rust', file: 'a.rs', linesAdded: 2, linesRemoved: 1, window: 'w1', ...over,
});
const machine = { id: 'aaaaaaaaaa', name: 'Desk' };
(0, node_test_1.test)('round trip keeps intervals with their window id and drops the machine tag', () => {
    const text = (0, activityBlob_1.encodeMonth)(machine, [iv(2000, { machine: 'aaaaaaaaaa' }), iv(1000, { window: 'import-wakatime' })]);
    const blob = (0, activityBlob_1.decodeMonth)(text);
    node_assert_1.default.deepStrictEqual([blob.machine, blob.name], ['aaaaaaaaaa', 'Desk']);
    node_assert_1.default.deepStrictEqual(blob.intervals.map((i) => [i.start, i.window, i.machine]), [[1000, 'import-wakatime', undefined], [2000, 'w1', undefined]]);
});
(0, node_test_1.test)('equal data gives equal text regardless of input order, so the hash detects changes', () => {
    const a = iv(1000), b = iv(5000, { window: 'w2' });
    node_assert_1.default.strictEqual((0, activityBlob_1.blobHash)((0, activityBlob_1.encodeMonth)(machine, [a, b])), (0, activityBlob_1.blobHash)((0, activityBlob_1.encodeMonth)(machine, [b, a])));
    node_assert_1.default.notStrictEqual((0, activityBlob_1.blobHash)((0, activityBlob_1.encodeMonth)(machine, [a])), (0, activityBlob_1.blobHash)((0, activityBlob_1.encodeMonth)(machine, [a, b])));
});
(0, node_test_1.test)('decodeMonth rejects garbage, unknown versions and bad machine ids; bad lines are skipped', () => {
    node_assert_1.default.strictEqual((0, activityBlob_1.decodeMonth)('not base64 gzip'), undefined);
    const wrap = (s) => zlib.gzipSync(s).toString('base64');
    node_assert_1.default.strictEqual((0, activityBlob_1.decodeMonth)(wrap('{"v":2,"machine":"aaaaaaaaaa"}')), undefined);
    node_assert_1.default.strictEqual((0, activityBlob_1.decodeMonth)(wrap('{"v":1,"machine":"../x"}')), undefined);
    const ok = (0, activityBlob_1.decodeMonth)(wrap('{"v":1,"machine":"aaaaaaaaaa"}\n{broken\n' + JSON.stringify(iv(1000))));
    node_assert_1.default.strictEqual(ok.intervals.length, 1);
    node_assert_1.default.strictEqual(ok.name, 'aaaaaaaaaa');
});
(0, node_test_1.test)('blob names round trip and only the exact shape is accepted', () => {
    node_assert_1.default.deepStrictEqual((0, activityBlob_1.parseBlobName)((0, activityBlob_1.blobName)('aaaaaaaaaa', '2026-10')), { machine: 'aaaaaaaaaa', month: '2026-10' });
    for (const bad of ['activity__aaaaaaaaaa__2026-10.json', 'activity__../x__2026-10.enc', 'activity__aaaaaaaaaa__2026-1.enc', 'settings.json.enc', 'x/activity__aaaaaaaaaa__2026-10.enc']) {
        node_assert_1.default.strictEqual((0, activityBlob_1.parseBlobName)(bad), undefined, bad);
    }
});
//# sourceMappingURL=activityBlob.test.js.map