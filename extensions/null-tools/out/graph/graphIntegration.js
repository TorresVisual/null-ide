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
exports.registerGraphFeature = registerGraphFeature;
const vscode = __importStar(require("vscode"));
const commitGraphPanel_1 = require("./commitGraphPanel");
const graphCommands_1 = require("./graphCommands");
const graphDiff_1 = require("./graphDiff");
const graphSession_1 = require("./graphSession");
const graphTreeView_1 = require("./graphTreeView");
/** Registration only: nothing spawns git until the tab or the tree is shown. */
function registerGraphFeature(context) {
    const session = new graphSession_1.GraphSession();
    const panel = new commitGraphPanel_1.CommitGraphPanel(context, session);
    const tree = new graphTreeView_1.GraphTreeProvider(session);
    const view = vscode.window.createTreeView('null.graphView', { treeDataProvider: tree });
    view.onDidChangeVisibility((e) => tree.setVisible(e.visible), undefined, context.subscriptions);
    tree.setVisible(view.visible);
    (0, graphDiff_1.registerEmptyDocument)(context);
    (0, graphCommands_1.registerGraphCommands)(context, session, panel);
    context.subscriptions.push(session, panel, tree, view);
}
//# sourceMappingURL=graphIntegration.js.map