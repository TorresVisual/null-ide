'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const sanitize_1 = require("../sanitize");
(0, node_test_1.test)('plain events pass through', () => {
    for (const e of ['*', 'onStartupFinished', 'onLanguage:typescript', 'onCommand:null-startup.openReport', 'onView:null.musicView', '']) {
        node_assert_1.default.strictEqual((0, sanitize_1.sanitizeEvent)(e), e);
    }
});
(0, node_test_1.test)('workspaceContains keeps only its type', () => {
    node_assert_1.default.strictEqual((0, sanitize_1.sanitizeEvent)('workspaceContains:**/*.csproj'), 'workspaceContains');
    node_assert_1.default.strictEqual((0, sanitize_1.sanitizeEvent)('workspaceContains:C:\\Users\\me\\proj\\x'), 'workspaceContains');
});
(0, node_test_1.test)('any event carrying a path keeps only its prefix', () => {
    node_assert_1.default.strictEqual((0, sanitize_1.sanitizeEvent)('onFileOpen:/home/me/x'), 'onFileOpen');
    node_assert_1.default.strictEqual((0, sanitize_1.sanitizeEvent)('onFileSystem:file'), 'onFileSystem:file');
    node_assert_1.default.strictEqual((0, sanitize_1.sanitizeEvent)('onDebugResolve:C:\\a\\b'), 'onDebugResolve');
});
//# sourceMappingURL=sanitize.test.js.map