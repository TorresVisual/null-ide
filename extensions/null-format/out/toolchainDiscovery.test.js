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
const assert = __importStar(require("node:assert"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const toolchainDiscovery_1 = require("./toolchainDiscovery");
(0, node_test_1.describe)('toolchainDiscovery', () => {
    (0, node_test_1.it)('finds bundled binary when present', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-format-bin-test-'));
        try {
            const binDir = path.join(tempDir, 'bin');
            fs.mkdirSync(binDir, { recursive: true });
            const fakeBinary = path.join(binDir, process.platform === 'win32' ? 'clang-format.exe' : 'clang-format');
            fs.writeFileSync(fakeBinary, '');
            const found = (0, toolchainDiscovery_1.findBundledBinary)(tempDir, 'clang-format');
            assert.strictEqual(found, fakeBinary);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)('prioritizes explicitly configured path', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-format-bin-test-'));
        try {
            const customPath = path.join(tempDir, 'custom-clang-format.exe');
            fs.writeFileSync(customPath, '');
            const found = (0, toolchainDiscovery_1.findClangFormatPath)(customPath, tempDir);
            assert.strictEqual(found, customPath);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
    (0, node_test_1.it)('prioritizes explicitly configured rustfmt path', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-format-bin-test-'));
        try {
            const customPath = path.join(tempDir, 'custom-rustfmt.exe');
            fs.writeFileSync(customPath, '');
            const found = (0, toolchainDiscovery_1.findRustfmtPath)(customPath, tempDir);
            assert.strictEqual(found, customPath);
        }
        finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=toolchainDiscovery.test.js.map