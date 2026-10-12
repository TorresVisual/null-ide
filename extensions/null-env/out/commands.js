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
exports.registerCommands = registerCommands;
const vscode = __importStar(require("vscode"));
const fix_1 = require("./fix");
async function runCheck(state) {
    state.refresh(); // PATH-independent dirs (cargo bin, LLVM) may have changed since the last check
    const findings = state.get();
    if (findings.length === 0) {
        void vscode.window.showInformationMessage('Null: nothing is missing for this workspace.');
        return;
    }
    const installable = findings.filter(f => f.fix.kind === 'install');
    const items = [];
    if (installable.length > 1) {
        items.push({ label: '$(cloud-download) Install all missing extensions', action: 'installAll' });
    }
    for (const finding of findings) {
        const install = finding.fix.kind === 'install';
        items.push({
            label: `$(${install ? 'extensions' : 'link-external'}) ${finding.label}`,
            description: finding.severity,
            detail: finding.fix.kind === 'install' ? `Install ${finding.fix.extensionId}` : `Open ${finding.fix.url}`,
            finding,
        });
    }
    if (state.warnings().length > 0) {
        items.push({ label: '$(bell-slash) Hide this warning for this workspace', action: 'snooze' });
    }
    const picked = await vscode.window.showQuickPick(items, {
        title: 'Null: Check Environment',
        placeHolder: 'Pick an item to fix it',
    });
    if (!picked) {
        return;
    }
    if (picked.action === 'installAll') {
        for (const finding of installable) {
            await (0, fix_1.applyFix)(finding);
        }
    }
    else if (picked.action === 'snooze') {
        await state.snooze();
    }
    else if (picked.finding) {
        await (0, fix_1.applyFix)(picked.finding);
    }
}
function registerCommands(context, state) {
    context.subscriptions.push(vscode.commands.registerCommand('null.env.check', () => runCheck(state)), 
    // Internal: lets the UI-side null-tools read findings across extension hosts (exports do not cross them).
    vscode.commands.registerCommand('null.env.getFindings', () => state.get()));
}
//# sourceMappingURL=commands.js.map