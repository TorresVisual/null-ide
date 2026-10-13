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
exports.extensionHost = void 0;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const extensionSet_1 = require("./extensionSet");
/**
 * `~/<dataFolderName>/extensions/extensions.json` lists every installed user extension, disabled ones included
 * (`vscode.extensions.all` lists enabled ones only). `dataFolderName` is `Null` in this product's product.json.
 */
function manifestPath() {
    try {
        const product = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8'));
        return product.dataFolderName ? path.join(os.homedir(), product.dataFolderName, 'extensions', 'extensions.json') : undefined;
    }
    catch {
        return undefined;
    }
}
async function installed() {
    const file = manifestPath();
    if (!file)
        return undefined;
    try {
        return (0, extensionSet_1.installedIds)(await fs.promises.readFile(file, 'utf8'));
    }
    catch {
        return undefined;
    }
}
/** The commands can resolve without an error even when nothing happened, so the result is checked against the manifest. */
exports.extensionHost = {
    installed,
    async install(id) {
        try {
            await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
        }
        catch {
            return false;
        }
        return ((await installed()) ?? []).includes(id.toLowerCase());
    },
    async uninstall(id) {
        try {
            await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', id);
        }
        catch {
            return false;
        }
        return !((await installed()) ?? [id.toLowerCase()]).includes(id.toLowerCase());
    },
};
//# sourceMappingURL=extensionHost.js.map