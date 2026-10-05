'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { IssueTemplate } from './types';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseIssueTemplate(raw: string, fallbackName: string): IssueTemplate {
  const match = raw.match(FRONTMATTER);
  if (!match) return { name: fallbackName, about: '', title: '', body: raw.trim(), labels: [] };
  const [, frontmatter, body] = match;
  const fields: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return {
    name: fields.name || fallbackName,
    about: fields.about || '',
    title: fields.title || '',
    body: body.trim(),
    labels: fields.labels ? fields.labels.split(',').map(l => l.trim()).filter(Boolean) : [],
  };
}

export function loadIssueTemplates(cwd: string): IssueTemplate[] {
  const dir = path.join(cwd, '.github', 'ISSUE_TEMPLATE');
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }
  return files.map(file =>
    parseIssueTemplate(fs.readFileSync(path.join(dir, file), 'utf8'), file.replace(/\.md$/, '')));
}
