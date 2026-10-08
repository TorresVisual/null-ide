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
exports.StatusBar = void 0;
const vscode = __importStar(require("vscode"));
const stats_1 = require("./stats");
class StatusBar {
    service;
    item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    subscription;
    timer;
    constructor(service) {
        this.service = service;
        this.item.command = 'null-activity.showTrackedData';
        this.subscription = service.onDidChange(() => this.update());
        this.timer = setInterval(() => this.update(), 60_000);
        this.update();
        this.item.show();
    }
    update() {
        if (!this.service.enabled) {
            this.item.text = '$(clock) Off';
            this.item.tooltip = 'Null Activity: tracking is off (setting null-activity.enabled)';
            return;
        }
        const ms = this.service.getDailyStats((0, stats_1.dayRange)(Date.now())).reduce((n, d) => n + d.ms, 0);
        this.item.text = `$(clock) ${(0, stats_1.formatDuration)(ms)}`;
        this.item.tooltip = 'Null Activity: time tracked today. Click to see what is recorded.';
    }
    dispose() {
        clearInterval(this.timer);
        this.subscription.dispose();
        this.item.dispose();
    }
}
exports.StatusBar = StatusBar;
//# sourceMappingURL=statusBar.js.map