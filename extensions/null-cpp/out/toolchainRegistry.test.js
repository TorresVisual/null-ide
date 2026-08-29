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
const assert = __importStar(require("node:assert/strict"));
const toolchainRegistry_1 = require("./toolchainRegistry");
(0, node_test_1.test)('parseVswhereInstallPaths splits one path per line and drops blanks', () => {
    const stdout = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\r\n\r\n';
    assert.deepEqual((0, toolchainRegistry_1.parseVswhereInstallPaths)(stdout), [
        'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
    ]);
});
(0, node_test_1.test)('parseVswhereInstallPaths handles multiple installs', () => {
    const stdout = 'C:\\VS\\2022\\Community\nC:\\VS\\2022\\BuildTools\n';
    assert.deepEqual((0, toolchainRegistry_1.parseVswhereInstallPaths)(stdout), ['C:\\VS\\2022\\Community', 'C:\\VS\\2022\\BuildTools']);
});
(0, node_test_1.test)('pickLatestMsvcVersion picks the numerically highest version', () => {
    assert.equal((0, toolchainRegistry_1.pickLatestMsvcVersion)(['14.38.33130', '14.9.0', '14.38.9']), '14.38.33130');
});
(0, node_test_1.test)('pickLatestMsvcVersion ignores non-numeric directory names', () => {
    assert.equal((0, toolchainRegistry_1.pickLatestMsvcVersion)(['14.38.33130', 'not-a-version']), '14.38.33130');
});
(0, node_test_1.test)('pickLatestMsvcVersion returns undefined for an empty or all-invalid list', () => {
    assert.equal((0, toolchainRegistry_1.pickLatestMsvcVersion)([]), undefined);
    assert.equal((0, toolchainRegistry_1.pickLatestMsvcVersion)(['abc', 'def']), undefined);
});
(0, node_test_1.test)('parseClangVersion extracts the version from clang --version output', () => {
    const output = 'clang version 17.0.3\nTarget: x86_64-pc-windows-msvc\n';
    assert.equal((0, toolchainRegistry_1.parseClangVersion)(output), '17.0.3');
});
(0, node_test_1.test)('parseClangVersion returns undefined for unrelated output', () => {
    assert.equal((0, toolchainRegistry_1.parseClangVersion)('gcc (GCC) 13.2.0'), undefined);
});
(0, node_test_1.test)('parseWslDistroList strips stray null bytes and blank lines', () => {
    const raw = 'Ubuntu \r\n \r\ndebian \r\n \r\n';
    assert.deepEqual((0, toolchainRegistry_1.parseWslDistroList)(raw), ['Ubuntu', 'debian']);
});
(0, node_test_1.test)('parseWslDistroList drops the non-quiet header line if one is present', () => {
    const raw = 'Windows Subsystem for Linux Distributions:\r\nUbuntu-22.04\r\n';
    assert.deepEqual((0, toolchainRegistry_1.parseWslDistroList)(raw), ['Ubuntu-22.04']);
});
//# sourceMappingURL=toolchainRegistry.test.js.map