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
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadMachineId = loadMachineId;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const types_1 = require("./types");
/**
 * This installation's id, generated once and kept in `machine.json`. A reinstall or a wiped storage folder is a
 * new machine; the old id stays in the cloud as a separate machine. Never throws: if the file cannot be written
 * the id lasts for this launch only.
 */
function loadMachineId(dir, random = () => crypto.randomBytes(5).toString('hex')) {
    const file = path.join(dir, 'machine.json');
    try {
        const id = JSON.parse(fs.readFileSync(file, 'utf8'))?.id;
        if (typeof id === 'string' && types_1.MACHINE_ID_RE.test(id))
            return id;
    }
    catch {
        // missing or corrupt: make a new one
    }
    const id = random();
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ id }));
    }
    catch {
        // keep the id in memory
    }
    return id;
}
//# sourceMappingURL=machineId.js.map