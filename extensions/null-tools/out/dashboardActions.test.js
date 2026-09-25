'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const dashboardActions_1 = require("./dashboardActions");
(0, node_test_1.default)('createProjectDirectory creates the folder and git-inits it', () => {
    const parent = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'dashboard-newproject-'));
    const target = node_path_1.default.join(parent, 'my-app');
    const result = (0, dashboardActions_1.createProjectDirectory)(target);
    node_assert_1.default.deepStrictEqual(result, { ok: true });
    node_assert_1.default.ok((0, node_fs_1.existsSync)(node_path_1.default.join(target, '.git')));
});
(0, node_test_1.default)('createProjectDirectory fails with a message when the target already exists', () => {
    const parent = (0, node_fs_1.mkdtempSync)(node_path_1.default.join((0, node_os_1.tmpdir)(), 'dashboard-newproject-'));
    const target = node_path_1.default.join(parent, 'my-app');
    (0, node_fs_1.mkdirSync)(target);
    const result = (0, dashboardActions_1.createProjectDirectory)(target);
    node_assert_1.default.strictEqual(result.ok, false);
    node_assert_1.default.match(result.message, /EEXIST/);
});
//# sourceMappingURL=dashboardActions.test.js.map