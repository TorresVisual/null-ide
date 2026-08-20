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
exports.StatusBarController = void 0;
const vscode = __importStar(require("vscode"));
class StatusBarController {
    items = new Map();
    update(buttons) {
        const nextIds = new Set(buttons.map(b => b.id));
        for (const [id, tracked] of this.items) {
            if (!nextIds.has(id)) {
                tracked.item.dispose();
                this.items.delete(id);
            }
        }
        for (const button of buttons) {
            const existing = this.items.get(button.id);
            // Alignment and priority are fixed at creation time by the VS Code
            // API (there's no setter) — recreate the item if either changed.
            if (existing && (existing.alignment !== button.alignment || existing.priority !== button.priority)) {
                existing.item.dispose();
                this.items.delete(button.id);
            }
            const tracked = this.items.get(button.id) ?? this.create(button);
            this.applyButton(tracked.item, button);
            this.items.set(button.id, tracked);
        }
    }
    dispose() {
        for (const tracked of this.items.values()) {
            tracked.item.dispose();
        }
        this.items.clear();
    }
    create(button) {
        const alignment = button.alignment === 'right' ? vscode.StatusBarAlignment.Right : vscode.StatusBarAlignment.Left;
        const item = vscode.window.createStatusBarItem(`null-actions.${button.id}`, alignment, button.priority);
        return { item, alignment: button.alignment, priority: button.priority };
    }
    applyButton(item, button) {
        item.text = button.icon ? `$(${button.icon}) ${button.label}` : button.label;
        item.tooltip = button.tooltip;
        item.color = button.color;
        item.backgroundColor = button.background !== 'none'
            ? new vscode.ThemeColor(`statusBarItem.${button.background}Background`)
            : undefined;
        item.command = { command: 'null-actions.runButton', title: button.label, arguments: [button.id] };
        item.show();
    }
}
exports.StatusBarController = StatusBarController;
//# sourceMappingURL=statusBarController.js.map