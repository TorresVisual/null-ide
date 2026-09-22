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
exports.isHeaderFile = isHeaderFile;
exports.resolveOutputBinaryPath = resolveOutputBinaryPath;
exports.buildCompileArgs = buildCompileArgs;
const path = __importStar(require("node:path"));
const wslPath_1 = require("./wslPath");
const HEADER_EXTENSIONS = new Set(['.h', '.hpp', '.hxx', '.hh', '.h++', '.inl', '.tcc']);
function isHeaderFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return HEADER_EXTENSIONS.has(ext);
}
function resolveOutputBinaryPath(filePath, isWsl, outputDir) {
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    const targetDir = outputDir ? outputDir : path.dirname(filePath);
    const binaryExt = isWsl ? '' : '.exe';
    return path.join(targetDir, `${baseName}${binaryExt}`);
}
function buildCompileArgs(options) {
    const isWsl = options.isWsl ?? false;
    const isHeader = isHeaderFile(options.filePath);
    const syntaxOnly = options.syntaxOnly ?? isHeader;
    const defaultFlags = ['-std=c++20', '-Wall', '-Wextra'];
    const userFlags = options.extraArgs && options.extraArgs.length > 0 ? options.extraArgs : defaultFlags;
    const args = [...userFlags];
    if (syntaxOnly) {
        if (!args.includes('-fsyntax-only')) {
            args.push('-fsyntax-only');
        }
    }
    else if (options.outputBinaryPath) {
        const outPath = isWsl ? (0, wslPath_1.toWslPath)(options.outputBinaryPath) : options.outputBinaryPath;
        args.push('-o', outPath);
    }
    // Include current file's directory
    const fileDir = path.dirname(options.filePath);
    const fileDirArg = isWsl ? (0, wslPath_1.toWslPath)(fileDir) : fileDir;
    args.push(`-I${fileDirArg}`);
    // Include workspace source dir
    if (options.sourceDir && options.sourceDir !== fileDir) {
        const srcDirArg = isWsl ? (0, wslPath_1.toWslPath)(options.sourceDir) : options.sourceDir;
        args.push(`-I${srcDirArg}`);
    }
    // Include optional extra include paths
    if (options.includeDirs) {
        for (const inc of options.includeDirs) {
            const incArg = isWsl ? (0, wslPath_1.toWslPath)(inc) : inc;
            args.push(`-I${incArg}`);
        }
    }
    // Input file path
    const inputArg = isWsl ? (0, wslPath_1.toWslPath)(options.filePath) : options.filePath;
    args.push(inputArg);
    return args;
}
//# sourceMappingURL=singleFileCompileArgs.js.map