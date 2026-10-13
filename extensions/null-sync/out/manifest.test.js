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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const settingsFilter_1 = require("./settingsFilter");
const types_1 = require("./types");
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const props = pkg.contributes.configuration.properties;
(0, node_test_1.describe)('package.json contract', () => {
    (0, node_test_1.it)('is a UI-side built-in that depends on null-accounts', () => {
        assert.equal(pkg.publisher, 'null');
        assert.deepEqual(pkg.extensionKind, ['ui']);
        assert.deepEqual(pkg.extensionDependencies, ['null.null-accounts']);
        assert.deepEqual(pkg.activationEvents, ['onStartupFinished']);
        assert.ok(fs.existsSync(path.join(root, pkg.main)), 'main points at a compiled file');
    });
    (0, node_test_1.it)('contributes exactly the documented commands', () => {
        const ids = pkg.contributes.commands.map((c) => c.command).sort();
        assert.deepEqual(ids, [
            'null.sync.enable', 'null.sync.resolveConflicts', 'null.sync.restore', 'null.sync.setCategories',
            'null.sync.showStatus', 'null.sync.stop', 'null.sync.syncNow',
        ]);
    });
    (0, node_test_1.it)('is off by default and every setting is application-scoped', () => {
        assert.equal(props['null-sync.enabled'].default, false);
        for (const key of Object.keys(props))
            assert.equal(props[key].scope, 'application', key);
    });
    (0, node_test_1.it)('syncs every category by default', () => {
        const defaults = props['null-sync.categories'].default;
        assert.deepEqual(Object.keys(defaults), [...types_1.CATEGORIES]);
        assert.ok(Object.values(defaults).every((v) => v === true));
    });
    (0, node_test_1.it)('excludes machine-specific paths and secrets by default', () => {
        const excluded = props['null-sync.excludedSettings'].default;
        for (const key of [
            'git.path', 'rust-analyzer.server.path', 'python.defaultInterpreterPath', 'terminal.integrated.defaultProfile.windows',
            'terminal.integrated.profiles.windows', 'http.proxy', 'null-sync.enabled', 'my.apiToken', 'x.SECRET', 'a.password',
            'github.credentialHelper',
        ]) {
            assert.equal((0, settingsFilter_1.matchesKey)(key, excluded), true, key);
        }
        for (const key of ['editor.fontSize', 'workbench.colorTheme', 'files.autoSave']) {
            assert.equal((0, settingsFilter_1.matchesKey)(key, excluded), false, key);
        }
    });
});
//# sourceMappingURL=manifest.test.js.map