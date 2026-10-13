import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { parse } from 'jsonc-parser';
import { matchesKey, reapplyExcluded, stripExcluded } from './settingsFilter';

const EXCL = ['*.path', '*Path', '*token*', 'http.proxy'];
const obj = (text: string | undefined): unknown => parse(text ?? '');

describe('matchesKey', () => {
  it('matches glob patterns case-insensitively and anchored', () => {
    for (const k of ['git.path', 'rust-analyzer.server.path', 'python.defaultInterpreterPath', 'x.apiToken', 'http.proxy']) {
      assert.equal(matchesKey(k, EXCL), true, k);
    }
    for (const k of ['editor.fontSize', 'paths.x', 'workbench.colorTheme']) assert.equal(matchesKey(k, EXCL), false, k);
  });

  it('treats a dot in a pattern literally', () => {
    assert.equal(matchesKey('httpXproxy', ['http.proxy']), false);
  });
});

describe('stripExcluded', () => {
  const src = '{\n  // font\n  "editor.fontSize": 14,\n  "git.path": "C:\\\\git.exe",\n  "workbench.colorTheme": "Null Dark"\n}\n';

  it('removes matching keys and keeps comments, indentation and the other keys', () => {
    assert.equal(
      stripExcluded(src, EXCL),
      '{\n  // font\n  "editor.fontSize": 14,\n  "workbench.colorTheme": "Null Dark"\n}\n',
    );
  });

  it('leaves text byte-identical when nothing matches', () => {
    assert.equal(stripExcluded('{\n  "a": 1\n}\n', EXCL), '{\n  "a": 1\n}\n');
  });

  it('removes the last key without leaving a comma', () => {
    assert.equal(stripExcluded('{\n  "a": 1,\n  "git.path": "x"\n}\n', EXCL), '{\n  "a": 1\n}\n');
  });

  it('keeps tab indentation and CRLF line endings', () => {
    assert.equal(stripExcluded('{\n\t"a": 1,\n\t"git.path": "x"\n}\n', EXCL), '{\n\t"a": 1\n}\n');
    assert.equal(stripExcluded('{\r\n  "a": 1,\r\n  "git.path": "x"\r\n}\r\n', EXCL), '{\r\n  "a": 1\r\n}\r\n');
  });

  it('accepts comments and trailing commas', () => {
    assert.deepEqual(obj(stripExcluded('{\n  "a": 1, // one\n  "git.path": "x",\n}\n', EXCL)), { a: 1 });
  });

  it('treats an empty or blank file as valid and leaves it alone', () => {
    assert.equal(stripExcluded('', EXCL), '');
    assert.equal(stripExcluded('  \n', EXCL), '  \n');
  });

  it('returns undefined for invalid JSON or a non-object', () => {
    assert.equal(stripExcluded('{ "a": ', EXCL), undefined);
    assert.equal(stripExcluded('[1]', EXCL), undefined);
  });

  it('handles a file that holds only excluded keys', () => {
    assert.deepEqual(obj(stripExcluded('{\n  "git.path": "x"\n}\n', EXCL)), {});
  });
});

describe('reapplyExcluded', () => {
  const local = '{\n  // font\n  "editor.fontSize": 14,\n  "git.path": "C:\\\\git.exe",\n  "workbench.colorTheme": "Null Dark"\n}\n';

  it('puts this device\'s excluded values back into the incoming text', () => {
    const incoming = '{\n  "editor.fontSize": 16\n}\n';
    assert.deepEqual(obj(reapplyExcluded(incoming, local, EXCL)), { 'editor.fontSize': 16, 'git.path': 'C:\\git.exe' });
  });

  it('round-trips: strip then reapply gives back the same settings', () => {
    const stripped = stripExcluded(local, EXCL);
    assert.deepEqual(obj(reapplyExcluded(stripped!, local, EXCL)), obj(local));
  });

  it('drops an excluded key that an older client uploaded', () => {
    const incoming = '{\n  "a": 1,\n  "git.path": "REMOTE"\n}\n';
    assert.deepEqual(obj(reapplyExcluded(incoming, '{ "other": 1 }', EXCL)), { a: 1 });
  });

  it('with no local file there is nothing to put back', () => {
    assert.deepEqual(obj(reapplyExcluded('{\n  "a": 1\n}\n', null, EXCL)), { a: 1 });
  });

  it('keeps tabs and CRLF when inserting', () => {
    assert.equal(
      reapplyExcluded('{\n\t"a": 1\n}\n', '{ "git.path": "x" }', EXCL),
      '{\n\t"a": 1,\n\t"git.path": "x"\n}\n',
    );
    assert.equal(
      reapplyExcluded('{\r\n  "a": 1\r\n}\r\n', '{\r\n  "git.path": "D:\\\\b"\r\n}\r\n', EXCL),
      '{\r\n  "a": 1,\r\n  "git.path": "D:\\\\b"\r\n}\r\n',
    );
  });

  it('works when the incoming file is empty', () => {
    assert.deepEqual(obj(reapplyExcluded('', local, EXCL)), { 'git.path': 'C:\\git.exe' });
  });

  it('returns undefined when either side is not valid JSON', () => {
    assert.equal(reapplyExcluded('{ "a": ', local, EXCL), undefined);
    assert.equal(reapplyExcluded('{}', '{ bad', EXCL), undefined);
  });
});
