'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = require("node:test");
const node_vm_1 = __importDefault(require("node:vm"));
const sandbox = node_vm_1.default.createContext({});
node_vm_1.default.runInContext((0, node_fs_1.readFileSync)(node_path_1.default.join(__dirname, 'webview-settings-shared.js'), 'utf8'), sandbox);
const d = sandbox;
(0, node_test_1.test)('escapes every special character', () => {
    node_assert_1.default.strictEqual(d.escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
    node_assert_1.default.strictEqual(d.escapeAttr(`a"b'c`), 'a&quot;b&#39;c');
});
(0, node_test_1.test)('escapes & first so entities are not double-decoded', () => {
    node_assert_1.default.strictEqual(d.escapeHtml('&lt;'), '&amp;lt;');
});
(0, node_test_1.test)('null, undefined and numbers are safe', () => {
    node_assert_1.default.strictEqual(d.escapeHtml(null), '');
    node_assert_1.default.strictEqual(d.escapeAttr(undefined), '');
    node_assert_1.default.strictEqual(d.escapeAttr(0), '0');
});
//# sourceMappingURL=settingsDom.test.js.map