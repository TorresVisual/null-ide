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
const pairRegistry_1 = require("./pairRegistry");
(0, node_test_1.test)('record makes the pair discoverable from either uri', () => {
    const registry = new pairRegistry_1.PairRegistry();
    registry.record('a.hpp', 'a.cpp');
    assert.equal(registry.getCounterpart('a.hpp'), 'a.cpp');
    assert.equal(registry.getCounterpart('a.cpp'), 'a.hpp');
});
(0, node_test_1.test)('has returns false for an untracked uri', () => {
    const registry = new pairRegistry_1.PairRegistry();
    assert.equal(registry.has('a.hpp'), false);
});
(0, node_test_1.test)('has returns true once a uri is recorded', () => {
    const registry = new pairRegistry_1.PairRegistry();
    registry.record('a.hpp', 'a.cpp');
    assert.equal(registry.has('a.hpp'), true);
    assert.equal(registry.has('a.cpp'), true);
});
(0, node_test_1.test)('getCounterpart returns undefined for an untracked uri', () => {
    const registry = new pairRegistry_1.PairRegistry();
    assert.equal(registry.getCounterpart('a.hpp'), undefined);
});
(0, node_test_1.test)('remove drops the pair in both directions', () => {
    const registry = new pairRegistry_1.PairRegistry();
    registry.record('a.hpp', 'a.cpp');
    registry.remove('a.hpp');
    assert.equal(registry.has('a.hpp'), false);
    assert.equal(registry.has('a.cpp'), false);
});
//# sourceMappingURL=pairRegistry.test.js.map