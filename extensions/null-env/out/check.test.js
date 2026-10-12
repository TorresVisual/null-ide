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
const check_1 = require("./check");
function probes(extensions = [], tools = []) {
    return { hasExtension: id => extensions.includes(id), hasTool: name => tools.includes(name) };
}
const ALL_EXTENSIONS = [
    'llvm-vs-code-extensions.vscode-clangd', 'ms-vscode.cpptools', 'vadimcn.vscode-lldb',
    'rust-lang.rust-analyzer', 'anthropic.claude-code',
];
const ALL_TOOLS = ['cmake', 'clangd', 'gdb', 'clang-format', 'cargo', 'rustfmt', 'node', 'claude'];
const ids = (findings) => findings.map(f => f.id);
(0, node_test_1.test)('everything present means no findings', () => {
    assert.deepEqual((0, check_1.check)(['cpp', 'rust', 'node'], probes(ALL_EXTENSIONS, ALL_TOOLS)), []);
});
(0, node_test_1.test)('a cmake project with nothing installed names cpptools, CodeLLDB and clangd', () => {
    const found = ids((0, check_1.check)(['cpp'], probes()));
    for (const id of ['ext.clangd', 'ext.cpptools', 'ext.codelldb', 'tool.cmake']) {
        assert.ok(found.includes(id), id);
    }
});
(0, node_test_1.test)('anyOf is satisfied by a single entry', () => {
    const found = ids((0, check_1.check)(['cpp'], probes(ALL_EXTENSIONS, ['cmake', 'clangd', 'clang-format', 'claude', 'gdb'])));
    assert.deepEqual(found, []);
    const lldbOnly = ids((0, check_1.check)(['cpp'], probes(ALL_EXTENSIONS, ['cmake', 'clangd', 'clang-format', 'claude', 'lldb'])));
    assert.deepEqual(lldbOnly, []);
});
(0, node_test_1.test)('a cargo project without rust-analyzer or rustfmt reports both', () => {
    const found = ids((0, check_1.check)(['rust'], probes(['anthropic.claude-code'], ['cargo', 'claude'])));
    assert.deepEqual(found, ['ext.rust-analyzer', 'tool.rustfmt']);
});
(0, node_test_1.test)('requirements for languages that are not detected are not reported', () => {
    const found = ids((0, check_1.check)(['node'], probes()));
    assert.deepEqual(found, ['tool.node', 'ext.claude-code', 'tool.claude']);
});
(0, node_test_1.test)('with no language only the all-language rules apply', () => {
    assert.deepEqual(ids((0, check_1.check)([], probes())), ['ext.claude-code', 'tool.claude']);
});
(0, node_test_1.test)('a repeated language (multi-root workspace) reports each requirement once', () => {
    const once = ids((0, check_1.check)(['cpp'], probes()));
    const twice = ids((0, check_1.check)(['cpp', 'cpp'], probes()));
    assert.deepEqual(twice, once);
    assert.equal(new Set(twice).size, twice.length);
});
(0, node_test_1.test)('findings carry the fix and omit the language list', () => {
    const [first] = (0, check_1.check)(['rust'], probes());
    assert.ok(first.fix);
    assert.equal('languages' in first, false);
});
(0, node_test_1.test)('only required findings are visible, and a snooze hides them until the set changes', () => {
    const cpp = (0, check_1.check)(['cpp'], probes(ALL_EXTENSIONS, ALL_TOOLS));
    assert.deepEqual((0, check_1.visibleRequired)(cpp, undefined), []);
    const missing = (0, check_1.check)(['cpp'], probes([], ['cmake', 'clangd', 'gdb', 'clang-format', 'claude']));
    const required = (0, check_1.visibleRequired)(missing, undefined);
    assert.ok(required.length > 0);
    assert.ok(required.every(f => f.severity === 'required'));
    const snoozed = (0, check_1.requiredSignature)(missing);
    assert.deepEqual((0, check_1.visibleRequired)(missing, snoozed), []);
    // A new required item (cmake) goes missing: the snooze no longer matches and the warning returns.
    const worse = (0, check_1.check)(['cpp'], probes([], ['clangd', 'gdb', 'clang-format', 'claude']));
    assert.notEqual((0, check_1.requiredSignature)(worse), snoozed);
    assert.ok((0, check_1.visibleRequired)(worse, snoozed).length > 0);
});
//# sourceMappingURL=check.test.js.map