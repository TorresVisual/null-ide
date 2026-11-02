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
exports.registerJdkCommand = registerJdkCommand;
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const probe_1 = require("./probe");
const jdk_1 = require("./jdk");
const diskFs = {
    listDir: (p) => fs.readdirSync(p),
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    isFile: (p) => {
        try {
            return fs.statSync(p).isFile();
        }
        catch {
            return false;
        }
    },
};
/** Pick the JDK the Java language server and debugger use for this project (`java.configuration.runtimes`). */
async function selectJdk() {
    const javac = (0, probe_1.findExecutable)('javac');
    const jdks = (0, jdk_1.findJdks)(diskFs, process.platform, os.homedir(), process.env, javac ? [path.dirname(path.dirname(javac))] : []);
    if (jdks.length === 0) {
        void vscode.window.showWarningMessage('Null: no JDK found. Install one (e.g. Eclipse Temurin), then run this again.', 'Get a JDK').then(choice => {
            if (choice) {
                void vscode.env.openExternal(vscode.Uri.parse('https://adoptium.net/temurin/releases/'));
            }
        });
        return;
    }
    const config = vscode.workspace.getConfiguration('java.configuration');
    const current = config.get('runtimes', []).find(r => r.default)?.path?.toLowerCase();
    const picked = await vscode.window.showQuickPick(jdks.map(j => ({
        label: `$(coffee) ${j.major > 0 ? `Java ${j.major}` : 'Java'}`,
        description: [j.version, j.home.toLowerCase() === current ? 'current' : ''].filter(Boolean).join(' · '),
        detail: j.home,
        jdk: j,
    })), { title: 'Null: Select JDK', placeHolder: 'JDK for this project' });
    if (!picked) {
        return;
    }
    const runtime = { name: (0, jdk_1.runtimeName)(picked.jdk.major), path: picked.jdk.home, default: true };
    const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    // Keep other runtimes the user listed; replace the old default and any entry with the same name.
    const rest = config.get('runtimes', []).filter(r => !r.default && r.name !== runtime.name);
    await config.update('runtimes', [...rest, runtime], target);
    void vscode.window.showInformationMessage(`Null: project JDK set to ${runtime.name}.`);
}
function registerJdkCommand(context) {
    context.subscriptions.push(vscode.commands.registerCommand('null.java.selectJdk', selectJdk));
}
//# sourceMappingURL=jdkCommand.js.map