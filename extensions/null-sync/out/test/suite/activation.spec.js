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
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const COMMANDS = [
    'null.sync.enable', 'null.sync.syncNow', 'null.sync.resolveConflicts', 'null.sync.restore',
    'null.sync.stop', 'null.sync.setCategories', 'null.sync.showStatus',
];
suite('null-sync activation', () => {
    test('activates, exposes its API and registers its commands', async () => {
        const extension = vscode.extensions.getExtension('null.null-sync');
        assert.ok(extension, 'null.null-sync extension not found');
        const api = await extension.activate();
        assert.strictEqual(extension.isActive, true);
        assert.strictEqual(typeof api.getStatus, 'function');
        assert.strictEqual(typeof api.syncNow, 'function');
        assert.strictEqual(typeof api.resolveConflict, 'function');
        const registered = await vscode.commands.getCommands(true);
        for (const id of COMMANDS)
            assert.ok(registered.includes(id), `${id} not registered`);
    });
    test('is off by default: a sync run reports disabled and touches nothing', async () => {
        const api = vscode.extensions.getExtension('null.null-sync').exports;
        await api.syncNow();
        assert.strictEqual(api.getStatus().state, 'disabled');
        assert.deepStrictEqual(api.getStatus().conflicts, []);
    });
    test('switched on without setup it says so instead of failing', async () => {
        const config = vscode.workspace.getConfiguration('null-sync');
        await config.update('enabled', true, vscode.ConfigurationTarget.Global);
        try {
            const api = vscode.extensions.getExtension('null.null-sync').exports;
            await api.syncNow();
            assert.strictEqual(api.getStatus().state, 'signedOut');
            assert.match(api.getStatus().message, /Enable Settings Sync/);
        }
        finally {
            await config.update('enabled', undefined, vscode.ConfigurationTarget.Global);
        }
    });
});
//# sourceMappingURL=activation.spec.js.map