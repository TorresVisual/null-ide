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
exports.evaluateWhenClause = evaluateWhenClause;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function evaluateWhenClause(when, ctx) {
    if (!when) {
        return true;
    }
    if (when.folder !== undefined && when.folder !== ctx.folderName) {
        return false;
    }
    if (when.languages && when.languages.length > 0) {
        if (!ctx.activeLanguageId || !when.languages.includes(ctx.activeLanguageId)) {
            return false;
        }
    }
    if (when.filesExist && when.filesExist.length > 0) {
        if (!ctx.folderPath) {
            return false;
        }
        for (const rel of when.filesExist) {
            if (!fs.existsSync(path.join(ctx.folderPath, rel))) {
                return false;
            }
        }
    }
    return true;
}
//# sourceMappingURL=whenClause.js.map