'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { renderBadge } from '../badgeSvg';

const widthOf = (svg: string) => Number(/<svg[^>]* width="(\d+)"/.exec(svg)?.[1]);

test('renders a two-segment flat badge sized from the text', () => {
  const svg = renderBadge('coding time', '1h', '#007ec6');
  assert.ok(svg.startsWith('<svg '));
  assert.ok(svg.endsWith('</svg>'));
  // 11 chars -> round(72.6) + 10 = 83; 2 chars -> round(13.2) + 10 = 23
  assert.strictEqual(widthOf(svg), 106);
  assert.strictEqual(svg.match(/<text /g)?.length, 2);
  assert.ok(svg.includes('>coding time</text>'));
  assert.ok(svg.includes('>1h</text>'));
  assert.ok(svg.includes('fill="#007ec6"'));
});

test('a longer value makes a wider badge', () => {
  assert.ok(widthOf(renderBadge('top language', 'typescript', '#000')) > widthOf(renderBadge('top language', 'c', '#000')));
});

test('text is XML-escaped so a value can never inject markup', () => {
  const svg = renderBadge('a&b', '<script>"x"</script>', '#000');
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('a&amp;b'));
  assert.ok(svg.includes('&lt;script&gt;&quot;x&quot;&lt;/script&gt;'));
});
