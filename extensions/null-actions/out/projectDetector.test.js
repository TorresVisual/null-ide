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
const node_test_1 = require("node:test");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const projectDetector_1 = require("./projectDetector");
function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-detect-'));
}
(0, node_test_1.test)('empty folder yields no suggestions', () => {
    const dir = tmpDir();
    node_assert_1.default.deepStrictEqual((0, projectDetector_1.detectSuggestedButtons)(dir), []);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('Cargo.toml yields cargo suggestions', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "x"');
    const suggestions = (0, projectDetector_1.detectSuggestedButtons)(dir);
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cargo run'));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cargo build'));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cargo test'));
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('CMakeLists.txt yields cmake suggestions', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'CMakeLists.txt'), 'project(x)');
    const suggestions = (0, projectDetector_1.detectSuggestedButtons)(dir);
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cmake -B build'));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cmake --build build'));
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('a .csproj file yields dotnet suggestions', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'App.csproj'), '<Project />');
    const suggestions = (0, projectDetector_1.detectSuggestedButtons)(dir);
    node_assert_1.default.ok(suggestions.some(s => s.command === 'dotnet build'));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'dotnet run'));
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('multiple manifests present yields the union of their suggestions', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
    fs.writeFileSync(path.join(dir, 'CMakeLists.txt'), 'project(x)');
    const suggestions = (0, projectDetector_1.detectSuggestedButtons)(dir);
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cargo run'));
    node_assert_1.default.ok(suggestions.some(s => s.command === 'cmake -B build'));
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('suggestion ids are unique within one result set', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
    const suggestions = (0, projectDetector_1.detectSuggestedButtons)(dir);
    const ids = suggestions.map(s => s.id);
    node_assert_1.default.strictEqual(new Set(ids).size, ids.length);
    fs.rmSync(dir, { recursive: true, force: true });
});
//# sourceMappingURL=projectDetector.test.js.map