'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const taskList_1 = require("./taskList");
(0, node_test_1.default)('toggleTaskCheckbox checks an unchecked box by index', () => {
    const body = '- [ ] one\n- [ ] two\n- [ ] three';
    node_assert_1.default.strictEqual((0, taskList_1.toggleTaskCheckbox)(body, 1, true), '- [ ] one\n- [x] two\n- [ ] three');
});
(0, node_test_1.default)('toggleTaskCheckbox unchecks a checked box by index', () => {
    const body = '- [x] one';
    node_assert_1.default.strictEqual((0, taskList_1.toggleTaskCheckbox)(body, 0, false), '- [ ] one');
});
(0, node_test_1.default)('toggleTaskCheckbox skips checkboxes inside fenced code blocks', () => {
    const body = '- [ ] real one\n```\n- [ ] fake\n```\n- [ ] real two';
    node_assert_1.default.strictEqual((0, taskList_1.toggleTaskCheckbox)(body, 1, true), '- [ ] real one\n```\n- [ ] fake\n```\n- [x] real two');
});
(0, node_test_1.default)('toggleTaskCheckbox returns null for an out-of-range index', () => {
    const body = '- [ ] only one';
    node_assert_1.default.strictEqual((0, taskList_1.toggleTaskCheckbox)(body, 3, true), null);
});
//# sourceMappingURL=taskList.test.js.map