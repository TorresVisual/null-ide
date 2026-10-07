'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Queue } from '../playback/queue';
import { track } from './fixtures';

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
const tracks = (n: number) => Array.from({ length: n }, (_, i) => track(i));
const names = (q: Queue) => q.tracks.map((t) => t.name);

test('next walks the list, stops at the end, wraps only for repeat=context', () => {
  const q = new Queue();
  q.replace(tracks(3), 0);
  assert.strictEqual(q.next()?.name, 't1');
  assert.strictEqual(q.next()?.name, 't2');
  assert.strictEqual(q.next(), undefined);
  assert.strictEqual(q.current?.name, 't2');
  q.repeat = 'context';
  assert.strictEqual(q.next()?.name, 't0');
});

test('shuffle never repeats a track back to back and covers everything first', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const q = new Queue(seeded(seed));
    q.replace(tracks(5), 0);
    q.setShuffle(true);
    q.repeat = 'context';
    const seq = [q.current!.name];
    for (let i = 0; i < 24; i++) seq.push(q.next()!.name);
    for (let i = 1; i < seq.length; i++) assert.notStrictEqual(seq[i], seq[i - 1], `seed ${seed}`);
    assert.strictEqual(new Set(seq.slice(0, 5)).size, 5, `seed ${seed}`);
  }
});

test('shuffle with repeat off ends after every track played once', () => {
  const q = new Queue(seeded(3));
  q.replace(tracks(4), 0);
  q.setShuffle(true);
  for (let i = 0; i < 3; i++) assert.ok(q.next());
  assert.strictEqual(q.next(), undefined);
});

test('single track + shuffle + repeat context replays the same track', () => {
  const q = new Queue();
  q.replace(tracks(1), 0);
  q.setShuffle(true);
  q.repeat = 'context';
  assert.strictEqual(q.next()?.name, 't0');
});

test('previous walks history regardless of shuffle, and forward returns to where you were', () => {
  const q = new Queue(seeded(7));
  q.replace(tracks(5), 0);
  q.setShuffle(true);
  const first = q.current!.name;
  const second = q.next()!.name;
  const third = q.next()!.name;
  assert.strictEqual(q.previous()?.name, second);
  assert.strictEqual(q.next()?.name, third);
  assert.strictEqual(q.previous()?.name, second);
  assert.strictEqual(q.previous()?.name, first);
  assert.strictEqual(q.previous(), undefined);
});

test('previous without history steps back in list order (non-shuffle)', () => {
  const q = new Queue();
  q.replace(tracks(3), 2);
  assert.strictEqual(q.previous()?.name, 't1');
  assert.strictEqual(q.previous()?.name, 't0');
  assert.strictEqual(q.previous(), undefined);
});

test('playNext inserts after current; add appends; both play in shuffle too', () => {
  const q = new Queue();
  q.replace(tracks(3), 0);
  q.playNext(track(9));
  q.add(track(8));
  assert.deepStrictEqual(names(q), ['t0', 't9', 't1', 't2', 't8']);
  assert.strictEqual(q.next()?.name, 't9');

  const s = new Queue(seeded(2));
  s.replace(tracks(4), 0);
  s.setShuffle(true);
  s.playNext(track(9));
  assert.strictEqual(s.next()?.name, 't9');
  s.add(track(8));
  const seen = new Set<string>();
  for (let i = 0; i < 4; i++) seen.add(s.next()!.name);
  assert.ok(seen.has('t8'));
});

test('add and playNext on an empty queue make the new track current', () => {
  const q = new Queue();
  q.add(track(1));
  assert.strictEqual(q.current?.name, 't1');
  const p = new Queue();
  p.playNext(track(2));
  assert.strictEqual(p.current?.name, 't2');
});

test('remove and move keep the current item current', () => {
  const q = new Queue();
  q.replace(tracks(4), 2);
  q.remove(0);
  assert.strictEqual(q.current?.name, 't2');
  assert.strictEqual(q.index, 1);
  q.move(0, 2);
  assert.deepStrictEqual(names(q), ['t2', 't3', 't1']);
  assert.strictEqual(q.current?.name, 't2');
  assert.strictEqual(q.index, 0);
  q.remove(q.index);
  assert.strictEqual(q.current?.name, 't3');
  q.clear();
  assert.strictEqual(q.current, undefined);
  assert.strictEqual(q.index, -1);
});
