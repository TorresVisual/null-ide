import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as prettier from 'prettier';
import { computeMinimalEdits } from './diffUtils';

describe('prettier formatting integration', () => {
  it('formats javascript with default options', async () => {
    const unformatted = 'const   a=1; function   foo( x ){return x+a;}';
    const formatted = await prettier.format(unformatted, {
      parser: 'babel',
      semi: true,
      singleQuote: false,
      tabWidth: 2,
    });

    assert.strictEqual(
      formatted.trim(),
      'const a = 1;\nfunction foo(x) {\n  return x + a;\n}'
    );

    const edits = computeMinimalEdits(unformatted, formatted);
    assert.strictEqual(edits.length, 1);
  });

  it('formats json with default options', async () => {
    const unformatted = '{"a":1,"b":   [2,3]}';
    const formatted = await prettier.format(unformatted, {
      parser: 'json',
      tabWidth: 2,
    });

    assert.strictEqual(
      formatted.trim(),
      '{ "a": 1, "b": [2, 3] }'
    );
  });

  it('formats typescript with custom options', async () => {
    const unformatted = 'interface User{name:string;age?:number;}';
    const formatted = await prettier.format(unformatted, {
      parser: 'typescript',
      semi: true,
      singleQuote: true,
      tabWidth: 4,
    });

    assert.strictEqual(
      formatted.trim(),
      'interface User {\n    name: string;\n    age?: number;\n}'
    );
  });
});
