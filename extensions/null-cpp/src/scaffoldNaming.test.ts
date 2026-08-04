import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  validateClassName,
  headerFileName,
  sourceFileName,
  headerContent,
  sourceContent,
} from './scaffoldNaming';

test('validateClassName rejects an empty name', () => {
  assert.equal(validateClassName(''), 'Class name cannot be empty.');
  assert.equal(validateClassName('   '), 'Class name cannot be empty.');
});

test('validateClassName rejects a name starting with a digit', () => {
  assert.match(
    validateClassName('123Foo') ?? '',
    /must start with a letter or underscore/
  );
});

test('validateClassName rejects a name with invalid characters', () => {
  assert.match(
    validateClassName('My Class') ?? '',
    /must start with a letter or underscore/
  );
});

test('validateClassName accepts a valid identifier', () => {
  assert.equal(validateClassName('My_Class1'), undefined);
  assert.equal(validateClassName('_private'), undefined);
});

test('headerFileName and sourceFileName append the right extensions', () => {
  assert.equal(headerFileName('Widget'), 'Widget.hpp');
  assert.equal(sourceFileName('Widget'), 'Widget.cpp');
});

test('headerContent is just pragma once', () => {
  assert.equal(headerContent(), '#pragma once\n\n');
});

test('sourceContent includes the matching header include', () => {
  assert.equal(sourceContent('Widget'), '#include "Widget.hpp"\n\n');
});
