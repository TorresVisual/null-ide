'use strict';

export interface Span {
  start: number;
  end: number;
}

/** Adds `s` to a sorted, disjoint list, merging whatever it touches. */
function add(covered: Span[], s: Span): Span[] {
  const next: Span[] = [];
  let cur = { ...s };
  for (const c of covered) {
    if (c.end < cur.start || c.start > cur.end) next.push(c);
    else cur = { start: Math.min(c.start, cur.start), end: Math.max(c.end, cur.end) };
  }
  next.push(cur);
  return next.sort((a, b) => a.start - b.start);
}

const valid = (s: Span) => s.end > s.start;

/** Length of the union of the spans: wall-clock time with overlap counted once. */
export function unionMs(spans: Span[]): number {
  let covered: Span[] = [];
  for (const s of spans) if (valid(s)) covered = add(covered, s);
  return covered.reduce((sum, c) => sum + (c.end - c.start), 0);
}

/**
 * For each span, the time it adds that no earlier-starting span already covers. The values sum to
 * `unionMs`, so overlapping work is never counted twice. Result order matches the input order.
 */
export function incrementalImpact(spans: Span[]): number[] {
  const out = new Array<number>(spans.length).fill(0);
  const order = spans.map((_, i) => i).sort((a, b) => spans[a].start - spans[b].start || spans[a].end - spans[b].end);
  let covered: Span[] = [];
  for (const i of order) {
    const s = spans[i];
    if (!valid(s)) continue;
    const overlap = covered.reduce((sum, c) => sum + Math.max(0, Math.min(s.end, c.end) - Math.max(s.start, c.start)), 0);
    out[i] = s.end - s.start - overlap;
    covered = add(covered, s);
  }
  return out;
}

/** Greedy lane packing for the timeline: first lane whose last span ended by this span's start. */
export function assignLanes(spans: (Span | undefined)[]): number[] {
  const lanes = new Array<number>(spans.length).fill(0);
  const laneEnds: number[] = [];
  const order = spans.map((_, i) => i).filter((i) => spans[i] !== undefined).sort((a, b) => spans[a]!.start - spans[b]!.start);
  for (const i of order) {
    const s = spans[i]!;
    let lane = laneEnds.findIndex((end) => end <= s.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.end);
    } else {
      laneEnds[lane] = s.end;
    }
    lanes[i] = lane;
  }
  return lanes;
}
