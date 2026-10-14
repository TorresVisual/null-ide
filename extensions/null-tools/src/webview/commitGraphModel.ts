'use strict';

// Pure helpers for the Commit Graph webview. Top-level function declarations only (no imports, no top-level
// const) so node --test can load this file through vm and the webview bundle can call them directly.

const GRAPH_PALETTE = [
  'var(--vscode-charts-red)', 'var(--vscode-charts-orange)', 'var(--vscode-charts-yellow)',
  'var(--vscode-charts-green)', 'var(--vscode-charts-blue)', 'var(--vscode-charts-purple)',
];

function graphRowHeight(): number { return 24; }
function graphLaneCap(): number { return 10; }

/** The column a lane is drawn in: lanes past the cap share the last column. */
function graphLaneColumn(lane: number): number {
  return Math.min(lane, graphLaneCap() - 1);
}

function graphHiddenLanes(laneCount: number): number {
  return Math.max(0, laneCount - graphLaneCap());
}

function graphLaneColorVar(color: number): string {
  return GRAPH_PALETTE[color % GRAPH_PALETTE.length];
}

/** Rows to render: the visible ones plus 20 on each side. */
function graphVisibleRange(scrollTop: number, viewportHeight: number, rowCount: number): { start: number; end: number } {
  const h = graphRowHeight();
  const start = Math.max(0, Math.floor(scrollTop / h) - 20);
  const end = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / h) + 20);
  return { start, end: Math.max(start, end) };
}

/** The selected index after a navigation key; -1 means nothing selected; unknown keys leave it unchanged. */
function graphMoveSelection(index: number, key: string, pageRows: number, count: number): number {
  if (count === 0) return -1;
  let next = index;
  if (key === 'ArrowDown') next = index + 1;
  else if (key === 'ArrowUp') next = index - 1;
  else if (key === 'PageDown') next = index + pageRows;
  else if (key === 'PageUp') next = index - pageRows;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = count - 1;
  else return index;
  return Math.max(0, Math.min(count - 1, next));
}

/** The scrollTop that brings row `index` fully into view with the least movement. */
function graphScrollToReveal(scrollTop: number, viewportHeight: number, index: number): number {
  const h = graphRowHeight();
  const top = index * h;
  const bottom = top + h;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return bottom - viewportHeight;
  return scrollTop;
}

/** After a reload from the top: the scrollTop that puts the anchor commit at the same offset, or null if it is gone. */
function graphAnchorAfterReset(anchorSha: string | null, offset: number, rows: Array<{ sha: string }>): number | null {
  if (anchorSha === null) return null;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sha === anchorSha) return i * graphRowHeight() + offset;
  }
  return null;
}

/** True when the viewport is within ten rows of the end of the loaded rows and more exist. */
function graphNeedsMore(scrollTop: number, viewportHeight: number, rowCount: number, hasMore: boolean): boolean {
  if (!hasMore) return false;
  const h = graphRowHeight();
  return scrollTop + viewportHeight >= rowCount * h - 10 * h;
}
