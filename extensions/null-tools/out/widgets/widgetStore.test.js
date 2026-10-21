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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const widgetStore_1 = require("./widgetStore");
const snap = (writtenAt) => ({ schema: 1, writtenAt,
    projects: { status: 'ok', failed: [], items: [] }, issues: { status: 'ok', failed: [], items: [] }, prs: { status: 'ok', failed: [], items: [] } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-widgets-'));
(0, node_test_1.default)('write creates the folder, leaves no .tmp behind and round-trips', () => {
    const dir = path.join(tmp(), 'Null', 'widgets');
    const store = new widgetStore_1.SnapshotStore(dir);
    store.write(snap('2026-10-21T14:00:00Z'));
    node_assert_1.default.deepStrictEqual(fs.readdirSync(dir), ['snapshot.json']);
    node_assert_1.default.strictEqual(JSON.parse(fs.readFileSync(store.file, 'utf8')).writtenAt, '2026-10-21T14:00:00Z');
});
(0, node_test_1.default)('a second write replaces the first atomically (same file name, no partial state visible)', () => {
    const store = new widgetStore_1.SnapshotStore(tmp());
    store.write(snap('a'));
    store.write(snap('b'));
    node_assert_1.default.strictEqual(JSON.parse(fs.readFileSync(store.file, 'utf8')).writtenAt, 'b');
});
(0, node_test_1.default)('remove deletes the snapshot and a stale .tmp, and is fine when nothing exists', () => {
    const dir = tmp();
    const store = new widgetStore_1.SnapshotStore(dir);
    store.remove();
    fs.writeFileSync(path.join(dir, 'snapshot.json'), '{}');
    fs.writeFileSync(path.join(dir, 'snapshot.json.tmp'), '{');
    store.remove();
    node_assert_1.default.deepStrictEqual(fs.readdirSync(dir), []);
});
(0, node_test_1.default)('widgetsDir needs LOCALAPPDATA', () => {
    node_assert_1.default.strictEqual((0, widgetStore_1.widgetsDir)({ LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }), path.win32.join('C:\\Users\\u\\AppData\\Local', 'Null', 'widgets'));
    node_assert_1.default.throws(() => (0, widgetStore_1.widgetsDir)({}));
});
//# sourceMappingURL=widgetStore.test.js.map