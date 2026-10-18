#!/usr/bin/env node
// Release notes for a tag: highlights from docs/specs + docs/plans added since the previous `v*` tag,
// then every non-merge commit in the range grouped by Conventional Commit type.
// Usage: node scripts/release-notes.mjs [--to <ref>] [--from <ref>] [--out <file>]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = process.env.GITHUB_REPOSITORY || 'TorresVisual/null-ide';
const DOC_DIRS = ['docs/specs/', 'docs/plans/'];
// Runbooks, test records, root-cause notes and one-off checks document work; they are not features.
const NOT_FEATURE = /(runbook|test-record|check|root-cause)\.md$/;
const TYPE_LABEL = {
  feat: 'Features', fix: 'Fixes', perf: 'Performance', refactor: 'Refactoring',
  build: 'Build & CI', ci: 'Build & CI', docs: 'Docs', test: 'Tests', chore: 'Chores',
};
const LABEL_ORDER = [...new Set([...Object.values(TYPE_LABEL), 'Other'])];

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

export function previousTag(to) {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v*', `${to}^`);
  } catch {
    return null; // first release: no baseline
  }
}

const range = (from, to) => (from ? `${from}..${to}` : to);

// Docs added in the range. The first release has no baseline, so every doc at `to` counts.
export function docPaths(from, to) {
  const args = from
    ? ['diff', '--diff-filter=A', '--name-only', from, to, '--', ...DOC_DIRS]
    : ['ls-tree', '-r', '--name-only', to, '--', ...DOC_DIRS];
  return git(...args).split('\n').filter((p) =>
    p.endsWith('.md') && p.split('/').length === 3 && !NOT_FEATURE.test(p));
}

// Docs of one feature share a key: `x-design.md`, `x.md`, `x-phase2-foo.md` all map to `x`.
export function featureKey(path) {
  const stem = path.split('/').pop().replace(/\.md$/, '');
  return stem.replace(/-design$/, '').replace(/-phase\d+.*$/, '');
}

function firstParagraph(lines, start) {
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^(#|>|[-*|]|\d+\.)/.test(line)) {
      if (out.length) break;
      continue;
    }
    out.push(line);
  }
  return out.join(' ');
}

// Title from the H1 without the document-type suffix; summary from "## Goal", else (fallback) the first paragraph.
export function summarizeDoc(md, { fallback = true } = {}) {
  const lines = md.split('\n');
  const h1 = lines.findIndex((l) => /^# /.test(l));
  const title = h1 < 0 ? '' : lines[h1].slice(2)
    .replace(/\s*\(#\d+\)\s*$/, '')
    .replace(/\s*[—–-]?\s*(Design|Implementation Plan|Plan)$/i, '')
    .replace(/\s*[—–:-]\s*$/, '')
    .trim();
  const goal = lines.findIndex((l) => /^## Goal\s*$/.test(l));
  if (goal < 0 && !fallback) return { title, summary: '' };
  let summary = firstParagraph(lines, goal < 0 ? h1 + 1 : goal + 1);
  if (summary.length > 300) summary = `${summary.slice(0, 297).replace(/\s+\S*$/, '')}...`;
  return { title, summary };
}

// Groups doc contents `{ path, md }` into one highlight per feature; the design doc wins the title.
export function groupDocs(docs) {
  const groups = new Map();
  for (const doc of docs) {
    const key = featureKey(doc.path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc);
  }
  return [...groups.values()].map((list) => {
    list.sort((a, b) => Number(b.path.endsWith('-design.md')) - Number(a.path.endsWith('-design.md')) || a.path.localeCompare(b.path));
    const { title } = summarizeDoc(list[0].md);
    // Plans without a Goal section open with instructions, not a summary, so only specs fall back to the first paragraph.
    const withSummary = list.map((d) => summarizeDoc(d.md, { fallback: d.path.startsWith('docs/specs/') })).find((s) => s.summary);
    return { title, summary: withSummary?.summary ?? '', paths: list.map((d) => d.path) };
  }).sort((a, b) => a.title.localeCompare(b.title));
}

export function parseCommits(log) {
  return log.split('\n').filter(Boolean).map((line) => {
    const [hash, subject] = line.split('\x1f');
    return { hash, subject };
  });
}

export function groupCommits(commits) {
  const groups = new Map(LABEL_ORDER.map((label) => [label, []]));
  for (const commit of commits) {
    const match = /^(\w+)(\([^)]*\))?!?:\s*(.+)$/.exec(commit.subject);
    groups.get(TYPE_LABEL[match?.[1]] ?? 'Other').push(commit);
  }
  return groups;
}

// Squash-merge subjects end in "(#123)"; link that number to its PR.
const subjectLine = (subject, repo) =>
  subject.replace(/\(#(\d+)\)\s*$/, (_, n) => `([#${n}](https://github.com/${repo}/pull/${n}))`);

export function renderNotes({ from, to, repo, highlights, commits }) {
  const out = [];
  if (highlights.length) {
    out.push('## Highlights', '');
    for (const h of highlights) {
      out.push(`### ${h.title}`, '');
      if (h.summary) out.push(h.summary, '');
      const links = h.paths.map((p) => `[${p.split('/').pop()}](https://github.com/${repo}/blob/${to}/${p})`);
      out.push(`Docs: ${links.join(' · ')}`, '');
    }
  }
  out.push('## Changes', '');
  if (!commits.length) out.push('No commits in this range.', '');
  for (const [label, list] of groupCommits(commits)) {
    if (!list.length) continue;
    out.push(`### ${label}`);
    for (const c of list) {
      out.push(`- ${subjectLine(c.subject, repo)} ([${c.hash}](https://github.com/${repo}/commit/${c.hash}))`);
    }
    out.push('');
  }
  if (from) out.push(`**Full changelog:** https://github.com/${repo}/compare/${from}...${to}`, '');
  return out.join('\n');
}

function parseArgs(argv) {
  const opts = { to: 'HEAD' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!['to', 'from', 'out'].includes(key)) throw new Error(`unknown option ${argv[i]}`);
    opts[key] = argv[i + 1];
  }
  return opts;
}

function main(argv) {
  const { to, out, ...rest } = parseArgs(argv);
  const from = 'from' in rest ? rest.from : previousTag(to);
  const docs = docPaths(from, to).map((path) => ({
    path,
    md: git('show', `${to}:${path}`),
  }));
  const commits = parseCommits(git('log', '--no-merges', '--format=%h%x1f%s', range(from, to)));
  const md = renderNotes({ from, to, repo: REPO, highlights: groupDocs(docs), commits });
  if (out) writeFileSync(out, md);
  else process.stdout.write(md);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
