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
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const autoGitignoreStorage_1 = require("./autoGitignoreStorage");
(0, node_test_1.test)('isPatternInGitignore accurately matches exact and directory entries', () => {
    const content = `# Comment\nnode_modules/\n.null/\n/dist/\n*.log`;
    node_assert_1.default.strictEqual((0, autoGitignoreStorage_1.isPatternInGitignore)(content, 'node_modules/'), true);
    node_assert_1.default.strictEqual((0, autoGitignoreStorage_1.isPatternInGitignore)(content, 'node_modules'), true);
    node_assert_1.default.strictEqual((0, autoGitignoreStorage_1.isPatternInGitignore)(content, '.null/'), true);
    node_assert_1.default.strictEqual((0, autoGitignoreStorage_1.isPatternInGitignore)(content, 'dist/'), true);
    node_assert_1.default.strictEqual((0, autoGitignoreStorage_1.isPatternInGitignore)(content, '*.log'), true);
    node_assert_1.default.strictEqual((0, autoGitignoreStorage_1.isPatternInGitignore)(content, '.venv/'), false);
});
(0, node_test_1.test)('getMissingEntries returns only artifacts not present in gitignore', () => {
    const existing = `node_modules/\n.null/\n`;
    const detected = ['node_modules/', '.venv/', 'dist/'];
    const missing = (0, autoGitignoreStorage_1.getMissingEntries)(existing, detected);
    node_assert_1.default.deepStrictEqual(missing, ['.venv/', 'dist/']);
});
(0, node_test_1.test)('updateGitignoreContent appends section header and missing entries cleanly', () => {
    const existing = `node_modules/\n`;
    const missing = ['.venv/', 'dist/'];
    const updated = (0, autoGitignoreStorage_1.updateGitignoreContent)(existing, missing);
    node_assert_1.default.ok(updated.includes('# Added by Null IDE Auto-Gitignore'));
    node_assert_1.default.ok(updated.includes('.venv/'));
    node_assert_1.default.ok(updated.includes('dist/'));
    node_assert_1.default.ok(updated.startsWith('node_modules/\n'));
});
(0, node_test_1.test)('updateGitignoreContent does not add section header twice', () => {
    const existing = `node_modules/\n\n# Added by Null IDE Auto-Gitignore\n.venv/\n`;
    const missing = ['dist/'];
    const updated = (0, autoGitignoreStorage_1.updateGitignoreContent)(existing, missing);
    const count = (updated.match(/# Added by Null IDE Auto-Gitignore/g) || []).length;
    node_assert_1.default.strictEqual(count, 1);
    node_assert_1.default.ok(updated.includes('dist/'));
});
(0, node_test_1.test)('detectArtifactsInRoot finds existing artifact directories and files on disk', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-gitignore-test-'));
    try {
        fs.mkdirSync(path.join(tempDir, 'node_modules'));
        fs.mkdirSync(path.join(tempDir, '.venv'));
        fs.writeFileSync(path.join(tempDir, 'app.log'), 'test log');
        const patterns = ['node_modules/', '.venv/', 'dist/', '*.log'];
        const detected = (0, autoGitignoreStorage_1.detectArtifactsInRoot)(tempDir, patterns);
        node_assert_1.default.ok(detected.includes('node_modules/'));
        node_assert_1.default.ok(detected.includes('.venv/'));
        node_assert_1.default.ok(detected.includes('*.log'));
        node_assert_1.default.strictEqual(detected.includes('dist/'), false);
    }
    finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
//# sourceMappingURL=autoGitignore.test.js.map