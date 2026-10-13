'use strict';

import { HttpJson, HttpText } from './gistStore';

const TIMEOUT_MS = 15_000;

/** The only network calls in this extension: GitHub's Gist API and the raw host for truncated files. */
export const fetchJson: HttpJson = async (method, url, headers, body) => {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'null-ide', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    /* keep the raw text */
  }
  return { status: res.status, body: parsed };
};

export const fetchText: HttpText = async (url, headers) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'null-ide', ...headers },
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, body: await res.text() };
};
