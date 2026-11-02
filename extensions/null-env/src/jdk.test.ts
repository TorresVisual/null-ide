import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { findJdks, majorOf, parseJavaVersion, runtimeName, type JdkFs } from './jdk';

test('versions parse from the release file and map to a major', () => {
  assert.equal(parseJavaVersion('IMPLEMENTOR="x"\nJAVA_VERSION="21.0.2"\n'), '21.0.2');
  assert.equal(parseJavaVersion('nothing here'), null);
  assert.equal(majorOf('21.0.2'), 21);
  assert.equal(majorOf('17'), 17);
  assert.equal(majorOf('1.8.0_392'), 8);
  assert.equal(majorOf('garbage'), 0);
});

test('runtime names follow the JavaSE convention', () => {
  assert.equal(runtimeName(8), 'JavaSE-1.8');
  assert.equal(runtimeName(21), 'JavaSE-21');
});

/** A fake disk: `files` maps a path to its content; directories are implied by the paths. */
function fakeFs(files: Record<string, string>): JdkFs {
  return {
    listDir: p => {
      const prefix = p.endsWith('\\') ? p : `${p}\\`;
      const kids = new Set(Object.keys(files).filter(f => f.startsWith(prefix)).map(f => f.slice(prefix.length).split('\\')[0]));
      if (kids.size === 0) { throw new Error('ENOENT'); }
      return [...kids];
    },
    readFile: p => {
      if (!(p in files)) { throw new Error('ENOENT'); }
      return files[p];
    },
    isFile: p => p in files,
  };
}

test('windows discovery finds vendor installs, JAVA_HOME and ~/.jdks once each, newest first', () => {
  const fs = fakeFs({
    'C:\\Program Files\\Java\\jdk-17\\bin\\javac.exe': '',
    'C:\\Program Files\\Java\\jdk-17\\release': 'JAVA_VERSION="17.0.9"',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\javac.exe': '',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21\\release': 'JAVA_VERSION="21.0.2"',
    'C:\\Users\\me\\.jdks\\corretto-1.8\\bin\\javac.exe': '',
    'C:\\Program Files\\Java\\jre-8\\bin\\java.exe': '', // a JRE has no javac
  });
  const jdks = findJdks(fs, 'win32', 'C:\\Users\\me', { JAVA_HOME: 'C:\\Program Files\\Java\\jdk-17\\' });
  assert.deepEqual(jdks.map(j => [j.home, j.version, j.major]), [
    ['C:\\Program Files\\Eclipse Adoptium\\jdk-21', '21.0.2', 21],
    ['C:\\Program Files\\Java\\jdk-17', '17.0.9', 17],
    ['C:\\Users\\me\\.jdks\\corretto-1.8', 'unknown', 0],
  ]);
});

test('no JDKs anywhere gives an empty list', () => {
  assert.deepEqual(findJdks(fakeFs({}), 'win32', 'C:\\Users\\me', {}), []);
});
