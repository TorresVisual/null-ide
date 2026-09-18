import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { findEnclosingSymbol, findSymbolByQualifiedName, SymbolNode } from './symbolTree';

function tree(): SymbolNode[] {
  return [
    {
      name: 'Foo',
      range: { start: { line: 0, character: 0 }, end: { line: 10, character: 1 } },
      children: [
        {
          name: 'Bar',
          range: { start: { line: 1, character: 0 }, end: { line: 9, character: 1 } },
          children: [
            {
              name: 'baz',
              range: { start: { line: 3, character: 2 }, end: { line: 6, character: 3 } },
              children: [],
            },
          ],
        },
      ],
    },
  ];
}

test('findEnclosingSymbol returns the innermost symbol containing the position', () => {
  const result = findEnclosingSymbol(tree(), { line: 4, character: 5 });
  assert.equal(result?.qualifiedName, 'Foo::Bar::baz');
});

test('findEnclosingSymbol falls back to an outer symbol when no child contains the position', () => {
  const result = findEnclosingSymbol(tree(), { line: 0, character: 5 });
  assert.equal(result?.qualifiedName, 'Foo');
});

test('findEnclosingSymbol returns undefined when nothing contains the position', () => {
  const result = findEnclosingSymbol(tree(), { line: 20, character: 0 });
  assert.equal(result, undefined);
});

test('findEnclosingSymbol treats range boundaries as inclusive', () => {
  const atStart = findEnclosingSymbol(tree(), { line: 3, character: 2 });
  const atEnd = findEnclosingSymbol(tree(), { line: 6, character: 3 });
  assert.equal(atStart?.qualifiedName, 'Foo::Bar::baz');
  assert.equal(atEnd?.qualifiedName, 'Foo::Bar::baz');
});

test('findSymbolByQualifiedName finds a nested symbol', () => {
  const match = findSymbolByQualifiedName(tree(), 'Foo::Bar::baz');
  assert.equal(match?.name, 'baz');
});

test('findSymbolByQualifiedName finds a top-level symbol', () => {
  const match = findSymbolByQualifiedName(tree(), 'Foo');
  assert.equal(match?.name, 'Foo');
});

test('findSymbolByQualifiedName returns undefined for an unknown name', () => {
  assert.equal(findSymbolByQualifiedName(tree(), 'Foo::Bar::nope'), undefined);
});
