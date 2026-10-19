'use strict';

import assert from 'node:assert';
import test from 'node:test';
import { WORKFLOW_SCHEME, logDocParts, parseLogDoc } from './workflowLogDocs';

test('a job and a step round-trip, and the label only decorates the tab title', () => {
  const job = logDocParts({ owner: 'o', repo: 'r', jobId: 5, step: null }, 'build / x 86');
  assert.strictEqual(job.scheme, WORKFLOW_SCHEME);
  assert.strictEqual(job.path, '/o/r/5/build-x-86.log');
  assert.strictEqual(job.query, '');
  assert.deepStrictEqual(parseLogDoc(job.path, job.query), { owner: 'o', repo: 'r', jobId: 5, step: null });
  const step = logDocParts({ owner: 'o', repo: 'r', jobId: 5, step: 3 }, 'build: Run tests');
  assert.strictEqual(step.query, 'step=3');
  assert.deepStrictEqual(parseLogDoc(step.path, step.query), { owner: 'o', repo: 'r', jobId: 5, step: 3 });
});

test('the label is sanitised and never empty', () => {
  assert.strictEqual(logDocParts({ owner: 'o', repo: 'r', jobId: 1, step: null }, '../../etc').path, '/o/r/1/etc.log');
  assert.strictEqual(logDocParts({ owner: 'o', repo: 'r', jobId: 1, step: null }, '///').path, '/o/r/1/job.log');
  assert.ok(logDocParts({ owner: 'o', repo: 'r', jobId: 1, step: null }, 'x'.repeat(500)).path.length < 100);
});

test('parseLogDoc rejects anything that is not exactly /owner/repo/jobId/label.log', () => {
  const bad: Array<[string, string]> = [
    ['/../../etc/passwd', ''],
    ['/o/r/5', ''],
    ['/o/r/5/x.log/extra', ''],
    ['/o/r/abc/x.log', ''],
    ['/o/r/-1/x.log', ''],
    ['/o/r/0/x.log', ''],
    ['/o/r/5.5/x.log', ''],
    ['/o/r/99999999999999999999/x.log', ''],
    ['/../r/5/x.log', ''],
    ['/./r/5/x.log', ''],
    ['/o/../5/x.log', ''],
    ['/o/r r/5/x.log', ''],
    ['/o%2Fx/r/5/x.log', ''],
    ['/o/r/5/x.txt', ''],
    ['/o/r/5/../x.log', ''],
    ['/o/r/5/x.log', 'step=abc'],
    ['/o/r/5/x.log', 'step=0'],
    ['/o/r/5/x.log', 'step=1&step=2'],
    ['/o/r/5/x.log', 'step=1&evil=1'],
    ['/o/r/5/x.log', 'evil=1'],
    ['', ''],
  ];
  for (const [p, q] of bad) assert.strictEqual(parseLogDoc(p, q), null, `${p}?${q}`);
});
