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
exports.registerPortsFeature = registerPortsFeature;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const portsTreeView_1 = require("./portsTreeView");
function getConfig() {
    const cfg = vscode.workspace.getConfiguration('null.ports');
    return {
        intervalSec: cfg.get('refreshInterval', 5),
        filterDevOnly: cfg.get('filterDevOnly', true),
    };
}
function urlForPort(port) {
    return vscode.Uri.parse(`http://localhost:${port}`);
}
function killPid(pid) {
    // On Windows, /F forces termination of the entire process tree
    (0, child_process_1.execSync)(`taskkill /PID ${pid} /F`, { windowsHide: true, timeout: 5000 });
}
function registerPortsFeature(context) {
    const provider = new portsTreeView_1.PortsTreeProvider();
    // Apply initial config
    const { intervalSec, filterDevOnly } = getConfig();
    provider.setFilterDevOnly(filterDevOnly);
    provider.startAutoRefresh(intervalSec);
    // Re-apply config when user changes settings
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('null.ports')) {
            const cfg = getConfig();
            provider.setFilterDevOnly(cfg.filterDevOnly);
            provider.startAutoRefresh(cfg.intervalSec);
        }
    }));
    context.subscriptions.push(vscode.window.registerTreeDataProvider('null.portsView', provider));
    // ── Commands ───────────────────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('null.ports.refresh', () => {
        provider.refresh();
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.ports.openInBrowser', async (entry) => {
        if (!entry) {
            // Fallback: ask the user to pick from the current list
            const items = provider.entries.map(e => ({
                label: `$(rocket)  :${e.port}`,
                description: e.processName + (e.friendlyLabel ? ` — ${e.friendlyLabel}` : ''),
                entry: e,
            }));
            if (items.length === 0) {
                vscode.window.showInformationMessage('No active dev servers detected.');
                return;
            }
            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Open in browser…' });
            if (!picked) {
                return;
            }
            entry = picked.entry;
        }
        await vscode.env.openExternal(urlForPort(entry.port));
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.ports.killProcess', async (entry) => {
        if (!entry) {
            const items = provider.entries.map(e => ({
                label: `$(trash)  :${e.port}`,
                description: `${e.processName} (PID ${e.pid})` + (e.friendlyLabel ? ` — ${e.friendlyLabel}` : ''),
                entry: e,
            }));
            if (items.length === 0) {
                vscode.window.showInformationMessage('No active dev servers detected.');
                return;
            }
            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Kill process…' });
            if (!picked) {
                return;
            }
            entry = picked.entry;
        }
        const confirm = await vscode.window.showWarningMessage(`Kill **${entry.processName}** (PID ${entry.pid}) on port ${entry.port}?`, { modal: true }, 'Kill');
        if (confirm !== 'Kill') {
            return;
        }
        try {
            killPid(entry.pid);
            vscode.window.showInformationMessage(`Killed ${entry.processName} (PID ${entry.pid}) — port :${entry.port} freed.`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to kill PID ${entry.pid}: ${err.message}`);
        }
        // Refresh after a short delay so OS releases the port
        setTimeout(() => provider.refresh(), 800);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.ports.copyUrl', async (entry) => {
        if (!entry) {
            const items = provider.entries.map(e => ({
                label: `$(copy)  :${e.port}`,
                description: e.processName + (e.friendlyLabel ? ` — ${e.friendlyLabel}` : ''),
                entry: e,
            }));
            if (items.length === 0) {
                vscode.window.showInformationMessage('No active dev servers detected.');
                return;
            }
            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Copy URL…' });
            if (!picked) {
                return;
            }
            entry = picked.entry;
        }
        const url = `http://localhost:${entry.port}`;
        await vscode.env.clipboard.writeText(url);
        vscode.window.setStatusBarMessage(`$(copy) Copied ${url}`, 2500);
    }));
    // Dispose the auto-refresh timer on deactivation
    context.subscriptions.push({ dispose: () => provider.stopAutoRefresh() });
}
//# sourceMappingURL=portsIntegration.js.map