'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const terminalRegistry_1 = require("./terminalRegistry");
class FakeTerminal {
    name;
    sentTexts = [];
    shown = false;
    constructor(name) {
        this.name = name;
    }
    sendText(text) { this.sentTexts.push(text); }
    show() { this.shown = true; }
}
class FakeTerminalHost {
    terminals;
    createCount = 0;
    constructor(initial = []) { this.terminals = initial; }
    listTerminals() { return this.terminals; }
    createTerminal(options) {
        this.createCount++;
        const t = new FakeTerminal(options.name);
        this.terminals.push(t);
        return t;
    }
}
(0, node_test_1.test)('dispatch creates exactly one terminal on first call, named after the button label', () => {
    const host = new FakeTerminalHost();
    const registry = new terminalRegistry_1.TerminalRegistry(host);
    registry.dispatch('build', 'Build', 'npm run build');
    node_assert_1.default.strictEqual(host.createCount, 1);
    node_assert_1.default.strictEqual(host.terminals[0].name, 'Action: Build');
    node_assert_1.default.deepStrictEqual(host.terminals[0].sentTexts, ['npm run build']);
});
(0, node_test_1.test)('repeated dispatch reuses the cached terminal instead of creating new ones', () => {
    const host = new FakeTerminalHost();
    const registry = new terminalRegistry_1.TerminalRegistry(host);
    registry.dispatch('build', 'Build', 'npm run build');
    registry.dispatch('build', 'Build', 'npm run build');
    registry.dispatch('build', 'Build', 'npm run build');
    node_assert_1.default.strictEqual(host.createCount, 1);
    node_assert_1.default.strictEqual(host.terminals[0].sentTexts.length, 3);
});
(0, node_test_1.test)('a terminal already present under the button label (simulated extension-host restart / restored persistent session) is adopted, never duplicated', () => {
    const restored = new FakeTerminal('Action: Build');
    const host = new FakeTerminalHost([restored]);
    const registry = new terminalRegistry_1.TerminalRegistry(host); // fresh instance — no in-memory cache
    registry.dispatch('build', 'Build', 'npm run build');
    node_assert_1.default.strictEqual(host.createCount, 0, 'must not create a duplicate when a matching terminal already exists');
    node_assert_1.default.strictEqual(host.terminals.length, 1);
    node_assert_1.default.deepStrictEqual(restored.sentTexts, ['npm run build']);
});
(0, node_test_1.test)('changing the button command text does not create a new terminal — identity is keyed by id, not command', () => {
    const host = new FakeTerminalHost();
    const registry = new terminalRegistry_1.TerminalRegistry(host);
    registry.dispatch('build', 'Build', 'npm run build');
    registry.dispatch('build', 'Build', 'npm run build -- --watch');
    node_assert_1.default.strictEqual(host.createCount, 1);
    node_assert_1.default.deepStrictEqual(host.terminals[0].sentTexts, ['npm run build', 'npm run build -- --watch']);
});
(0, node_test_1.test)('renaming the button label mid-session reuses the same terminal — no duplicate, even though the tab keeps showing the old name', () => {
    const host = new FakeTerminalHost();
    const registry = new terminalRegistry_1.TerminalRegistry(host);
    registry.dispatch('build', 'Build', 'npm run build');
    registry.dispatch('build', 'Build (dev)', 'npm run build');
    node_assert_1.default.strictEqual(host.createCount, 1, 'the id-keyed cache must reuse the existing terminal despite the label change');
    node_assert_1.default.strictEqual(host.terminals[0].name, 'Action: Build', 'Terminal.name is read-only after creation — no rename API exists to keep it in sync');
    node_assert_1.default.deepStrictEqual(host.terminals[0].sentTexts, ['npm run build', 'npm run build']);
});
(0, node_test_1.test)('multiple stale terminals sharing the button label: adopts one (the most recent), creates no more', () => {
    const older = new FakeTerminal('Action: Build');
    const newer = new FakeTerminal('Action: Build');
    const host = new FakeTerminalHost([older, newer]);
    const registry = new terminalRegistry_1.TerminalRegistry(host);
    registry.dispatch('build', 'Build', 'npm run build');
    node_assert_1.default.strictEqual(host.createCount, 0);
    node_assert_1.default.deepStrictEqual(newer.sentTexts, ['npm run build']);
    node_assert_1.default.deepStrictEqual(older.sentTexts, [], 'the other stale terminal must be left untouched, not closed or written to');
});
(0, node_test_1.test)('a terminal the user closed is not reused — dispatch after removal from the host creates a fresh one', () => {
    const host = new FakeTerminalHost();
    const registry = new terminalRegistry_1.TerminalRegistry(host);
    registry.dispatch('build', 'Build', 'npm run build');
    host.terminals = []; // simulate the user closing it
    registry.dispatch('build', 'Build', 'npm run build');
    node_assert_1.default.strictEqual(host.createCount, 2);
});
(0, node_test_1.test)('different button ids get independent terminals', () => {
    const host = new FakeTerminalHost();
    const registry = new terminalRegistry_1.TerminalRegistry(host);
    registry.dispatch('build', 'Build', 'npm run build');
    registry.dispatch('test', 'Test', 'npm test');
    node_assert_1.default.strictEqual(host.createCount, 2);
    node_assert_1.default.strictEqual(host.terminals[0].name, 'Action: Build');
    node_assert_1.default.strictEqual(host.terminals[1].name, 'Action: Test');
});
(0, node_test_1.test)('focus option shows the terminal after dispatch, absent focus does not', () => {
    const host = new FakeTerminalHost();
    const registry = new terminalRegistry_1.TerminalRegistry(host);
    registry.dispatch('build', 'Build', 'npm run build');
    node_assert_1.default.strictEqual(host.terminals[0].shown, false);
    registry.dispatch('build', 'Build', 'npm run build', { focus: true });
    node_assert_1.default.strictEqual(host.terminals[0].shown, true);
});
//# sourceMappingURL=terminalRegistry.test.js.map