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
const jsonc_parser_1 = require("jsonc-parser");
const settingsFilter_1 = require("./settingsFilter");
const EXCL = ['*.path', '*Path', '*token*', 'http.proxy'];
const obj = (text) => (0, jsonc_parser_1.parse)(text ?? '');
(0, node_test_1.describe)('matchesKey', () => {
    (0, node_test_1.it)('matches glob patterns case-insensitively and anchored', () => {
        for (const k of ['git.path', 'rust-analyzer.server.path', 'python.defaultInterpreterPath', 'x.apiToken', 'http.proxy']) {
            assert.equal((0, settingsFilter_1.matchesKey)(k, EXCL), true, k);
        }
        for (const k of ['editor.fontSize', 'paths.x', 'workbench.colorTheme'])
            assert.equal((0, settingsFilter_1.matchesKey)(k, EXCL), false, k);
    });
    (0, node_test_1.it)('treats a dot in a pattern literally', () => {
        assert.equal((0, settingsFilter_1.matchesKey)('httpXproxy', ['http.proxy']), false);
    });
});
(0, node_test_1.describe)('stripExcluded', () => {
    const src = '{\n  // font\n  "editor.fontSize": 14,\n  "git.path": "C:\\\\git.exe",\n  "workbench.colorTheme": "Null Dark"\n}\n';
    (0, node_test_1.it)('removes matching keys and keeps comments, indentation and the other keys', () => {
        assert.equal((0, settingsFilter_1.stripExcluded)(src, EXCL), '{\n  // font\n  "editor.fontSize": 14,\n  "workbench.colorTheme": "Null Dark"\n}\n');
    });
    (0, node_test_1.it)('leaves text byte-identical when nothing matches', () => {
        assert.equal((0, settingsFilter_1.stripExcluded)('{\n  "a": 1\n}\n', EXCL), '{\n  "a": 1\n}\n');
    });
    (0, node_test_1.it)('removes the last key without leaving a comma', () => {
        assert.equal((0, settingsFilter_1.stripExcluded)('{\n  "a": 1,\n  "git.path": "x"\n}\n', EXCL), '{\n  "a": 1\n}\n');
    });
    (0, node_test_1.it)('keeps tab indentation and CRLF line endings', () => {
        assert.equal((0, settingsFilter_1.stripExcluded)('{\n\t"a": 1,\n\t"git.path": "x"\n}\n', EXCL), '{\n\t"a": 1\n}\n');
        assert.equal((0, settingsFilter_1.stripExcluded)('{\r\n  "a": 1,\r\n  "git.path": "x"\r\n}\r\n', EXCL), '{\r\n  "a": 1\r\n}\r\n');
    });
    (0, node_test_1.it)('accepts comments and trailing commas', () => {
        assert.deepEqual(obj((0, settingsFilter_1.stripExcluded)('{\n  "a": 1, // one\n  "git.path": "x",\n}\n', EXCL)), { a: 1 });
    });
    (0, node_test_1.it)('treats an empty or blank file as valid and leaves it alone', () => {
        assert.equal((0, settingsFilter_1.stripExcluded)('', EXCL), '');
        assert.equal((0, settingsFilter_1.stripExcluded)('  \n', EXCL), '  \n');
    });
    (0, node_test_1.it)('returns undefined for invalid JSON or a non-object', () => {
        assert.equal((0, settingsFilter_1.stripExcluded)('{ "a": ', EXCL), undefined);
        assert.equal((0, settingsFilter_1.stripExcluded)('[1]', EXCL), undefined);
    });
    (0, node_test_1.it)('handles a file that holds only excluded keys', () => {
        assert.deepEqual(obj((0, settingsFilter_1.stripExcluded)('{\n  "git.path": "x"\n}\n', EXCL)), {});
    });
});
(0, node_test_1.describe)('reapplyExcluded', () => {
    const local = '{\n  // font\n  "editor.fontSize": 14,\n  "git.path": "C:\\\\git.exe",\n  "workbench.colorTheme": "Null Dark"\n}\n';
    (0, node_test_1.it)('puts this device\'s excluded values back into the incoming text', () => {
        const incoming = '{\n  "editor.fontSize": 16\n}\n';
        assert.deepEqual(obj((0, settingsFilter_1.reapplyExcluded)(incoming, local, EXCL)), { 'editor.fontSize': 16, 'git.path': 'C:\\git.exe' });
    });
    (0, node_test_1.it)('round-trips: strip then reapply gives back the same settings', () => {
        const stripped = (0, settingsFilter_1.stripExcluded)(local, EXCL);
        assert.deepEqual(obj((0, settingsFilter_1.reapplyExcluded)(stripped, local, EXCL)), obj(local));
    });
    (0, node_test_1.it)('drops an excluded key that an older client uploaded', () => {
        const incoming = '{\n  "a": 1,\n  "git.path": "REMOTE"\n}\n';
        assert.deepEqual(obj((0, settingsFilter_1.reapplyExcluded)(incoming, '{ "other": 1 }', EXCL)), { a: 1 });
    });
    (0, node_test_1.it)('with no local file there is nothing to put back', () => {
        assert.deepEqual(obj((0, settingsFilter_1.reapplyExcluded)('{\n  "a": 1\n}\n', null, EXCL)), { a: 1 });
    });
    (0, node_test_1.it)('keeps tabs and CRLF when inserting', () => {
        assert.equal((0, settingsFilter_1.reapplyExcluded)('{\n\t"a": 1\n}\n', '{ "git.path": "x" }', EXCL), '{\n\t"a": 1,\n\t"git.path": "x"\n}\n');
        assert.equal((0, settingsFilter_1.reapplyExcluded)('{\r\n  "a": 1\r\n}\r\n', '{\r\n  "git.path": "D:\\\\b"\r\n}\r\n', EXCL), '{\r\n  "a": 1,\r\n  "git.path": "D:\\\\b"\r\n}\r\n');
    });
    (0, node_test_1.it)('works when the incoming file is empty', () => {
        assert.deepEqual(obj((0, settingsFilter_1.reapplyExcluded)('', local, EXCL)), { 'git.path': 'C:\\git.exe' });
    });
    (0, node_test_1.it)('returns undefined when either side is not valid JSON', () => {
        assert.equal((0, settingsFilter_1.reapplyExcluded)('{ "a": ', local, EXCL), undefined);
        assert.equal((0, settingsFilter_1.reapplyExcluded)('{}', '{ bad', EXCL), undefined);
    });
});
//# sourceMappingURL=settingsFilter.test.js.map