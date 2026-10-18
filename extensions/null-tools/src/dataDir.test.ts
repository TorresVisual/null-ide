import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { nullDataDir } from './dataDir';

test('Windows uses %APPDATA%\\Null', () => {
  assert.equal(
    nullDataDir({ APPDATA: 'C:\\Users\\ada\\AppData\\Roaming' }, 'win32', 'C:\\Users\\ada'),
    'C:\\Users\\ada\\AppData\\Roaming\\Null',
  );
});

test('Windows without %APPDATA% is an error, not a guess', () => {
  assert.throws(() => nullDataDir({}, 'win32', 'C:\\Users\\ada'), /APPDATA/);
});

test('Linux defaults to ~/.config/Null, with no APPDATA involved', () => {
  assert.equal(nullDataDir({}, 'linux', '/home/ada'), '/home/ada/.config/Null');
});

test('Linux honours XDG_CONFIG_HOME, and ignores an empty one', () => {
  assert.equal(nullDataDir({ XDG_CONFIG_HOME: '/data/cfg' }, 'linux', '/home/ada'), '/data/cfg/Null');
  assert.equal(nullDataDir({ XDG_CONFIG_HOME: '' }, 'linux', '/home/ada'), '/home/ada/.config/Null');
});
