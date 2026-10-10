'use strict';

import { HttpJson } from './gistClient';

/** The only network call in this extension. */
export const fetchJson: HttpJson = async (method, url, headers, body) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'null-ide', ...headers },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { /* keep the raw text */ }
  return { status: res.status, body: parsed };
};
