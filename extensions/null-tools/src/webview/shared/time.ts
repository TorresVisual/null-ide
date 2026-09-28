'use strict';

const TIME_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** github.com-style relative time: "just now", "5 minutes ago", "yesterday", "12 days ago", "on Sep 3[, 2024]". */
function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso);
  const seconds = Math.floor((now - then.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const date = `${TIME_MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === new Date(now).getFullYear() ? `on ${date}` : `on ${date}, ${then.getFullYear()}`;
}

/** Relative time with the exact local timestamp on hover, like github.com's <relative-time>. */
function timeHtml(iso: string): string {
  return `<time datetime="${iso}" title="${new Date(iso).toLocaleString()}">${relativeTime(iso)}</time>`;
}
