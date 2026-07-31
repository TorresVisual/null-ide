'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import {
  formatProjectBadgeText,
  formatProjectTooltip,
  ProjectState,
} from './projectInfo';

test('formatProjectBadgeText returns No Project when projectName is missing', () => {
  const result = formatProjectBadgeText({});
  assert.strictEqual(result, '$(folder) No Project');
});

test('formatProjectBadgeText formats clean project without branch', () => {
  const state: ProjectState = {
    projectName: 'null-ide',
    projectPath: '/path/to/null-ide',
  };
  const result = formatProjectBadgeText(state);
  assert.strictEqual(result, '$(folder) null-ide');
});

test('formatProjectBadgeText formats project with branch and no dirty files', () => {
  const state: ProjectState = {
    projectName: 'null-ide',
    projectPath: '/path/to/null-ide',
    branchName: 'main',
    dirtyCount: 0,
  };
  const result = formatProjectBadgeText(state);
  assert.strictEqual(result, '$(folder) null-ide (main)');
});

test('formatProjectBadgeText formats project with branch and dirty files', () => {
  const state: ProjectState = {
    projectName: 'null-ide',
    projectPath: '/path/to/null-ide',
    branchName: 'feature/ui',
    dirtyCount: 3,
  };
  const result = formatProjectBadgeText(state);
  assert.strictEqual(result, '$(folder) null-ide (feature/ui*)');
});

test('formatProjectBadgeText formats project without branch but with dirty files', () => {
  const state: ProjectState = {
    projectName: 'null-ide',
    projectPath: '/path/to/null-ide',
    dirtyCount: 2,
  };
  const result = formatProjectBadgeText(state);
  assert.strictEqual(result, '$(folder) null-ide*');
});

test('formatProjectTooltip returns fallback message when empty', () => {
  const result = formatProjectTooltip({});
  assert.strictEqual(result, 'Null IDE: No workspace folder open');
});

test('formatProjectTooltip formats full project information', () => {
  const state: ProjectState = {
    projectName: 'null-ide',
    projectPath: 'D:\\Coding\\null-ide',
    branchName: 'main',
    dirtyCount: 5,
  };
  const result = formatProjectTooltip(state);
  assert.ok(result.includes('Project: null-ide'));
  assert.ok(result.includes('Path: D:\\Coding\\null-ide'));
  assert.ok(result.includes('Git Branch: main'));
  assert.ok(result.includes('Modified Files: 5'));
});
