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
exports.registerSetupFeature = registerSetupFeature;
const vscode = __importStar(require("vscode"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const updater_1 = require("./updater");
/** `Null: Setup`: the installer window on its Modify page, pre-filled from the install's saved choices. */
function registerSetupFeature(context) {
    context.subscriptions.push(vscode.commands.registerCommand('null.setup.open', () => {
        const install = (0, updater_1.findInstall)(context);
        if (!install) {
            void vscode.window.showInformationMessage('Null: Setup needs an installed Null IDE; setup\\null-setup.exe was not found next to this one.');
            return;
        }
        // Keep in step with the args.rs test `the_arguments_null_tools_sends_for_null_setup_parse`.
        // argv array, no shell: a folder with spaces stays one argument. cwd must not be inside the install, or a repair cannot rename it.
        const child = (0, child_process_1.spawn)(install.setupExe, ['wizard', '--install-dir', install.installDir, '--intent', 'modify'], {
            detached: true,
            stdio: 'ignore',
            cwd: os.tmpdir(),
        });
        child.once('error', err => void vscode.window.showErrorMessage(`Null: could not start Null Setup: ${err.message}`));
        child.unref();
    }));
}
//# sourceMappingURL=setupIntegration.js.map