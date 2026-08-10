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
exports.registerNewClass = registerNewClass;
const vscode = __importStar(require("vscode"));
const scaffoldNaming_1 = require("./scaffoldNaming");
const projectDetection_1 = require("./projectDetection");
async function fileExists(uri) {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    }
    catch {
        return false;
    }
}
async function resolveTargetFolder(target) {
    if (target) {
        const stat = await vscode.workspace.fs.stat(target);
        return stat.type === vscode.FileType.Directory ? target : vscode.Uri.joinPath(target, '..');
    }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        void vscode.window.showErrorMessage('Open a folder to create a new C++ class.');
        return undefined;
    }
    return folders[0].uri;
}
function registerNewClass(context) {
    context.subscriptions.push(vscode.commands.registerCommand('null-cpp.newClass', async (target) => {
        if (!(0, projectDetection_1.isEnabled)()) {
            void vscode.window.showInformationMessage("Null C++ features are inactive for this workspace (no CMakeLists.txt, compile_commands.json, .clangd, or C/C++ source files found). Set null-cpp.projectDetection.override to \"always\" to force it on.");
            return;
        }
        const folderUri = await resolveTargetFolder(target);
        if (!folderUri) {
            return;
        }
        const name = await vscode.window.showInputBox({
            prompt: 'C++ class/file name (no extension)',
            validateInput: scaffoldNaming_1.validateClassName,
        });
        if (!name) {
            return;
        }
        const headerUri = vscode.Uri.joinPath(folderUri, (0, scaffoldNaming_1.headerFileName)(name));
        const sourceUri = vscode.Uri.joinPath(folderUri, (0, scaffoldNaming_1.sourceFileName)(name));
        if ((await fileExists(headerUri)) || (await fileExists(sourceUri))) {
            void vscode.window.showErrorMessage(`${(0, scaffoldNaming_1.headerFileName)(name)} or ${(0, scaffoldNaming_1.sourceFileName)(name)} already exists.`);
            return;
        }
        await vscode.workspace.fs.writeFile(headerUri, Buffer.from((0, scaffoldNaming_1.headerContent)(), 'utf8'));
        await vscode.workspace.fs.writeFile(sourceUri, Buffer.from((0, scaffoldNaming_1.sourceContent)(name), 'utf8'));
        const autoPairSplit = vscode.workspace
            .getConfiguration('null-cpp')
            .get('autoPairSplit.enabled', true);
        if (autoPairSplit) {
            const sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
            await vscode.window.showTextDocument(sourceDoc, {
                viewColumn: vscode.ViewColumn.One,
                preserveFocus: true,
                preview: false,
            });
            const headerDoc = await vscode.workspace.openTextDocument(headerUri);
            await vscode.window.showTextDocument(headerDoc, { viewColumn: vscode.ViewColumn.Two });
        }
        else {
            const headerDoc = await vscode.workspace.openTextDocument(headerUri);
            await vscode.window.showTextDocument(headerDoc);
        }
    }));
}
//# sourceMappingURL=scaffold.js.map