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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const node_test_1 = __importDefault(require("node:test"));
// out/graph -> out -> null-tools
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
const menus = manifest.contributes.menus;
(0, node_test_1.default)('Null: Pull is in the Commit Graph tab title, only on that tab, only when the graph is ready, and not mid-operation', () => {
    const items = menus['editor/title'].filter((m) => m.command === 'null.graph.pull');
    node_assert_1.default.strictEqual(items.length, 1);
    node_assert_1.default.strictEqual(items[0].when, "activeWebviewPanelId == 'null.commitGraph' && null.graph.state == ready && !null.graph.operationInProgress");
});
(0, node_test_1.default)('the sidebar view keeps its own Null: Pull button', () => {
    const items = menus['view/title'].filter((m) => m.command === 'null.graph.pull');
    node_assert_1.default.strictEqual(items.length, 1);
    node_assert_1.default.match(items[0].when ?? '', /view == null\.graphView/);
});
//# sourceMappingURL=graphMenus.test.js.map