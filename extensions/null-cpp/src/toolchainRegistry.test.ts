import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseVswhereInstallPaths, pickLatestMsvcVersion, parseClangVersion, parseWslDistroList } from './toolchainRegistry';

test('parseVswhereInstallPaths splits one path per line and drops blanks', () => {
  const stdout = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\r\n\r\n';
  assert.deepEqual(parseVswhereInstallPaths(stdout), [
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
  ]);
});

test('parseVswhereInstallPaths handles multiple installs', () => {
  const stdout = 'C:\\VS\\2022\\Community\nC:\\VS\\2022\\BuildTools\n';
  assert.deepEqual(parseVswhereInstallPaths(stdout), ['C:\\VS\\2022\\Community', 'C:\\VS\\2022\\BuildTools']);
});

test('pickLatestMsvcVersion picks the numerically highest version', () => {
  assert.equal(pickLatestMsvcVersion(['14.38.33130', '14.9.0', '14.38.9']), '14.38.33130');
});

test('pickLatestMsvcVersion ignores non-numeric directory names', () => {
  assert.equal(pickLatestMsvcVersion(['14.38.33130', 'not-a-version']), '14.38.33130');
});

test('pickLatestMsvcVersion returns undefined for an empty or all-invalid list', () => {
  assert.equal(pickLatestMsvcVersion([]), undefined);
  assert.equal(pickLatestMsvcVersion(['abc', 'def']), undefined);
});

test('parseClangVersion extracts the version from clang --version output', () => {
  const output = 'clang version 17.0.3\nTarget: x86_64-pc-windows-msvc\n';
  assert.equal(parseClangVersion(output), '17.0.3');
});

test('parseClangVersion returns undefined for unrelated output', () => {
  assert.equal(parseClangVersion('gcc (GCC) 13.2.0'), undefined);
});

test('parseWslDistroList strips stray null bytes and blank lines', () => {
  const raw = 'Ubuntu \r\n \r\ndebian \r\n \r\n';
  assert.deepEqual(parseWslDistroList(raw), ['Ubuntu', 'debian']);
});

test('parseWslDistroList drops the non-quiet header line if one is present', () => {
  const raw = 'Windows Subsystem for Linux Distributions:\r\nUbuntu-22.04\r\n';
  assert.deepEqual(parseWslDistroList(raw), ['Ubuntu-22.04']);
});
