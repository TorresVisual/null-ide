'use strict';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "6h 42m", "35m", "<1m" for under a minute, "0m" for nothing. */
function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '<1m';
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/** A row that rounds to 0% but has time reads "<1%", not a misleading "0%". */
function formatPercent(percent: number, ms: number): string {
  return percent === 0 && ms > 0 ? '<1%' : `${percent}%`;
}

/** Size per value with the largest = maxPx; zero (or all-zero) values get stubPx so every bucket stays visible. */
function barScale(values: number[], maxPx: number, stubPx: number): number[] {
  let max = 0;
  for (const v of values) if (v > max) max = v;
  return values.map((v) => (v <= 0 || max <= 0 ? stubPx : Math.max(stubPx, Math.round((v / max) * maxPx))));
}

/** Indexes to label under a graph: at most `max`, evenly spaced, always starting at 0. */
function axisTicks(count: number, max: number): number[] {
  const step = Math.max(1, Math.ceil(count / max));
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  return out;
}

/** Tooltip text and accessible name of a graph bar. */
function barLabel(bar: DashboardBar): string {
  return `${bar.label} · ${formatDuration(bar.ms)}`;
}

/** "Thu 8 Oct, 14:05" in the viewer's local time. */
function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Hover text for a session row: one file per line, the first `max` only. */
function filesTitle(files: string[], max: number): string {
  if (files.length === 0) return 'No files';
  return files.length > max ? [...files.slice(0, max), `+${files.length - max} more`].join('\n') : files.join('\n');
}

/** Arrow-key navigation for a tab list; `undefined` for keys that do not move. */
function nextIndex(index: number, count: number, key: string): number | undefined {
  switch (key) {
    case 'ArrowRight':
      return (index + 1) % count;
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return undefined;
  }
}
