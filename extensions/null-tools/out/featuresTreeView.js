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
exports.FeaturesTreeProvider = void 0;
exports.registerFeaturesView = registerFeaturesView;
const vscode = __importStar(require("vscode"));
const featureRegistry_1 = require("./featureRegistry");
function isCategory(node) {
    return 'features' in node;
}
class FeaturesTreeProvider {
    categories = [];
    changed = new vscode.EventEmitter();
    onDidChangeTreeData = this.changed.event;
    constructor() {
        this.reload();
    }
    reload() {
        this.categories = (0, featureRegistry_1.collectFeatures)(vscode.extensions.all.map(e => ({ extensionId: e.id, packageJSON: e.packageJSON })), message => console.warn(`[null-workspace] ${message}`));
        this.changed.fire();
    }
    getChildren(element) {
        if (!element) {
            return this.categories;
        }
        return isCategory(element) ? element.features : [];
    }
    getTreeItem(element) {
        if (isCategory(element)) {
            const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.Expanded);
            item.id = `category/${element.id}`;
            return item;
        }
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.id = element.key;
        item.description = element.description;
        item.tooltip = element.description ? `${element.label} — ${element.description}` : element.label;
        item.iconPath = new vscode.ThemeIcon(element.icon);
        item.command = { command: element.command, title: element.label };
        return item;
    }
    dispose() {
        this.changed.dispose();
    }
}
exports.FeaturesTreeProvider = FeaturesTreeProvider;
function registerFeaturesView(context) {
    const provider = new FeaturesTreeProvider();
    context.subscriptions.push(provider, vscode.window.registerTreeDataProvider('null.featuresView', provider), vscode.extensions.onDidChange(() => provider.reload()));
}
//# sourceMappingURL=featuresTreeView.js.map