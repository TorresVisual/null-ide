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
const node_test_1 = __importDefault(require("node:test"));
const path = __importStar(require("node:path"));
const nullNotesPath_1 = require("./nullNotesPath");
(0, node_test_1.default)('resolveNullNotesExePath uses the override when set', () => {
    node_assert_1.default.strictEqual((0, nullNotesPath_1.resolveNullNotesExePath)('C:\\custom\\null-notes.exe', 'C:\\Users\\me\\AppData\\Local'), 'C:\\custom\\null-notes.exe');
});
(0, node_test_1.default)('resolveNullNotesExePath falls back to the default install location when empty', () => {
    node_assert_1.default.strictEqual((0, nullNotesPath_1.resolveNullNotesExePath)('', 'C:\\Users\\me\\AppData\\Local'), path.join('C:\\Users\\me\\AppData\\Local', 'null-notes', 'null-notes.exe'));
});
(0, node_test_1.default)('resolveNullNotesExePath treats a whitespace-only override as unset', () => {
    node_assert_1.default.strictEqual((0, nullNotesPath_1.resolveNullNotesExePath)('   ', 'C:\\Users\\me\\AppData\\Local'), path.join('C:\\Users\\me\\AppData\\Local', 'null-notes', 'null-notes.exe'));
});
//# sourceMappingURL=nullNotes.test.js.map