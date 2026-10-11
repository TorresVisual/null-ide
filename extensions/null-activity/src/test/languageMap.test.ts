'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { languageId } from '../languageMap';

test('maps WakaTime names whose slug would differ from the VS Code language id', () => {
  const want: Record<string, string> = {
    'C++': 'cpp',
    'C#': 'csharp',
    'F#': 'fsharp',
    Batchfile: 'bat',
    Bash: 'shellscript',
    Text: 'plaintext',
    'JSON with Comments': 'jsonc',
    'Vue.js': 'vue',
  };
  for (const [name, id] of Object.entries(want)) assert.strictEqual(languageId(name), id, name);
});

test('other names fall back to a lowercase slug', () => {
  assert.strictEqual(languageId('TypeScript'), 'typescript');
  assert.strictEqual(languageId('Markdown'), 'markdown');
  assert.strictEqual(languageId('C'), 'c');
  assert.strictEqual(languageId('Image (svg)'), 'image-svg');
  assert.strictEqual(languageId('Microsoft Visual Studio Solution'), 'microsoft-visual-studio-solution');
});

test('empty stays empty and object prototype names are not special', () => {
  assert.strictEqual(languageId(''), '');
  assert.strictEqual(languageId('constructor'), 'constructor');
});
