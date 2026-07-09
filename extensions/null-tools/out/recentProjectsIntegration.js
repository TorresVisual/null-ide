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
exports.registerRecentProjectsUriHandler = registerRecentProjectsUriHandler;
const vscode = __importStar(require("vscode"));
const recentProjects_1 = require("./recentProjects");
function registerRecentProjectsUriHandler(context) {
    context.subscriptions.push(vscode.window.registerUriHandler({
        async handleUri(uri) {
            if (uri.path !== '/recent-projects') {
                return;
            }
            let entries;
            try {
                entries = (0, recentProjects_1.readRecentProjects)((0, recentProjects_1.getRecentProjectsFilePath)());
            }
            catch {
                entries = [];
            }
            if (!entries.length) {
                vscode.window.showInformationMessage('No recent projects tracked yet.');
                return;
            }
            const picked = await vscode.window.showQuickPick(entries.map(e => ({ label: e.label, description: e.path, entry: e })), { placeHolder: 'Select a recent project to open' });
            if (!picked) {
                return;
            }
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(picked.entry.path), { forceNewWindow: true });
        },
    }));
}
//# sourceMappingURL=recentProjectsIntegration.js.map