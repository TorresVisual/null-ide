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
const layout_1 = require("./layout");
(0, node_test_1.describe)('isSyncableFile', () => {
    (0, node_test_1.it)('accepts the two core files and plain snippet files', () => {
        for (const f of ['settings.json', 'keybindings.json', 'snippets/cpp.json', 'snippets/my.code-snippets']) {
            assert.equal((0, layout_1.isSyncableFile)(f), true, f);
        }
    });
    (0, node_test_1.it)('rejects anything else, including traversal', () => {
        const bad = [
            '', 'tasks.json', 'snippets/', 'snippets/a.txt', 'snippets/../settings.json', 'snippets/..\\x.json',
            'snippets/a/b.json', '../settings.json', 'snippets/C:x.json', '/etc/passwd', 'settings.json/..',
        ];
        for (const f of bad)
            assert.equal((0, layout_1.isSyncableFile)(f), false, f);
    });
});
(0, node_test_1.describe)('remote names', () => {
    (0, node_test_1.it)('round-trips every syncable file', () => {
        for (const f of ['settings.json', 'keybindings.json', 'snippets/cpp.json', 'snippets/a__b.code-snippets']) {
            assert.equal((0, layout_1.fileOfRemoteName)((0, layout_1.remoteNameOf)(f)), f, f);
        }
        assert.equal((0, layout_1.remoteNameOf)('snippets/cpp.json'), 'snippets__cpp.json.enc');
    });
    (0, node_test_1.it)('ignores remote names that are not ours or would escape the user folder', () => {
        const bad = [
            'manifest.json', 'settings.json', 'snippets__..\\..\\x.json.enc', 'snippets__a/b.json.enc',
            'snippets/a.json.enc', 'tasks.json.enc', '.enc', 'snippets__.enc', 'extensions.json.enc',
        ];
        for (const n of bad)
            assert.equal((0, layout_1.fileOfRemoteName)(n), undefined, n);
    });
});
(0, node_test_1.describe)('categories', () => {
    (0, node_test_1.it)('maps files to categories', () => {
        assert.equal((0, layout_1.categoryOf)('settings.json'), 'settings');
        assert.equal((0, layout_1.categoryOf)('keybindings.json'), 'keybindings');
        assert.equal((0, layout_1.categoryOf)('snippets/a.json'), 'snippets');
    });
    (0, node_test_1.it)('only snippets can be deleted', () => {
        assert.equal((0, layout_1.isDeletable)('snippets/a.json'), true);
        assert.equal((0, layout_1.isDeletable)('settings.json'), false);
        assert.equal((0, layout_1.isDeletable)('keybindings.json'), false);
    });
});
//# sourceMappingURL=layout.test.js.map