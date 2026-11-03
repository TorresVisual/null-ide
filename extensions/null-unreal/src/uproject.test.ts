import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { resolveProject, ResolveError, ProjectFs } from './uproject';

// In-memory project tree: `files` maps full paths to contents.
function memFs(files: Record<string, string>): ProjectFs {
  const paths = Object.keys(files);
  return {
    readdir: (dir) => paths.filter((p) => path.dirname(p) === dir).map((p) => path.basename(p)),
    readFile: (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return files[p];
    },
    exists: (p) => p in files || paths.some((f) => f.startsWith(p + path.sep)),
  };
}

const root = path.resolve('/work/MyGame');
const mygame = path.join(root, 'MyGame.uproject');
const other = path.join(root, 'Tools', 'Other.uproject');
const body = '{"EngineAssociation":"5.8"}';

test('walks up from Source/Game to the project file', () => {
  const fs = memFs({ [mygame]: body });
  const p = resolveProject(path.join(root, 'Source', 'Game'), undefined, fs);
  assert.equal(p.file, mygame);
  assert.equal(p.dir, root);
  assert.equal(p.name, 'MyGame');
  assert.equal(p.engineAssociation, '5.8');
});

test('explicit project file wins over walking up', () => {
  const fs = memFs({ [mygame]: body, [other]: body });
  const p = resolveProject(root, other, fs);
  assert.equal(p.file, other);
});

test('explicit directory holding one project resolves to it', () => {
  const fs = memFs({ [mygame]: body, [other]: body });
  const p = resolveProject(root, path.dirname(other), fs);
  assert.equal(p.file, other);
});

test('two project files in one directory is an error that lists both', () => {
  const a = path.join(root, 'A.uproject');
  const b = path.join(root, 'B.uproject');
  const fs = memFs({ [a]: body, [b]: body });
  assert.throws(
    () => resolveProject(root, undefined, fs),
    (e: unknown) => e instanceof ResolveError && /A\.uproject/.test(e.message) && /B\.uproject/.test(e.message),
  );
});

test('no project up to the drive root is an error that mentions --project', () => {
  const fs = memFs({});
  assert.throws(
    () => resolveProject(path.join(root, 'x'), undefined, fs),
    (e: unknown) => e instanceof ResolveError && /--project/.test(e.message),
  );
});

test('a project file with a UTF-8 BOM parses', () => {
  const fs = memFs({ [mygame]: '\uFEFF' + body });
  assert.equal(resolveProject(root, undefined, fs).engineAssociation, '5.8');
});

test('malformed JSON is an error that names the file', () => {
  const fs = memFs({ [mygame]: '{"EngineAssociation":' });
  assert.throws(
    () => resolveProject(root, undefined, fs),
    (e: unknown) => e instanceof ResolveError && e.message.includes('MyGame.uproject'),
  );
});
