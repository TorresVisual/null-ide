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
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const logs_1 = require("./logs");
function tempProject() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'null-unreal-logs-'));
}
(0, node_test_1.test)('openLog creates the missing Saved/NullUnreal folder and names the file by time', async () => {
    const dir = tempProject();
    const log = (0, logs_1.openLog)(dir, 'build', new Date(2026, 0, 2, 3, 4, 5));
    assert.equal(path.basename(log.path), 'build-20260102-030405.log');
    assert.ok(fs.existsSync(path.join(dir, 'Saved', 'NullUnreal')));
    await new Promise((done) => log.stream.end(done));
});
(0, node_test_1.test)('rotate keeps the newest 10 per command and leaves other commands alone', () => {
    const dir = tempProject();
    const logDir = path.join(dir, 'Saved', 'NullUnreal');
    fs.mkdirSync(logDir, { recursive: true });
    for (let i = 1; i <= 12; i++) {
        fs.writeFileSync(path.join(logDir, `build-20260101-0000${String(i).padStart(2, '0')}.log`), '');
    }
    fs.writeFileSync(path.join(logDir, 'test-20260101-000001.log'), '');
    (0, logs_1.rotate)(dir, 'build');
    const left = fs.readdirSync(logDir).sort();
    const builds = left.filter((n) => n.startsWith('build-'));
    assert.equal(builds.length, 10);
    assert.equal(builds[0], 'build-20260101-000003.log');
    assert.equal(builds[9], 'build-20260101-000012.log');
    assert.ok(left.includes('test-20260101-000001.log'));
});
(0, node_test_1.test)('openLog returns a warning instead of throwing when Saved is a file', () => {
    const dir = tempProject();
    fs.writeFileSync(path.join(dir, 'Saved'), 'not a folder');
    const log = (0, logs_1.openLog)(dir, 'smoke', new Date());
    assert.equal(log.path, undefined);
    assert.equal(typeof log.warning, 'string');
});
//# sourceMappingURL=logs.test.js.map