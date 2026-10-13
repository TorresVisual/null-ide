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
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCommands = registerCommands;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const enable_1 = require("./enable");
const prompts = __importStar(require("./prompts"));
const statusText_1 = require("./statusText");
const types_1 = require("./types");
const config = () => vscode.workspace.getConfiguration('null-sync');
function report(engine, done) {
    const s = engine.getStatus();
    if (s.state === 'idle')
        void vscode.window.showInformationMessage(`Null Sync: ${done}`);
    else if (s.message)
        void vscode.window.showWarningMessage(`Null Sync: ${s.message}`);
    else if (s.state === 'needsAttention') {
        void vscode.window.showInformationMessage('Null Sync: some items need attention. Run "Null: Show Sync Status".');
    }
}
async function showDiff(engine, userDir, file) {
    const remote = await engine.previewRemote(file);
    const synced = await vscode.workspace.openTextDocument({ content: remote ?? '', language: 'jsonc' });
    const local = vscode.Uri.file(path.join(userDir, ...file.split('/')));
    const note = file === 'settings.json' ? ' (excluded settings are not synced)' : '';
    await vscode.commands.executeCommand('vscode.diff', synced.uri, local, `${file}: synced ↔ this device${note}`);
}
/** Asks what to do with one conflict until the user decides; false if they gave up. */
async function resolveOne(engine, userDir, file) {
    for (;;) {
        const choice = await prompts.chooseConflictAction(file);
        if (choice === undefined)
            return false;
        if (choice === 'diff') {
            await showDiff(engine, userDir, file);
            continue;
        }
        await engine.resolve(file, choice);
        return true;
    }
}
function registerCommands(context, engine, enableDeps, userDir) {
    const resolveAll = async () => {
        for (const { file } of [...engine.getStatus().conflicts]) {
            if (!(await resolveOne(engine, userDir, file)))
                return;
        }
        report(engine, 'all conflicts resolved.');
    };
    const restore = async () => {
        const revisions = await engine.revisions();
        if (!revisions)
            return report(engine, '');
        const picked = await prompts.chooseRevision(revisions);
        if (!picked || !(await prompts.confirmRestore(picked)))
            return;
        await engine.restore(picked.sha);
        report(engine, 'restored.');
    };
    const stop = async () => {
        const choice = await prompts.confirmStop();
        if (!choice)
            return;
        const result = await engine.stop(choice === 'delete');
        if (!result.ok) {
            void vscode.window.showErrorMessage(`Null Sync: ${result.message}`);
            return;
        }
        await config().update('enabled', false, vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage('Null Sync: stopped on this device. Your local files were not changed.');
    };
    context.subscriptions.push(vscode.commands.registerCommand('null.sync.enable', async () => {
        const result = await (0, enable_1.enable)(enableDeps, prompts.enablePrompts);
        if (!result.ok) {
            if (result.message !== enable_1.CANCELLED)
                void vscode.window.showErrorMessage(`Null Sync: ${result.message}`);
            return;
        }
        await config().update('enabled', true, vscode.ConfigurationTarget.Global);
        await engine.run({ interactive: true, firstSync: result.firstSync });
        report(engine, 'sync is on.');
    }), vscode.commands.registerCommand('null.sync.syncNow', async () => {
        await engine.run({ interactive: true });
        report(engine, 'up to date.');
    }), vscode.commands.registerCommand('null.sync.resolveConflicts', resolveAll), vscode.commands.registerCommand('null.sync.restore', restore), vscode.commands.registerCommand('null.sync.stop', stop), vscode.commands.registerCommand('null.sync.setCategories', async () => {
        const current = {
            ...Object.fromEntries(types_1.CATEGORIES.map((category) => [category, true])),
            ...config().get('categories'),
        };
        const picked = await vscode.window.showQuickPick(types_1.CATEGORIES.map((category) => ({ label: category, picked: current[category] !== false })), { canPickMany: true, placeHolder: 'Choose what to sync on this device' });
        if (!picked)
            return;
        const next = Object.fromEntries(types_1.CATEGORIES.map((category) => [category, picked.some((p) => p.label === category)]));
        await config().update('categories', next, vscode.ConfigurationTarget.Global);
    }), vscode.commands.registerCommand('null.sync.showStatus', async () => {
        const s = engine.getStatus();
        const items = [{ label: `$(sync) ${(0, statusText_1.describeStatus)(s, Date.now())}`, description: s.message }];
        for (const c of s.conflicts) {
            items.push({ label: `$(warning) Resolve conflict: ${c.file}`, run: () => resolveOne(engine, userDir, c.file) });
        }
        for (const file of s.pending) {
            items.push({ label: `$(clock) Waiting for unsaved changes: ${file}`, description: 'applied once it is saved or closed' });
        }
        items.push({ label: '$(sync) Sync now', run: () => vscode.commands.executeCommand('null.sync.syncNow') }, { label: '$(history) Restore an earlier version…', run: restore }, { label: '$(debug-stop) Stop syncing…', run: stop });
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Null Sync' });
        await picked?.run?.();
    }));
}
//# sourceMappingURL=commands.js.map