'use strict';

import { fmtMs, stamp } from './format';
import { Report } from './types';

const cell = (s: string) => s.replace(/\|/g, '\\|');

function table(head: string[], rows: string[][], numericFrom = 1): string[] {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map((_, i) => (i >= numericFrom ? '---:' : '---')).join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ];
}

/** The JSON export is the stored report itself: it is already sanitized when built. */
export function reportToJson(r: Report): string {
  return JSON.stringify(r, null, 2);
}

export function reportToMarkdown(r: Report, slowMs: number): string {
  const phases = r.phases.filter((p) => p.impactMs !== undefined).sort((a, b) => (b.impactMs ?? 0) - (a.impactMs ?? 0)).slice(0, 5);
  const exts = [...r.extensions].sort((a, b) => (b.totalMs ?? -1) - (a.totalMs ?? -1)).slice(0, 10);
  return [
    '# Null IDE startup report',
    '',
    `- Launch: ${stamp(r.takenAt)} · app ${r.appVersion || 'n/a'}${r.initialStartup ? '' : ' · additional window'}${r.partial ? ' · partial data' : ''}`,
    `- Startup (workspace restored): **${fmtMs(r.headlineMs)}**`,
    '',
    '## Milestones',
    '',
    ...table(['Milestone', 'Since launch'], r.milestones.map((m) => [m.label, fmtMs(m.atMs)])),
    '',
    '## Slowest phases (wall-clock impact)',
    '',
    ...table(['Phase', 'Process', 'Duration', 'Impact'], phases.map((p) => [p.label, p.process, fmtMs(p.durationMs), fmtMs(p.impactMs)]), 2),
    '',
    `## Slowest extension activations (flagged at ${slowMs} ms)`,
    '',
    ...table(
      ['Extension', 'Event', 'When', 'Total', 'Flag'],
      exts.map((e) => [e.id, e.activationEvent || 'n/a', e.deferred ? 'deferred' : 'startup', fmtMs(e.totalMs), e.totalMs !== undefined && e.totalMs >= slowMs ? 'slow' : '']),
      3,
    ),
    '',
  ].join('\n');
}
