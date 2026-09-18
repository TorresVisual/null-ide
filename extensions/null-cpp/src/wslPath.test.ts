import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { toWslPath, fromWslPath } from './wslPath';

test('toWslPath converts a drive path to /mnt form, lowercasing the drive letter', () => {
  assert.equal(toWslPath('C:\\Users\\Foo\\bar.txt'), '/mnt/c/Users/Foo/bar.txt');
  assert.equal(toWslPath('D:/Projects/app'), '/mnt/d/Projects/app');
});

test('toWslPath handles a bare drive root', () => {
  assert.equal(toWslPath('C:\\'), '/mnt/c');
});

test('toWslPath leaves an already-POSIX path alone', () => {
  assert.equal(toWslPath('/home/user/project'), '/home/user/project');
});

test('fromWslPath converts /mnt/<drive> back to a Windows drive path', () => {
  assert.equal(fromWslPath('/mnt/c/Users/Foo', 'Ubuntu'), 'C:\\Users\\Foo');
  assert.equal(fromWslPath('/mnt/d/Projects/app', 'Ubuntu'), 'D:\\Projects\\app');
});

test('fromWslPath handles a bare /mnt/<drive> root', () => {
  assert.equal(fromWslPath('/mnt/c', 'Ubuntu'), 'C:\\');
});

test('fromWslPath addresses non-mount paths through the wsl.localhost UNC root', () => {
  assert.equal(fromWslPath('/home/user/project', 'Ubuntu-22.04'), '\\\\wsl.localhost\\Ubuntu-22.04\\home\\user\\project');
});

test('toWslPath and fromWslPath round-trip a /mnt path', () => {
  const windows = 'C:\\Users\\Foo\\bar.txt';
  assert.equal(fromWslPath(toWslPath(windows), 'Ubuntu'), windows);
});
