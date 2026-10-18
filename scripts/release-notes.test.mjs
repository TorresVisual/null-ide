import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureKey, summarizeDoc, groupDocs, parseCommits, groupCommits, renderNotes } from './release-notes.mjs';

test('featureKey folds design, plan and phase docs into one feature', () => {
  assert.equal(featureKey('docs/specs/null-accounts-design.md'), 'null-accounts');
  assert.equal(featureKey('docs/plans/null-accounts-phase2-github-binding.md'), 'null-accounts');
  assert.equal(featureKey('docs/plans/native-updater-fix.md'), 'native-updater-fix');
});

test('summarizeDoc takes the Goal paragraph and strips the doc-type suffix', () => {
  const md = '# Safe Mode Design (#18)\n\n> note\n\n## Goal\n\nLaunch with extensions disabled.\n\n## Scope\n\nmore';
  assert.deepEqual(summarizeDoc(md), { title: 'Safe Mode', summary: 'Launch with extensions disabled.' });
  assert.equal(summarizeDoc('# Safe Mode Implementation Plan (#18)\n\n> x\n\nFirst para.\n').summary, 'First para.');
});

test('groupDocs prefers the design doc for title and summary', () => {
  const groups = groupDocs([
    { path: 'docs/plans/x-phase1-a.md', md: '# X Phase 1 Implementation Plan\n\nPlan text.\n' },
    { path: 'docs/specs/x-design.md', md: '# X Design\n\n## Goal\n\nThe goal.\n' },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, 'X');
  assert.equal(groups[0].summary, 'The goal.');
  assert.deepEqual(groups[0].paths, ['docs/specs/x-design.md', 'docs/plans/x-phase1-a.md']);
});

test('commits group by Conventional Commit type, unknown subjects go to Other', () => {
  const groups = groupCommits(parseCommits('abc1234\x1ffeat(tools): add thing (#5)\ndef5678\x1fWIP stuff\n'));
  assert.equal(groups.get('Features').length, 1);
  assert.equal(groups.get('Other')[0].hash, 'def5678');
});

test('renderNotes links PR numbers and omits empty sections', () => {
  const md = renderNotes({
    from: 'v1.0.19', to: 'v1.0.20', repo: 'o/r', highlights: [],
    commits: [{ hash: 'abc1234', subject: 'fix: thing (#9)' }],
  });
  assert.match(md, /- fix: thing \(\[#9\]\(https:\/\/github\.com\/o\/r\/pull\/9\)\) \(\[abc1234\]/);
  assert.doesNotMatch(md, /## Highlights/);
  assert.match(md, /compare\/v1\.0\.19\.\.\.v1\.0\.20/);
});
