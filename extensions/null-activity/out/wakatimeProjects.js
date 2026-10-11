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
exports.diskProjectResolver = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const projectIdentity_1 = require("./projectIdentity");
/**
 * Matches a WakaTime project to a git repo that still exists on this machine, so imported and native time
 * share one project key. Directories from other machines (or deleted ones) simply do not resolve.
 */
const diskProjectResolver = (_projectName, dir) => {
    if (!path.isAbsolute(dir) || !fs.existsSync(dir))
        return undefined;
    const root = (0, projectIdentity_1.repoRoot)(dir);
    if (!root)
        return undefined;
    const { key, name } = (0, projectIdentity_1.resolveProject)(root);
    return { key, name, root };
};
exports.diskProjectResolver = diskProjectResolver;
//# sourceMappingURL=wakatimeProjects.js.map