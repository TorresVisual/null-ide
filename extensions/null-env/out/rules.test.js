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
const rules_1 = require("./rules");
(0, node_test_1.test)('requirement ids are unique and every anyOf is non-empty', () => {
    const ids = rules_1.RULES.map(r => r.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const r of rules_1.RULES) {
        assert.ok(r.anyOf.length > 0, r.id);
    }
});
(0, node_test_1.test)('an extension requirement installs one of the ids it accepts', () => {
    for (const r of rules_1.RULES.filter(x => x.kind === 'extension')) {
        assert.equal(r.fix.kind, 'install', r.id);
        if (r.fix.kind === 'install') {
            assert.ok(r.anyOf.includes(r.fix.extensionId), r.id);
        }
    }
});
(0, node_test_1.test)('a tool requirement links to a download page', () => {
    for (const r of rules_1.RULES.filter(x => x.kind === 'tool')) {
        assert.equal(r.fix.kind, 'url', r.id);
        if (r.fix.kind === 'url') {
            assert.match(r.fix.url, /^https:\/\//, r.id);
        }
    }
});
(0, node_test_1.test)('the issue-89 requirements are present', () => {
    const ids = new Set(rules_1.RULES.map(r => r.id));
    for (const id of [
        'ext.clangd', 'ext.cpptools', 'ext.codelldb', 'ext.rust-analyzer', 'ext.claude-code',
        'tool.cmake', 'tool.clangd', 'tool.debugger', 'tool.clang-format',
        'tool.cargo', 'tool.rustfmt', 'tool.node', 'tool.claude',
    ]) {
        assert.ok(ids.has(id), id);
    }
});
(0, node_test_1.test)('debugExtensionFor maps the debug types null-cpp emits, and only those', () => {
    assert.deepEqual((0, rules_1.debugExtensionFor)('lldb'), { extensionId: 'vadimcn.vscode-lldb', label: 'CodeLLDB' });
    assert.deepEqual((0, rules_1.debugExtensionFor)('cppdbg'), { extensionId: 'ms-vscode.cpptools', label: 'C/C++ (cpptools)' });
    assert.equal((0, rules_1.debugExtensionFor)('node'), undefined);
    assert.equal((0, rules_1.debugExtensionFor)('constructor'), undefined);
});
(0, node_test_1.test)('the debug type extensions are the same ids the cpp rules install', () => {
    const installs = new Set(rules_1.RULES.flatMap(r => (r.fix.kind === 'install' ? [r.fix.extensionId] : [])));
    assert.ok(installs.has((0, rules_1.debugExtensionFor)('lldb').extensionId));
    assert.ok(installs.has((0, rules_1.debugExtensionFor)('cppdbg').extensionId));
});
//# sourceMappingURL=rules.test.js.map