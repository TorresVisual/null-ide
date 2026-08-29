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
const wslPath_1 = require("./wslPath");
(0, node_test_1.test)('toWslPath converts a drive path to /mnt form, lowercasing the drive letter', () => {
    assert.equal((0, wslPath_1.toWslPath)('C:\\Users\\Foo\\bar.txt'), '/mnt/c/Users/Foo/bar.txt');
    assert.equal((0, wslPath_1.toWslPath)('D:/Projects/app'), '/mnt/d/Projects/app');
});
(0, node_test_1.test)('toWslPath handles a bare drive root', () => {
    assert.equal((0, wslPath_1.toWslPath)('C:\\'), '/mnt/c');
});
(0, node_test_1.test)('toWslPath leaves an already-POSIX path alone', () => {
    assert.equal((0, wslPath_1.toWslPath)('/home/user/project'), '/home/user/project');
});
(0, node_test_1.test)('fromWslPath converts /mnt/<drive> back to a Windows drive path', () => {
    assert.equal((0, wslPath_1.fromWslPath)('/mnt/c/Users/Foo', 'Ubuntu'), 'C:\\Users\\Foo');
    assert.equal((0, wslPath_1.fromWslPath)('/mnt/d/Projects/app', 'Ubuntu'), 'D:\\Projects\\app');
});
(0, node_test_1.test)('fromWslPath handles a bare /mnt/<drive> root', () => {
    assert.equal((0, wslPath_1.fromWslPath)('/mnt/c', 'Ubuntu'), 'C:\\');
});
(0, node_test_1.test)('fromWslPath addresses non-mount paths through the wsl.localhost UNC root', () => {
    assert.equal((0, wslPath_1.fromWslPath)('/home/user/project', 'Ubuntu-22.04'), '\\\\wsl.localhost\\Ubuntu-22.04\\home\\user\\project');
});
(0, node_test_1.test)('toWslPath and fromWslPath round-trip a /mnt path', () => {
    const windows = 'C:\\Users\\Foo\\bar.txt';
    assert.equal((0, wslPath_1.fromWslPath)((0, wslPath_1.toWslPath)(windows), 'Ubuntu'), windows);
});
//# sourceMappingURL=wslPath.test.js.map