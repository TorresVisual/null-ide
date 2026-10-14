'use strict';
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
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = require("node:test");
const machineId_1 = require("../machineId");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-machine-'));
(0, node_test_1.test)('the id is created once and then stays', () => {
    const dir = tmp();
    node_assert_1.default.strictEqual((0, machineId_1.loadMachineId)(dir, () => '0123456789'), '0123456789');
    node_assert_1.default.strictEqual((0, machineId_1.loadMachineId)(dir, () => 'ffffffffff'), '0123456789');
});
(0, node_test_1.test)('a corrupt or malformed machine.json is replaced', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'machine.json'), JSON.stringify({ id: '../../etc' }));
    node_assert_1.default.strictEqual((0, machineId_1.loadMachineId)(dir, () => 'aaaaaaaaaa'), 'aaaaaaaaaa');
    fs.writeFileSync(path.join(dir, 'machine.json'), '{nope');
    node_assert_1.default.strictEqual((0, machineId_1.loadMachineId)(dir, () => 'bbbbbbbbbb'), 'bbbbbbbbbb');
});
(0, node_test_1.test)('an unwritable folder still gives an id for this launch', () => {
    const file = path.join(tmp(), 'file');
    fs.writeFileSync(file, '');
    node_assert_1.default.strictEqual((0, machineId_1.loadMachineId)(path.join(file, 'sub'), () => 'cccccccccc'), 'cccccccccc');
});
//# sourceMappingURL=machineId.test.js.map