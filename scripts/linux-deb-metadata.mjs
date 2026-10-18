#!/usr/bin/env node
// Rewrites VS Code's Debian packaging templates for Null IDE (#119).
// The stock postinst registers Microsoft's apt repository and signing key for any app name but
// "code-oss"; VSCodium neutralises that in prepare_vscode.sh, which Null's pipelines never run.
// Every rewrite throws when its anchor is missing, so upstream template drift fails the build.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAINTAINER = 'Null IDE <TorresVisual@users.noreply.github.com>';
const HOMEPAGE = 'https://github.com/TorresVisual/null-ide';
const DESCRIPTION = `Description: Null IDE, a telemetry-free code editor based on VSCodium
 Null IDE is a code editor built on VSCodium, the telemetry-free build of
 VS Code. Documentation and release notes are at ${HOMEPAGE}.
`;

/** Runs `fn` on LF text and restores the original line endings. */
function keepEol(text, fn) {
  const crlf = text.includes('\r\n');
  const out = fn(text.replace(/\r\n/g, '\n'));
  return crlf ? out.replace(/\n/g, '\r\n') : out;
}

function swap(text, pattern, replacement, file) {
  const found = typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
  if (!found) throw new Error(`${file}: ${pattern} not found; the template changed upstream`);
  return text.replace(pattern, () => replacement);
}

/** Drops everything from the first line starting with `startLine`, after checking it is the block we mean to remove. */
function cutFrom(text, startLine, mustContain, file) {
  const lines = text.split('\n');
  const i = lines.findIndex(l => l.startsWith(startLine));
  if (i < 0) throw new Error(`${file}: no line starting with ${JSON.stringify(startLine)}; the template changed upstream`);
  if (!lines.slice(i).join('\n').includes(mustContain)) {
    throw new Error(`${file}: the block from ${JSON.stringify(startLine)} no longer mentions ${mustContain}; the template changed upstream`);
  }
  return lines.slice(0, i).join('\n').replace(/\n+$/, '') + '\n';
}

export const patchPostinst = text => keepEol(text, s =>
  cutFrom(s, 'if [ "@@NAME@@" != "code-oss" ]', 'packages.microsoft.com', 'postinst.template'));

export const patchPostrm = text => keepEol(text, s =>
  cutFrom(s, 'RET=true', 'add-microsoft-repo', 'postrm.template'));

export function patchTemplates(text) {
  if (!text.includes('add-microsoft-repo')) throw new Error('templates.template: no add-microsoft-repo question; the template changed upstream');
  return '';
}

export function patchControl(text) {
  return keepEol(text, s => {
    const f = 'control.template';
    s = swap(s, 'Package: @@NAME@@\n', 'Package: null-ide\n', f);
    s = swap(s, /^Maintainer: .*$/m, `Maintainer: ${MAINTAINER}`, f);
    s = swap(s, /^Homepage: .*$/m, `Homepage: ${HOMEPAGE}`, f);
    s = swap(s, /^Provides: visual-studio-@@NAME@@\nConflicts: visual-studio-@@NAME@@\nReplaces: visual-studio-@@NAME@@\n/m, '', f);
    const at = s.search(/^Description:/m);
    if (at < 0) throw new Error(`${f}: no Description field; the template changed upstream`);
    if (!s.slice(at).split('\n').slice(1).every(l => l === '' || l.startsWith(' '))) {
      throw new Error(`${f}: Description is no longer the last field; the template changed upstream`);
    }
    return s.slice(0, at) + DESCRIPTION;
  });
}

export function patchAppdata(text) {
  return keepEol(text, s => {
    const f = 'code.appdata.xml';
    s = swap(s, '<url type="homepage">https://code.visualstudio.com</url>', `<url type="homepage">${HOMEPAGE}</url>`, f);
    s = swap(s, '<summary>Visual Studio Code. Code editing. Redefined.</summary>', '<summary>Null IDE. A code editor built on VSCodium.</summary>', f);
    s = swap(s, /<p>Visual Studio Code is[^\n]*<\/p>/, `<p>Null IDE is a code editor built on VSCodium, the telemetry-free build of VS Code. See ${HOMEPAGE} for installation instructions and release notes.</p>`, f);
    return swap(s, /\n\t<screenshots>[\s\S]*?<\/screenshots>/, '', f);
  });
}

export function applyToTree(vscodeSrc) {
  const linux = path.join(vscodeSrc, 'resources', 'linux');
  const edits = [
    ['debian/postinst.template', patchPostinst],
    ['debian/postrm.template', patchPostrm],
    ['debian/templates.template', patchTemplates],
    ['debian/control.template', patchControl],
    ['code.appdata.xml', patchAppdata],
  ];
  for (const [rel, fn] of edits) {
    const file = path.join(linux, rel);
    fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf8')));
    console.log(`rewrote ${rel}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error('usage: linux-deb-metadata.mjs <vscode-src>'); process.exit(2); }
  applyToTree(process.argv[2]);
}
