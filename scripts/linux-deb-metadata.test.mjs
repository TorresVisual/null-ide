import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyToTree, patchAppdata, patchControl, patchPostinst, patchPostrm, patchTemplates } from './linux-deb-metadata.mjs';

const FORBIDDEN = /packages\.microsoft\.com|microsoft\.gpg|add-microsoft-repo/i;

const POSTINST = [
  '#!/usr/bin/env bash', '#', '# Copyright (c) Microsoft Corporation. All rights reserved.', '',
  'rm -f /usr/bin/@@NAME@@', 'ln -s /usr/share/@@NAME@@/bin/@@NAME@@ /usr/bin/@@NAME@@', '',
  'if [ "@@NAME@@" != "code-oss" ]; then',
  '\t# Register apt repository',
  '\tCODE_TRUSTED_PART=/usr/share/keyrings/microsoft.gpg',
  '\techo "URIs: https://packages.microsoft.com/repos/code"',
  'fi', '',
].join('\n');

const POSTRM = [
  '#!/bin/bash', '', 'rm -f /usr/bin/@@NAME@@', '',
  'RET=true', 'if [ -e /usr/share/debconf/confmodule ]; then', '\tdb_get @@NAME@@/add-microsoft-repo || true', 'fi', '',
].join('\n');

const CONTROL = [
  'Package: @@NAME@@', 'Version: @@VERSION@@', 'Depends: @@DEPENDS@@',
  'Maintainer: Microsoft Corporation <vscode-linux@microsoft.com>',
  'Homepage: https://code.visualstudio.com/',
  'Provides: visual-studio-@@NAME@@', 'Conflicts: visual-studio-@@NAME@@', 'Replaces: visual-studio-@@NAME@@',
  'Description: Code editing. Redefined.',
  ' Visual Studio Code is a new choice of tool.',
  ' instructions and FAQ.', '',
].join('\n');

const APPDATA = [
  '<component type="desktop">',
  '\t<name>@@NAME_LONG@@</name>',
  '\t<url type="homepage">https://code.visualstudio.com</url>',
  '\t<summary>Visual Studio Code. Code editing. Redefined.</summary>',
  '\t<description>',
  '\t\t<p>Visual Studio Code is a new choice of tool. See https://code.visualstudio.com/docs/setup/linux for installation instructions and FAQ.</p>',
  '\t</description>',
  '\t<screenshots>',
  '\t\t<screenshot type="default"><image>https://code.visualstudio.com/x.png</image></screenshot>',
  '\t</screenshots>',
  '</component>', '',
].join('\n');

test('postinst loses the Microsoft repository block but keeps the symlink and the license header', () => {
  const out = patchPostinst(POSTINST);
  assert.doesNotMatch(out, FORBIDDEN);
  assert.match(out, /ln -s \/usr\/share\/@@NAME@@\/bin\/@@NAME@@ \/usr\/bin\/@@NAME@@\n$/);
  assert.match(out, /Copyright \(c\) Microsoft Corporation/);
});

test('postrm loses the repository cleanup and debconf purge', () => {
  const out = patchPostrm(POSTRM);
  assert.doesNotMatch(out, FORBIDDEN);
  assert.doesNotMatch(out, /db_/);
  assert.match(out, /rm -f \/usr\/bin\/@@NAME@@\n$/);
});

test('the debconf template is emptied', () => {
  assert.equal(patchTemplates('Template: @@NAME@@/add-microsoft-repo\nType: boolean\n'), '');
});

test('control is renamed to null-ide, re-owned and loses the visual-studio aliases', () => {
  const out = patchControl(CONTROL);
  assert.match(out, /^Package: null-ide$/m);
  assert.match(out, /^Maintainer: Null IDE <TorresVisual@users\.noreply\.github\.com>$/m);
  assert.match(out, /^Homepage: https:\/\/github\.com\/TorresVisual\/null-ide$/m);
  assert.doesNotMatch(out, /visual-studio|Visual Studio|code\.visualstudio|Microsoft/);
  assert.match(out, /^Version: @@VERSION@@$/m);
  assert.match(out, /^Description: Null IDE/m);
  assert.ok(out.endsWith('\n'));
});

test('appdata is rebranded and drops the VS Code screenshot', () => {
  const out = patchAppdata(APPDATA);
  assert.doesNotMatch(out, /Visual Studio|code\.visualstudio|screenshot/);
  assert.match(out, /<url type="homepage">https:\/\/github\.com\/TorresVisual\/null-ide<\/url>/);
  assert.match(out, /<name>@@NAME_LONG@@<\/name>/);
});

test('CRLF checkouts keep their line endings', () => {
  const out = patchPostinst(POSTINST.replace(/\n/g, '\r\n'));
  assert.doesNotMatch(out, FORBIDDEN);
  assert.ok(out.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(out), 'every newline must stay CRLF');
});

test('upstream drift fails loudly instead of shipping the old behaviour', () => {
  assert.throws(() => patchPostinst('echo hi\n'), /postinst/);
  assert.throws(() => patchPostrm('echo hi\n'), /postrm/);
  assert.throws(() => patchTemplates('Template: other\n'), /templates/);
  assert.throws(() => patchControl('Package: other\n'), /control/);
  assert.throws(() => patchAppdata('<component/>\n'), /appdata/);
  assert.throws(() => patchPostinst('if [ "@@NAME@@" != "code-oss" ]; then\n\techo nothing\nfi\n'), /postinst/);
});

// vscode-src is inside the repo on a dev machine and a sibling of ide-overlay/ in CI.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realTemplates = [path.join(root, 'vscode-src'), path.join(root, '..', 'vscode-src')]
  .map(d => path.join(d, 'resources', 'linux'))
  .find(d => fs.existsSync(path.join(d, 'debian', 'postinst.template')));
test('the real VS Code templates, when present, rewrite cleanly', { skip: !realTemplates }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deb-meta-'));
  try {
    fs.cpSync(realTemplates, path.join(tmp, 'resources', 'linux'), { recursive: true });
    applyToTree(tmp);
    for (const f of ['postinst', 'postrm', 'templates', 'control'].map(n => path.join(tmp, 'resources', 'linux', 'debian', `${n}.template`))) {
      assert.doesNotMatch(fs.readFileSync(f, 'utf8'), FORBIDDEN, f);
    }
    assert.match(fs.readFileSync(path.join(tmp, 'resources', 'linux', 'debian', 'control.template'), 'utf8'), /^Package: null-ide\r?$/m);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
