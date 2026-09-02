import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  wrapWslCommand,
  pickLatestIndexFile,
  parseReplyIndex,
  parseCodemodelTargets,
  parseTargetDetail,
} from './cmakeReply';

test('wrapWslCommand wraps the command through wsl.exe -d <distro> --', () => {
  const wrapped = wrapWslCommand('cmake', ['--build', '.'], 'Ubuntu');
  assert.equal(wrapped.command, 'wsl.exe');
  assert.deepEqual(wrapped.args, ['-d', 'Ubuntu', '--', 'cmake', '--build', '.']);
});

test('wrapWslCommand sets an explicit --cd when a posix cwd is given', () => {
  const wrapped = wrapWslCommand('cmake', ['--build', '.'], 'Ubuntu', '/mnt/d/proj');
  assert.deepEqual(wrapped.args, ['-d', 'Ubuntu', '--cd', '/mnt/d/proj', '--', 'cmake', '--build', '.']);
});

test('pickLatestIndexFile picks the lexicographically-last index-*.json', () => {
  const files = [
    'index-2024-01-01T00-00-00-0000.json',
    'index-2024-06-01T00-00-00-0000.json',
    'codemodel-v2-abc.json',
  ];
  assert.equal(pickLatestIndexFile(files), 'index-2024-06-01T00-00-00-0000.json');
});

test('pickLatestIndexFile returns undefined when no index file exists', () => {
  assert.equal(pickLatestIndexFile(['codemodel-v2-abc.json']), undefined);
});

test('parseReplyIndex extracts the codemodel-v2 jsonFile reference', () => {
  const index = {
    reply: {
      'codemodel-v2': { kind: 'codemodel', version: { major: 2, minor: 8 }, jsonFile: 'codemodel-v2-abc.json' },
    },
  };
  assert.deepEqual(parseReplyIndex(index), { kind: 'codemodel', jsonFile: 'codemodel-v2-abc.json' });
});

test('parseReplyIndex returns undefined when the query errored or is missing', () => {
  assert.equal(parseReplyIndex({ reply: { 'codemodel-v2': { error: 'unknown query file' } } }), undefined);
  assert.equal(parseReplyIndex({ reply: {} }), undefined);
  assert.equal(parseReplyIndex({}), undefined);
});

test('parseCodemodelTargets returns the first configuration by default', () => {
  const codemodel = {
    configurations: [
      { name: 'Debug', targets: [{ name: 'app', jsonFile: 'target-app-Debug.json' }] },
      { name: 'Release', targets: [{ name: 'app', jsonFile: 'target-app-Release.json' }] },
    ],
  };
  assert.deepEqual(parseCodemodelTargets(codemodel), [{ name: 'app', jsonFile: 'target-app-Debug.json' }]);
});

test('parseCodemodelTargets can select a named configuration', () => {
  const codemodel = {
    configurations: [
      { name: 'Debug', targets: [{ name: 'app', jsonFile: 'target-app-Debug.json' }] },
      { name: 'Release', targets: [{ name: 'app', jsonFile: 'target-app-Release.json' }] },
    ],
  };
  assert.deepEqual(parseCodemodelTargets(codemodel, 'Release'), [{ name: 'app', jsonFile: 'target-app-Release.json' }]);
});

test('parseTargetDetail resolves the artifact path against the binary directory', () => {
  const detail = {
    type: 'EXECUTABLE',
    artifacts: [{ path: 'Debug/app.exe' }],
    sources: [{ path: 'src/main.cpp' }],
  };
  const target = parseTargetDetail('app', detail, 'C:\\proj\\build');
  assert.equal(target.name, 'app');
  assert.equal(target.type, 'EXECUTABLE');
  assert.equal(target.artifactPath, 'C:\\proj\\build\\Debug\\app.exe');
  assert.deepEqual(target.sourceFiles, ['src/main.cpp']);
});

test('parseTargetDetail defaults an artifact-less target (e.g. a UTILITY) to an empty artifactPath', () => {
  const target = parseTargetDetail('docs', {}, 'C:\\proj\\build');
  assert.equal(target.type, 'UTILITY');
  assert.equal(target.artifactPath, '');
  assert.deepEqual(target.sourceFiles, []);
});
