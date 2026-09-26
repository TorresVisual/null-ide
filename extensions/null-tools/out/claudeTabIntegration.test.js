'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const FOCUS_GROUP_COMMANDS = [
    'workbench.action.focusFirstEditorGroup',
    'workbench.action.focusSecondEditorGroup',
    'workbench.action.focusThirdEditorGroup',
];
function focusCommandFor(viewColumn) {
    return FOCUS_GROUP_COMMANDS[viewColumn - 1];
}
(0, node_test_1.test)('viewColumn 1 maps to the first-group focus command', () => {
    node_assert_1.default.strictEqual(focusCommandFor(1), 'workbench.action.focusFirstEditorGroup');
});
(0, node_test_1.test)('viewColumn beyond the known list yields no focus command (single-group case)', () => {
    node_assert_1.default.strictEqual(focusCommandFor(99), undefined);
});
//# sourceMappingURL=claudeTabIntegration.test.js.map