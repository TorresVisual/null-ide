"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WootingBridge = exports.HID_CODES = exports.HID = void 0;
const index_1 = require("../native/index");
// ─── HID Usage Page 0x07 key codes ──────────────────────────────────────────
exports.HID = {
    Escape: 0x29,
    Backspace: 0x2A,
    Tab: 0x2B,
    Enter: 0x28,
    Delete: 0x4C,
    Left: 0x50,
    Right: 0x4F,
    Up: 0x52,
    Down: 0x51,
};
exports.HID_CODES = Object.values(exports.HID);
// ─── Bridge ──────────────────────────────────────────────────────────────────
class WootingBridge {
    constructor(dllPath) {
        this.dllPath = dllPath;
        this._initialized = false;
    }
    get initialized() {
        return this._initialized;
    }
    init() {
        this._initialized = (0, index_1.load)(this.dllPath);
        return this._initialized;
    }
    /**
     * Read all tracked keys in a single FFI call.
     * Returns a Map<HIDKey, depth> for easy lookup.
     */
    readAll() {
        const keys = Object.keys(exports.HID);
        const depths = (0, index_1.readAnalogBatch)(exports.HID_CODES);
        const result = new Map();
        keys.forEach((key, i) => result.set(key, depths[i]));
        return result;
    }
    dispose() {
        if (this._initialized) {
            (0, index_1.unload)();
            this._initialized = false;
        }
    }
}
exports.WootingBridge = WootingBridge;
//# sourceMappingURL=wootingBridge.js.map