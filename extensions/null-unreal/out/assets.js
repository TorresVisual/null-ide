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
exports.registerAssets = registerAssets;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const assetStore_1 = require("./assetStore");
const cache_1 = require("./cache");
const cli_1 = require("./cli");
const commands_1 = require("./commands");
const engine_1 = require("./engine");
const exporter_1 = require("./exporter");
const packagePath_1 = require("./packagePath");
const uproject_1 = require("./uproject");
// The project and engine do not change under a running window, and resolving the engine runs `reg query`.
// A settings change drops the memo.
function resolver(context) {
    let memo;
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('null-unreal'))
            memo = undefined;
    }));
    return () => {
        if (memo)
            return memo;
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!folder)
            throw new uproject_1.ResolveError('open the folder that holds the .uproject first');
        const cfg = vscode.workspace.getConfiguration('null-unreal');
        const project = (0, uproject_1.resolveProject)(folder, cfg.get('project', '') || undefined, cli_1.realProjectFs);
        const engine = (0, engine_1.resolveEngine)(project, cfg.get('enginePath', '') || undefined, engine_1.realReaders);
        return (memo = { project, engine });
    };
}
// Lines of the CLI's report that explain a failure: everything but the per-asset successes and the result lines.
function errorsFrom(text, files) {
    const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('log: ') && !/^null-unreal export: exit /.test(l));
    const reason = lines.filter((l) => !/\s(cached|exported)\s/.test(l)).join('; ') || 'the export failed (see the Null Unreal output)';
    return new Map(files.map((f) => [f, reason]));
}
function registerAssets(context, ctx) {
    const resolve = resolver(context);
    const store = new assetStore_1.AssetStore({
        peek(file) {
            try {
                return (0, exporter_1.peekAsset)({ ...resolve(), file }, cli_1.realExportFs);
            }
            catch {
                return undefined;
            }
        },
        async run(files, force) {
            const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!folder)
                throw new Error('open the folder that holds the .uproject first');
            ctx.output.appendLine(`> null-unreal export ${files.length} asset(s)${force ? ' --force' : ''}`);
            // One CLI call per engine run keeps the command line short however large the folder is.
            const errors = new Map();
            for (let i = 0; i < files.length; i += exporter_1.MAX_PER_RUN) {
                const chunk = files.slice(i, i + exporter_1.MAX_PER_RUN);
                const before = [...chunk, ...(force ? ['--force'] : [])];
                const { code, text } = await (0, commands_1.spawnCli)((0, commands_1.cliArgs)('export', ctx.cliPath, before), folder, ctx.output);
                if (code !== 0)
                    for (const [f, e] of errorsFrom(text, chunk))
                        errors.set(f, e);
            }
            return errors;
        },
    });
    context.subscriptions.push(vscode.commands.registerCommand('null-unreal.exportAsset', (uri) => exportAsset(store, resolve, uri)), vscode.commands.registerCommand('null-unreal.clearAssetCache', () => clearCache(resolve)));
    return store;
}
// The explorer passes the clicked file; otherwise the active tab if it is a .uasset; otherwise ask for a folder.
async function exportAsset(store, resolve, clicked) {
    let r;
    try {
        r = resolve();
    }
    catch (e) {
        void vscode.window.showWarningMessage(`Null Unreal: ${e.message}`);
        return;
    }
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    let target = clicked ?? (tab?.uri?.fsPath.toLowerCase().endsWith('.uasset') ? tab.uri : undefined);
    if (!target) {
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            defaultUri: vscode.Uri.file(path.join(r.project.dir, 'Content')),
            openLabel: 'Export assets in folder',
        });
        target = picked?.[0];
    }
    if (!target)
        return;
    const files = fs.statSync(target.fsPath).isDirectory() ? (0, packagePath_1.uassetsIn)(target.fsPath, cli_1.realExportFs) : [target.fsPath];
    if (files.length === 0) {
        void vscode.window.showInformationMessage('Null Unreal: no .uasset files in that folder.');
        return;
    }
    const results = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Null Unreal: exporting ${files.length === 1 ? path.basename(files[0]) : `${files.length} assets`} (the engine takes a few seconds to start)`,
    }, () => store.getMany(files));
    const failed = results.filter((x) => 'error' in x);
    if (failed.length === 0) {
        void vscode.window.showInformationMessage(`Null Unreal: exported ${files.length} asset(s) to Saved/NullUnreal/assets.`);
    }
    else {
        void vscode.window.showErrorMessage(`Null Unreal: ${failed.length} of ${files.length} failed: ${failed[0].error}`);
    }
}
async function clearCache(resolve) {
    let dir;
    try {
        dir = (0, cache_1.assetsDir)(resolve().project.dir);
    }
    catch (e) {
        void vscode.window.showWarningMessage(`Null Unreal: ${e.message}`);
        return;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    void vscode.window.showInformationMessage(`Null Unreal: deleted ${dir}.`);
}
//# sourceMappingURL=assets.js.map