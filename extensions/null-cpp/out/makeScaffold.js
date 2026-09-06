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
exports.registerInitMakeProject = registerInitMakeProject;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("node:path"));
const scaffold_1 = require("./scaffold");
const scaffoldNaming_1 = require("./scaffoldNaming");
const cmakeScaffoldContent_1 = require("./cmakeScaffoldContent");
const makeScaffoldContent_1 = require("./makeScaffoldContent");
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
function registerInitMakeProject(context) {
    context.subscriptions.push(vscode.commands.registerCommand('null-cpp.make.initProject', async (target) => {
        const folderUri = await (0, scaffold_1.resolveTargetFolder)(target);
        if (!folderUri) {
            return;
        }
        const makefileUri = vscode.Uri.joinPath(folderUri, 'Makefile');
        if (await fileExists(makefileUri)) {
            void vscode.window.showInformationMessage('This folder already has a Makefile.');
            return;
        }
        const defaultName = path.basename(folderUri.fsPath).replace(/[^A-Za-z0-9_]/g, '_') || 'Project';
        const name = await vscode.window.showInputBox({
            prompt: 'Makefile project name',
            value: defaultName,
            validateInput: scaffoldNaming_1.validateClassName,
        });
        if (!name) {
            return;
        }
        await vscode.workspace.fs.writeFile(makefileUri, Buffer.from((0, makeScaffoldContent_1.makefileContent)(name), 'utf8'));
        const srcDirUri = vscode.Uri.joinPath(folderUri, 'src');
        if (!(await fileExists(srcDirUri))) {
            await vscode.workspace.fs.createDirectory(srcDirUri);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(srcDirUri, 'main.cpp'), Buffer.from(cmakeScaffoldContent_1.MAIN_CPP_CONTENT, 'utf8'));
        }
        const enabled = await (0, projectDetection_1.initializeProjectDetection)();
        await vscode.commands.executeCommand('setContext', 'null-cpp.isCppProject', enabled);
        const doc = await vscode.workspace.openTextDocument(makefileUri);
        await vscode.window.showTextDocument(doc);
    }));
}
//# sourceMappingURL=makeScaffold.js.map