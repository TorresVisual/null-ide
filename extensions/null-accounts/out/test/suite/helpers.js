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
exports.git = git;
exports.waitFor = waitFor;
const assert = __importStar(require("assert"));
const child_process_1 = require("child_process");
/** Output of `git <args>` in `cwd`; '' when git exits non-zero (an unset config key). */
function git(cwd, ...args) {
    try {
        return (0, child_process_1.execFileSync)('git', args, { cwd, encoding: 'utf8' }).trim();
    }
    catch {
        return '';
    }
}
/** Wiring runs asynchronously after a bind or a removal, so poll instead of reading once. */
async function waitFor(what, done) {
    for (let i = 0; i < 100; i++) {
        if (done()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`timed out waiting for ${what}`);
}
//# sourceMappingURL=helpers.js.map