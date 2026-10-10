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
exports.activate = activate;
exports.deactivate = deactivate;
const crypto = __importStar(require("crypto"));
const vscode = __importStar(require("vscode"));
const activityService_1 = require("./activityService");
const commands_1 = require("./commands");
const dashboardPanel_1 = require("./dashboardPanel");
const heartbeatSource_1 = require("./heartbeatSource");
const intervalStore_1 = require("./intervalStore");
const projectIdentity_1 = require("./projectIdentity");
const statusBar_1 = require("./statusBar");
function readSettings() {
    const cfg = vscode.workspace.getConfiguration('null-activity');
    return (0, activityService_1.normalizeSettings)({ enabled: cfg.get('enabled'), idleTimeout: cfg.get('idleTimeout'), sessionGap: cfg.get('sessionGap') });
}
function activate(context) {
    const output = vscode.window.createOutputChannel('Null Activity');
    const storageDir = context.globalStorageUri.fsPath;
    const windowId = crypto.createHash('sha1').update(vscode.env.sessionId).digest('hex').slice(0, 10);
    const store = new intervalStore_1.IntervalStore({ dir: storageDir, windowId, log: (message) => output.appendLine(message) });
    const service = new activityService_1.ActivityService({ store, resolveProject: projectIdentity_1.resolveProject, settings: readSettings });
    service.setFocused(vscode.window.state.focused);
    const statusBar = new statusBar_1.StatusBar(service);
    const dashboard = new dashboardPanel_1.DashboardPanel(context, service, (message) => output.appendLine(message));
    const timers = [setInterval(() => service.tick(), 15_000), setInterval(() => service.flush(), 30_000)];
    context.subscriptions.push(output, service, statusBar, dashboard, (0, heartbeatSource_1.startHeartbeatSource)(service), vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('null-activity')) {
            service.refresh();
            statusBar.update();
        }
    }), { dispose: () => timers.forEach(clearInterval) });
    (0, commands_1.registerCommands)(context, service, storageDir, dashboard);
    // Expose the read/session API only; deletion stays behind the user-confirmed commands.
    return {
        startSession: () => service.startSession(),
        pauseSession: () => service.pauseSession(),
        endSession: () => service.endSession(),
        recordActivity: (h) => service.recordActivity(h),
        getProjectStats: (r) => service.getProjectStats(r),
        getLanguageStats: (r) => service.getLanguageStats(r),
        getDailyStats: (r) => service.getDailyStats(r),
        getSessions: (r) => service.getSessions(r),
        getIntervals: (r) => service.getIntervals(r),
        onDidChange: service.onDidChange,
    };
}
function deactivate() { }
//# sourceMappingURL=extension.js.map