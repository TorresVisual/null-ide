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
const whenClause_1 = require("./whenClause");
(0, node_test_1.test)('no when clause always passes', () => {
    node_assert_1.default.strictEqual((0, whenClause_1.evaluateWhenClause)(undefined, {}), true);
});
(0, node_test_1.test)('languages: passes when active language is in the list', () => {
    node_assert_1.default.strictEqual((0, whenClause_1.evaluateWhenClause)({ languages: ['cpp', 'c'] }, { activeLanguageId: 'cpp' }), true);
});
(0, node_test_1.test)('languages: fails when active language is not in the list', () => {
    node_assert_1.default.strictEqual((0, whenClause_1.evaluateWhenClause)({ languages: ['cpp', 'c'] }, { activeLanguageId: 'python' }), false);
});
(0, node_test_1.test)('languages: fails when there is no active editor at all', () => {
    node_assert_1.default.strictEqual((0, whenClause_1.evaluateWhenClause)({ languages: ['cpp'] }, {}), false);
});
(0, node_test_1.test)('folder: passes when folder name matches, fails when it does not', () => {
    node_assert_1.default.strictEqual((0, whenClause_1.evaluateWhenClause)({ folder: 'backend' }, { folderName: 'backend' }), true);
    node_assert_1.default.strictEqual((0, whenClause_1.evaluateWhenClause)({ folder: 'backend' }, { folderName: 'frontend' }), false);
    node_assert_1.default.strictEqual((0, whenClause_1.evaluateWhenClause)({ folder: 'backend' }, {}), false);
});
(0, node_test_1.test)('filesExist: passes when every listed file exists under folderPath', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-test-'));
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
    node_assert_1.default.strictEqual((0, whenClause_1.evaluateWhenClause)({ filesExist: ['Cargo.toml'] }, { folderPath: dir }), true);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('filesExist: fails when any listed file is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-test-'));
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
    node_assert_1.default.strictEqual((0, whenClause_1.evaluateWhenClause)({ filesExist: ['Cargo.toml', 'missing.txt'] }, { folderPath: dir }), false);
    fs.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.test)('filesExist: fails when there is no folderPath to check against', () => {
    node_assert_1.default.strictEqual((0, whenClause_1.evaluateWhenClause)({ filesExist: ['Cargo.toml'] }, {}), false);
});
(0, node_test_1.test)('multiple conditions all must pass', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-test-'));
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]');
    const ctx = { activeLanguageId: 'rust', folderName: 'backend', folderPath: dir };
    node_assert_1.default.strictEqual((0, whenClause_1.evaluateWhenClause)({ languages: ['rust'], folder: 'backend', filesExist: ['Cargo.toml'] }, ctx), true);
    node_assert_1.default.strictEqual((0, whenClause_1.evaluateWhenClause)({ languages: ['python'], folder: 'backend', filesExist: ['Cargo.toml'] }, ctx), false);
    fs.rmSync(dir, { recursive: true, force: true });
});
//# sourceMappingURL=whenClause.test.js.map