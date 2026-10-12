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
exports.registerCommitValidationFeature = registerCommitValidationFeature;
const vscode = __importStar(require("vscode"));
const commitValidation_1 = require("./commitValidation");
const mode = () => vscode.workspace.getConfiguration('null').get('commitMessage.validation', 'warn');
/**
 * Squiggles on the Source Control commit box (its documents use the `vscode-scm` scheme, like git's own
 * length checks), plus `null.commitMessage.check`, which patch 008 calls from git's commit path so that
 * `strict` can block the commit button.
 */
function registerCommitValidationFeature(context) {
    const diagnostics = vscode.languages.createDiagnosticCollection('null-commit-message');
    const refresh = (doc) => {
        if (doc.uri.scheme !== 'vscode-scm')
            return;
        const m = mode();
        const problem = m === 'off' ? undefined : (0, commitValidation_1.validateCommitMessage)(doc.getText());
        diagnostics.set(doc.uri, problem ? [new vscode.Diagnostic(doc.lineAt(0).range, problem, m === 'strict' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning)] : []);
    };
    context.subscriptions.push(diagnostics, vscode.workspace.onDidOpenTextDocument(refresh), vscode.workspace.onDidChangeTextDocument(e => refresh(e.document)), vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('null.commitMessage.validation'))
            vscode.workspace.textDocuments.forEach(refresh);
    }), 
    // Returns the reason to refuse the commit, or undefined to let it through.
    vscode.commands.registerCommand('null.commitMessage.check', (message) => {
        if (mode() !== 'strict')
            return undefined;
        const problem = (0, commitValidation_1.validateCommitMessage)(message);
        return problem && `Commit blocked: not a Conventional Commit. ${problem}`;
    }));
    vscode.workspace.textDocuments.forEach(refresh);
}
//# sourceMappingURL=commitValidationIntegration.js.map