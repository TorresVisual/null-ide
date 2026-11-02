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
const jdk_1 = require("./jdk");
(0, node_test_1.test)('versions parse from the release file and map to a major', () => {
    assert.equal((0, jdk_1.parseJavaVersion)('IMPLEMENTOR="x"\nJAVA_VERSION="21.0.2"\n'), '21.0.2');
    assert.equal((0, jdk_1.parseJavaVersion)('nothing here'), null);
    assert.equal((0, jdk_1.majorOf)('21.0.2'), 21);
    assert.equal((0, jdk_1.majorOf)('17'), 17);
    assert.equal((0, jdk_1.majorOf)('1.8.0_392'), 8);
    assert.equal((0, jdk_1.majorOf)('garbage'), 0);
});
(0, node_test_1.test)('runtime names follow the JavaSE convention', () => {
    assert.equal((0, jdk_1.runtimeName)(8), 'JavaSE-1.8');
    assert.equal((0, jdk_1.runtimeName)(21), 'JavaSE-21');
});
/** A fake disk: `files` maps a path to its content; directories are implied by the paths. */
function fakeFs(files) {
    return {
        listDir: p => {
            const prefix = p.endsWith('\\') ? p : `${p}\\`;
            const kids = new Set(Object.keys(files).filter(f => f.startsWith(prefix)).map(f => f.slice(prefix.length).split('\\')[0]));
            if (kids.size === 0) {
                throw new Error('ENOENT');
            }
            return [...kids];
        },
        readFile: p => {
            if (!(p in files)) {
                throw new Error('ENOENT');
            }
            return files[p];
        },
        isFile: p => p in files,
    };
}
(0, node_test_1.test)('windows discovery finds vendor installs, JAVA_HOME and ~/.jdks once each, newest first', () => {
    const fs = fakeFs({
        'C:\\Program Files\\Java\\jdk-17\\bin\\javac.exe': '',
        'C:\\Program Files\\Java\\jdk-17\\release': 'JAVA_VERSION="17.0.9"',
        'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\javac.exe': '',
        'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\release': 'JAVA_VERSION="21.0.2"',
        'C:\\Users\\me\\.jdks\\corretto-1.8\\bin\\javac.exe': '',
        'C:\\Program Files\\Java\\jre-8\\bin\\java.exe': '', // a JRE has no javac
    });
    const jdks = (0, jdk_1.findJdks)(fs, 'win32', 'C:\\Users\\me', { JAVA_HOME: 'C:\\Program Files\\Java\\jdk-17\\' });
    assert.deepEqual(jdks.map(j => [j.home, j.version, j.major]), [
        ['C:\\Program Files\\Eclipse Adoptium\\jdk-21', '21.0.2', 21],
        ['C:\\Program Files\\Java\\jdk-17', '17.0.9', 17],
        ['C:\\Users\\me\\.jdks\\corretto-1.8', 'unknown', 0],
    ]);
});
(0, node_test_1.test)('no JDKs anywhere gives an empty list', () => {
    assert.deepEqual((0, jdk_1.findJdks)(fakeFs({}), 'win32', 'C:\\Users\\me', {}), []);
});
//# sourceMappingURL=jdk.test.js.map