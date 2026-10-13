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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const probe_1 = require("./probe");
function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-env-probe-'));
    try {
        fn(dir);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
(0, node_test_1.describe)('executableNames', () => {
    (0, node_test_1.it)('expands PATHEXT on Windows', () => {
        assert.deepEqual((0, probe_1.executableNames)('claude', true, '.EXE;.CMD'), ['claude.exe', 'claude.cmd']);
    });
    (0, node_test_1.it)('keeps a name that already has an extension', () => {
        assert.deepEqual((0, probe_1.executableNames)('clang-cl.exe', true, '.EXE;.CMD'), ['clang-cl.exe']);
    });
    (0, node_test_1.it)('is the bare name elsewhere', () => {
        assert.deepEqual((0, probe_1.executableNames)('cmake', false), ['cmake']);
    });
    (0, node_test_1.it)('falls back to the default PATHEXT when it is empty', () => {
        assert.ok((0, probe_1.executableNames)('node', true, '').includes('node.cmd'));
    });
});
(0, node_test_1.describe)('findExecutable', () => {
    (0, node_test_1.it)('finds a file in the given dirs, in order', () => {
        withTempDir(a => withTempDir(b => {
            const file = (0, probe_1.executableNames)('faketool')[0];
            fs.writeFileSync(path.join(b, file), '');
            assert.equal((0, probe_1.findExecutable)('faketool', [a, b]), path.join(b, file));
        }));
    });
    (0, node_test_1.it)('returns null when absent', () => {
        withTempDir(dir => assert.equal((0, probe_1.findExecutable)('faketool', [dir]), null));
    });
    (0, node_test_1.it)('does not treat a directory as an executable', () => {
        withTempDir(dir => {
            fs.mkdirSync(path.join(dir, (0, probe_1.executableNames)('faketool')[0]));
            assert.equal((0, probe_1.findExecutable)('faketool', [dir]), null);
        });
    });
});
(0, node_test_1.describe)('findBundledBinary / configured paths', () => {
    (0, node_test_1.it)('finds a bundled binary when present', () => {
        withTempDir(dir => {
            fs.mkdirSync(path.join(dir, 'bin'));
            const fake = path.join(dir, 'bin', process.platform === 'win32' ? 'clang-format.exe' : 'clang-format');
            fs.writeFileSync(fake, '');
            assert.equal((0, probe_1.findBundledBinary)(dir, 'clang-format'), fake);
        });
    });
    (0, node_test_1.it)('prioritizes an explicitly configured clang-format path', () => {
        withTempDir(dir => {
            const custom = path.join(dir, 'custom-clang-format.exe');
            fs.writeFileSync(custom, '');
            assert.equal((0, probe_1.findClangFormatPath)(custom, dir), custom);
        });
    });
    // These two are spawned without a shell, so a .cmd/.bat shim earlier on PATH must not win over a real binary.
    (0, node_test_1.it)('never returns a .cmd shim for a tool that is spawned directly', { skip: process.platform !== 'win32' }, () => {
        withTempDir(shims => withTempDir(real => {
            fs.writeFileSync(path.join(shims, 'rustfmt.cmd'), '');
            fs.writeFileSync(path.join(shims, 'clang-format.cmd'), '');
            assert.equal((0, probe_1.findRustfmtPath)(undefined, undefined, [shims]), null);
            assert.equal((0, probe_1.findClangFormatPath)(undefined, undefined, [shims]), null);
            fs.writeFileSync(path.join(real, 'rustfmt.exe'), '');
            assert.equal((0, probe_1.findRustfmtPath)(undefined, undefined, [shims, real]), path.join(real, 'rustfmt.exe'));
        }));
    });
    (0, node_test_1.it)('prioritizes an explicitly configured rustfmt path', () => {
        withTempDir(dir => {
            const custom = path.join(dir, 'custom-rustfmt.exe');
            fs.writeFileSync(custom, '');
            assert.equal((0, probe_1.findRustfmtPath)(custom, dir), custom);
        });
    });
});
//# sourceMappingURL=probe.test.js.map