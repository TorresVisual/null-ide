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
exports.registerUpdaterFeature = registerUpdaterFeature;
const vscode = __importStar(require("vscode"));
const updater_1 = require("./updater");
function registerUpdaterFeature(context) {
    const updateBar = vscode.window.createStatusBarItem('null.update', vscode.StatusBarAlignment.Right, 1);
    updateBar.command = 'null.installUpdate';
    context.subscriptions.push(updateBar);
    function refreshUpdateButton() {
        const update = context.globalState.get('null.availableUpdate');
        if (!update?.latest) {
            updateBar.hide();
            return;
        }
        const staged = context.globalState.get('null.stagedUpdate');
        const isReady = staged?.version === update.latest && staged.verified;
        if (isReady) {
            updateBar.text = `$(rocket) Restart to update`;
            updateBar.tooltip = `Null IDE ${update.latest} is downloaded and ready to install`;
        }
        else {
            updateBar.text = `$(cloud-download) ${update.latest}`;
            updateBar.tooltip = `Downloading Null IDE ${update.latest}…`;
        }
        updateBar.show();
    }
    context.subscriptions.push(updater_1.onStagedUpdateChanged.event(() => refreshUpdateButton()));
    context.subscriptions.push(vscode.commands.registerCommand('null.checkForUpdates', async () => {
        try {
            const update = await (0, updater_1.checkForUpdate)(context, false);
            refreshUpdateButton();
            if (update)
                await (0, updater_1.promptForUpdate)(update);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null: update check failed - ${err.message}`);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('null.installUpdate', async () => {
        try {
            await (0, updater_1.installUpdate)(context);
        }
        catch (err) {
            vscode.window.showErrorMessage(`Null: update failed - ${err.message}`);
        }
    }));
    refreshUpdateButton();
    (0, updater_1.checkForUpdate)(context, true)
        .then(update => { refreshUpdateButton(); if (update)
        return (0, updater_1.promptForUpdate)(update); })
        .catch(() => { });
}
//# sourceMappingURL=updaterIntegration.js.map