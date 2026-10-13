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
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const syncPlan_1 = require("./syncPlan");
const base = (local, remote) => ({ local, remote });
(0, node_test_1.describe)('planFile', () => {
    (0, node_test_1.it)('is none when both sides are equal, whatever the base', () => {
        assert.equal((0, syncPlan_1.planFile)('a', 'a', undefined, false), 'none');
        assert.equal((0, syncPlan_1.planFile)('a', 'a', base('b', 'c'), false), 'none');
        assert.equal((0, syncPlan_1.planFile)(null, null, undefined, true), 'none');
    });
    (0, node_test_1.it)('first sync: a missing side has nothing to lose', () => {
        assert.equal((0, syncPlan_1.planFile)(null, 'r', undefined, true), 'pull');
        assert.equal((0, syncPlan_1.planFile)(null, 'r', undefined, false), 'pull');
        assert.equal((0, syncPlan_1.planFile)('l', null, undefined, true), 'push');
        assert.equal((0, syncPlan_1.planFile)('l', null, undefined, false), 'push');
    });
    (0, node_test_1.it)('first sync: both present and different is a conflict', () => {
        assert.equal((0, syncPlan_1.planFile)('l', 'r', undefined, false), 'conflict');
        assert.equal((0, syncPlan_1.planFile)('l', 'r', undefined, true), 'conflict');
    });
    (0, node_test_1.it)('only one side changed: that side wins', () => {
        assert.equal((0, syncPlan_1.planFile)('l', 'y', base('x', 'y'), false), 'push');
        assert.equal((0, syncPlan_1.planFile)('x', 'r', base('x', 'y'), false), 'pull');
    });
    (0, node_test_1.it)('neither side changed is none even if the two texts differ (settings.json after a pull)', () => {
        assert.equal((0, syncPlan_1.planFile)('x', 'y', base('x', 'y'), false), 'none');
    });
    (0, node_test_1.it)('both changed to different content is a conflict', () => {
        assert.equal((0, syncPlan_1.planFile)('l', 'r', base('x', 'y'), false), 'conflict');
    });
    (0, node_test_1.it)('a deleted snippet propagates in both directions', () => {
        assert.equal((0, syncPlan_1.planFile)(null, 'y', base('x', 'y'), true), 'push');
        assert.equal((0, syncPlan_1.planFile)('x', null, base('x', 'y'), true), 'pull');
    });
    (0, node_test_1.it)('a snippet deleted on one side and edited on the other is a conflict', () => {
        assert.equal((0, syncPlan_1.planFile)('l', null, base('x', 'y'), true), 'conflict');
        assert.equal((0, syncPlan_1.planFile)(null, 'r', base('x', 'y'), true), 'conflict');
    });
    (0, node_test_1.it)('a missing settings/keybindings file is never a deletion', () => {
        assert.equal((0, syncPlan_1.planFile)(null, 'y', base('x', 'y'), false), 'pull');
        assert.equal((0, syncPlan_1.planFile)(null, 'r', base('x', 'y'), false), 'pull');
        assert.equal((0, syncPlan_1.planFile)('x', null, base('x', 'y'), false), 'push');
    });
});
(0, node_test_1.describe)('planAll', () => {
    (0, node_test_1.it)('plans every file independently', () => {
        const plan = (0, syncPlan_1.planAll)({
            'settings.json': { local: 'l', remote: 'y', base: base('x', 'y'), deletable: false },
            'keybindings.json': { local: 'a', remote: 'a', base: undefined, deletable: false },
            'snippets/a.json': { local: 'l', remote: 'r', base: base('x', 'y'), deletable: true },
        });
        assert.deepEqual(plan, { 'settings.json': 'push', 'keybindings.json': 'none', 'snippets/a.json': 'conflict' });
    });
});
//# sourceMappingURL=syncPlan.test.js.map