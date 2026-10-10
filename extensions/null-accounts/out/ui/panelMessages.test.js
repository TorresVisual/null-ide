'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const panelMessages_1 = require("./panelMessages");
(0, node_test_1.test)('well-formed messages parse and drop unknown fields', () => {
    node_assert_1.default.deepStrictEqual((0, panelMessages_1.parsePanelMessage)({ type: 'ready' }), { type: 'ready' });
    node_assert_1.default.deepStrictEqual((0, panelMessages_1.parsePanelMessage)({ type: 'add', evil: 1 }), { type: 'add' });
    node_assert_1.default.deepStrictEqual((0, panelMessages_1.parsePanelMessage)({ type: 'remove', id: 'a1', extra: true }), { type: 'remove', id: 'a1' });
    node_assert_1.default.deepStrictEqual((0, panelMessages_1.parsePanelMessage)({ type: 'editEmail', id: 'a1' }), { type: 'editEmail', id: 'a1' });
    node_assert_1.default.deepStrictEqual((0, panelMessages_1.parsePanelMessage)({ type: 'unbind', key: 'c:/repo' }), { type: 'unbind', key: 'c:/repo' });
    node_assert_1.default.deepStrictEqual((0, panelMessages_1.parsePanelMessage)({ type: 'reauth', id: 'a1', extra: 1 }), { type: 'reauth', id: 'a1' });
});
(0, node_test_1.test)('anything else is rejected without throwing', () => {
    for (const bad of [
        undefined, null, 'remove', 42, [], {},
        { type: 'nope' },
        { type: 'remove' }, { type: 'remove', id: '' }, { type: 'remove', id: 7 },
        { type: 'editEmail', id: null },
        { type: 'reauth' }, { type: 'reauth', id: '' },
        { type: 'unbind' }, { type: 'unbind', key: '' }, { type: 'unbind', id: 'a1' },
    ]) {
        node_assert_1.default.strictEqual((0, panelMessages_1.parsePanelMessage)(bad), undefined, JSON.stringify(bad));
    }
});
(0, node_test_1.test)('key messages carry an account id, and setSigning a real boolean', () => {
    for (const type of ['generateKey', 'attachKey', 'copyPublicKey', 'uploadKey', 'testKey', 'removeKey']) {
        node_assert_1.default.deepStrictEqual((0, panelMessages_1.parsePanelMessage)({ type, id: 'a1', evil: 1 }), { type, id: 'a1' });
        node_assert_1.default.strictEqual((0, panelMessages_1.parsePanelMessage)({ type }), undefined, type);
        node_assert_1.default.strictEqual((0, panelMessages_1.parsePanelMessage)({ type, id: '' }), undefined, type);
    }
    node_assert_1.default.deepStrictEqual((0, panelMessages_1.parsePanelMessage)({ type: 'setSigning', id: 'a1', on: true }), { type: 'setSigning', id: 'a1', on: true });
    node_assert_1.default.deepStrictEqual((0, panelMessages_1.parsePanelMessage)({ type: 'setSigning', id: 'a1', on: false }), { type: 'setSigning', id: 'a1', on: false });
    for (const bad of [{ type: 'setSigning', id: 'a1' }, { type: 'setSigning', id: 'a1', on: 'yes' }, { type: 'setSigning', on: true }]) {
        node_assert_1.default.strictEqual((0, panelMessages_1.parsePanelMessage)(bad), undefined, JSON.stringify(bad));
    }
});
//# sourceMappingURL=panelMessages.test.js.map