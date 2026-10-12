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
exports.applyFix = applyFix;
exports.ensureDebugType = ensureDebugType;
const vscode = __importStar(require("vscode"));
const rules_1 = require("./rules");
async function applyFix(finding) {
    if (finding.fix.kind === 'install') {
        await vscode.commands.executeCommand('workbench.extensions.installExtension', finding.fix.extensionId);
    }
    else {
        await vscode.env.openExternal(vscode.Uri.parse(finding.fix.url));
    }
}
/**
 * Whether debug type `type` can start. When its extension is missing this explains why and offers the
 * fix, but does not wait for the user's choice: callers just stop and return.
 */
async function ensureDebugType(type) {
    const need = (0, rules_1.debugExtensionFor)(type);
    if (!need || vscode.extensions.getExtension(need.extensionId)) {
        return true;
    }
    void vscode.window
        .showErrorMessage(`Debugging needs the ${need.label} extension (${need.extensionId}), which is not installed.`, 'Install', 'Check Environment')
        .then(choice => {
        if (choice === 'Install') {
            return vscode.commands.executeCommand('workbench.extensions.installExtension', need.extensionId);
        }
        if (choice === 'Check Environment') {
            return vscode.commands.executeCommand('null.env.check');
        }
        return undefined;
    });
    return false;
}
//# sourceMappingURL=fix.js.map