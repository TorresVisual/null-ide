'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { buildReport } from '../buildReport';
import { reportToJson, reportToMarkdown } from '../exportReport';
import { Snapshot } from '../types';

const snap: Snapshot = {
  schemaVersion: 1, takenAt: 5000, appVersion: '1.2.3', initialStartup: true, metrics: {}, contributions: [],
  marks: [
    { source: 'main', name: 'code/didStartMain', startTime: 1000 },
    { source: 'renderer', name: 'code/didRestoreEditors', startTime: 2500 },
  ],
  extensions: [
    { id: 'p.slow', activationEvent: 'workspaceContains:C:\\Users\\me\\secret-project\\x', reason: 'p.slow', eager: true, startMs: 1100, endMs: 1500, loadMs: 100, callMs: 100, resolveMs: 100 },
    { id: 'p.quick', activationEvent: 'onLanguage:rust', reason: 'p.quick', eager: false, loadMs: 1, callMs: 1, resolveMs: 1 },
  ],
};
const report = buildReport(snap, { id: 'r', windowId: 'w' });

test('markdown names the headline, flags slow extensions and renders missing data as n/a', () => {
  const md = reportToMarkdown(report, 100);
  assert.match(md, /Startup \(workspace restored\): \*\*1\.50 s\*\*/);
  assert.match(md, /\| p\.slow \|.*slow/);
  assert.doesNotMatch(md, /\| p\.quick \|.*slow/);
  assert.match(md, /n\/a/);
});

test('no export format carries a path or workspace name', () => {
  for (const text of [reportToMarkdown(report, 100), reportToJson(report)]) {
    assert.doesNotMatch(text, /secret-project|Users|C:\\\\|C:\//);
  }
});

test('json round-trips to the same report', () => {
  assert.deepStrictEqual(JSON.parse(reportToJson(report)), JSON.parse(JSON.stringify(report)));
});

test('pipes in cells cannot break the table', () => {
  const r = { ...report, extensions: [{ ...report.extensions[0], id: 'a|b' }] };
  assert.match(reportToMarkdown(r, 100), /a\\\|b/);
});
