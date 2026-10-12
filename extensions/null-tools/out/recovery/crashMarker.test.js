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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const crashMarker_1 = require("./crashMarker");
const DAY = 24 * 3600 * 1000;
function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'null-recovery-'));
}
(0, node_test_1.test)('a marker whose pid is dead is reported as crashed', () => {
    const dir = tempDir();
    try {
        const marker = { pid: 4242, startedAt: 1000, folders: ['D:\\Repo'] };
        const file = (0, crashMarker_1.writeMarker)(dir, marker);
        assert.deepEqual((0, crashMarker_1.findCrashed)(dir, () => false, 2000, DAY), [{ file, marker }]);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('a marker whose pid is alive is not crashed, and removeMarker clears it', () => {
    const dir = tempDir();
    try {
        const file = (0, crashMarker_1.writeMarker)(dir, { pid: 4242, startedAt: 1000, folders: [] });
        assert.deepEqual((0, crashMarker_1.findCrashed)(dir, () => true, 2000, DAY), []);
        (0, crashMarker_1.removeMarker)(file);
        assert.deepEqual((0, crashMarker_1.findCrashed)(dir, () => false, 2000, DAY), []);
        (0, crashMarker_1.removeMarker)(file); // already gone: must not throw
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('a corrupt marker is deleted and ignored', () => {
    const dir = tempDir();
    try {
        const bad = path.join(dir, '1-1.json');
        fs.writeFileSync(bad, '{nope');
        const wrongShape = path.join(dir, '2-2.json');
        fs.writeFileSync(wrongShape, JSON.stringify({ pid: 'x', startedAt: 1, folders: [] }));
        assert.deepEqual((0, crashMarker_1.findCrashed)(dir, () => false, 2000, DAY), []);
        assert.equal(fs.existsSync(bad), false);
        assert.equal(fs.existsSync(wrongShape), false);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('a marker older than the max age is deleted even though its pid is dead', () => {
    const dir = tempDir();
    try {
        const file = (0, crashMarker_1.writeMarker)(dir, { pid: 4242, startedAt: 0, folders: ['D:\\Repo'] });
        assert.deepEqual((0, crashMarker_1.findCrashed)(dir, () => false, 31 * DAY, 30 * DAY), []);
        assert.equal(fs.existsSync(file), false);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('writeMarker leaves no temp file behind and temp files are never read as markers', () => {
    const dir = tempDir();
    try {
        (0, crashMarker_1.writeMarker)(dir, { pid: 1, startedAt: 1, folders: [] });
        fs.writeFileSync(path.join(dir, '9-9.json.tmp'), '{"half');
        assert.deepEqual(fs.readdirSync(dir).filter(f => f === '1-1.json.tmp'), []);
        assert.equal((0, crashMarker_1.findCrashed)(dir, () => false, 2000, DAY).length, 1);
        assert.equal(fs.existsSync(path.join(dir, '9-9.json.tmp')), true);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('findCrashed on a missing directory returns an empty list', () => {
    assert.deepEqual((0, crashMarker_1.findCrashed)(path.join(os.tmpdir(), 'null-recovery-does-not-exist'), () => false, 1, DAY), []);
});
(0, node_test_1.test)('isPidAlive: this process is alive, an absurd pid is not', () => {
    assert.equal((0, crashMarker_1.isPidAlive)(process.pid), true);
    assert.equal((0, crashMarker_1.isPidAlive)(2147483646), false);
});
(0, node_test_1.test)('sharesFolder compares workspace folders case-insensitively', () => {
    assert.equal((0, crashMarker_1.sharesFolder)(['D:\\Coding\\Repo'], ['d:\\coding\\repo']), true);
    assert.equal((0, crashMarker_1.sharesFolder)(['D:\\Coding\\Repo', 'D:\\Other'], ['d:\\other']), true);
    assert.equal((0, crashMarker_1.sharesFolder)(['D:\\Coding\\Repo'], ['D:\\Coding\\Different']), false);
    assert.equal((0, crashMarker_1.sharesFolder)([], ['D:\\Coding\\Repo']), false);
});
//# sourceMappingURL=crashMarker.test.js.map