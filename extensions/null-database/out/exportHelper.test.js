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
const assert = __importStar(require("node:assert"));
const exportHelper_1 = require("./exportHelper");
(0, node_test_1.test)('formatCsvCell handles primitives, nulls and escaping', () => {
    assert.strictEqual((0, exportHelper_1.formatCsvCell)(null), '');
    assert.strictEqual((0, exportHelper_1.formatCsvCell)(undefined), '');
    assert.strictEqual((0, exportHelper_1.formatCsvCell)(123), '123');
    assert.strictEqual((0, exportHelper_1.formatCsvCell)('hello'), 'hello');
    assert.strictEqual((0, exportHelper_1.formatCsvCell)('hello, world'), '"hello, world"');
    assert.strictEqual((0, exportHelper_1.formatCsvCell)('hello "world"'), '"hello ""world"""');
    assert.strictEqual((0, exportHelper_1.formatCsvCell)('line 1\nline 2'), '"line 1\nline 2"');
    assert.strictEqual((0, exportHelper_1.formatCsvCell)(BigInt(9007199254740991)), '9007199254740991');
});
(0, node_test_1.test)('rowsToCsv formats table to CSV RFC 4180', () => {
    const columns = ['id', 'name', 'bio'];
    const rows = [
        { id: 1, name: 'Alice', bio: 'Coder, creator' },
        { id: 2, name: 'Bob "The Builder"', bio: 'Line1\nLine2' }
    ];
    const csv = (0, exportHelper_1.rowsToCsv)(columns, rows);
    const lines = csv.split('\r\n');
    assert.strictEqual(lines.length, 3);
    assert.strictEqual(lines[0], 'id,name,bio');
    assert.strictEqual(lines[1], '1,Alice,"Coder, creator"');
    assert.strictEqual(lines[2], '2,"Bob ""The Builder""","Line1\nLine2"');
});
(0, node_test_1.test)('rowsToJson formats rows with bigint and buffers safely', () => {
    const rows = [
        { id: BigInt(42), label: 'item 1' },
        { id: 2, data: new Uint8Array([1, 2, 3]) }
    ];
    const json = (0, exportHelper_1.rowsToJson)(rows, false);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed[0].id, '42');
    assert.strictEqual(parsed[0].label, 'item 1');
    assert.strictEqual(parsed[1].data, '[BLOB 3 bytes]');
});
//# sourceMappingURL=exportHelper.test.js.map