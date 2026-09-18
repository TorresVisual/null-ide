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
const scaffoldNaming_1 = require("./scaffoldNaming");
(0, node_test_1.test)('validateClassName rejects an empty name', () => {
    assert.equal((0, scaffoldNaming_1.validateClassName)(''), 'Class name cannot be empty.');
    assert.equal((0, scaffoldNaming_1.validateClassName)('   '), 'Class name cannot be empty.');
});
(0, node_test_1.test)('validateClassName rejects a name starting with a digit', () => {
    assert.match((0, scaffoldNaming_1.validateClassName)('123Foo') ?? '', /must start with a letter or underscore/);
});
(0, node_test_1.test)('validateClassName rejects a name with invalid characters', () => {
    assert.match((0, scaffoldNaming_1.validateClassName)('My Class') ?? '', /must start with a letter or underscore/);
});
(0, node_test_1.test)('validateClassName accepts a valid identifier', () => {
    assert.equal((0, scaffoldNaming_1.validateClassName)('My_Class1'), undefined);
    assert.equal((0, scaffoldNaming_1.validateClassName)('_private'), undefined);
});
(0, node_test_1.test)('headerFileName and sourceFileName append the right extensions', () => {
    assert.equal((0, scaffoldNaming_1.headerFileName)('Widget'), 'Widget.hpp');
    assert.equal((0, scaffoldNaming_1.sourceFileName)('Widget'), 'Widget.cpp');
});
(0, node_test_1.test)('headerContent is just pragma once', () => {
    assert.equal((0, scaffoldNaming_1.headerContent)(), '#pragma once\n\n');
});
(0, node_test_1.test)('sourceContent includes the matching header include', () => {
    assert.equal((0, scaffoldNaming_1.sourceContent)('Widget'), '#include "Widget.hpp"\n\n');
});
//# sourceMappingURL=scaffoldNaming.test.js.map