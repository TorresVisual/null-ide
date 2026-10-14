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
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const ERROR_FILE = 'src/main.rs';
function rustErrors() {
    return vscode.languages.getDiagnostics().flatMap(([uri, diags]) => (uri.path.endsWith(ERROR_FILE) ? diags : []));
}
async function waitFor(cond, what) {
    for (let i = 0; i < 100; i++) {
        if (cond()) {
            return;
        }
        await new Promise(r => setTimeout(r, 100));
    }
    assert.fail(`timed out waiting for ${what}`);
}
suite('null-actions problem matcher', () => {
    test('a button with a matcher fills Problems on failure and clears them on the next clean run', async function () {
        this.timeout(40000);
        const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const flag = path.join(root, 'fail.flag');
        // Prints what `cargo build` prints for a type error when the flag file exists.
        fs.writeFileSync(path.join(root, 'build.js'), [
            "if (require('fs').existsSync('fail.flag')) {",
            "  console.log('error[E0308]: mismatched types');",
            "  console.log(' --> " + ERROR_FILE + ":2:18');",
            '  process.exit(101);',
            '}',
        ].join('\n'));
        await vscode.workspace.getConfiguration().update('null-actions.buttons', [
            { id: 'pm', label: 'PM', command: 'node build.js', problemMatcher: '$null-rustc', focus: false },
        ], vscode.ConfigurationTarget.Workspace);
        await vscode.extensions.getExtension('null.null-actions').activate();
        fs.writeFileSync(flag, '');
        await vscode.commands.executeCommand('null-actions.runButton', 'pm');
        await waitFor(() => rustErrors().length > 0, 'the compiler error to reach Problems');
        const [error] = rustErrors();
        assert.strictEqual(error.message, 'mismatched types');
        assert.strictEqual(error.range.start.line, 1);
        fs.rmSync(flag);
        // For 8 s after a failure the button's click only reveals its terminal (see StatusBarController.RESULT_MS).
        await new Promise(r => setTimeout(r, 8500));
        await vscode.commands.executeCommand('null-actions.runButton', 'pm');
        await waitFor(() => rustErrors().length === 0, 'the error to clear after a clean run');
    });
});
//# sourceMappingURL=problemMatcher.spec.js.map