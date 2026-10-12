'use strict';

import * as path from 'path';
import { Report, SCHEMA_VERSION } from './types';

export interface StoreFs {
  mkdir(dir: string): Promise<void>;
  readdir(dir: string): Promise<string[]>;
  readFile(file: string): Promise<string>;
  writeFile(file: string, data: string): Promise<void>;
  unlink(file: string): Promise<void>;
}

export interface StoreDeps {
  dir: string;
  fs: StoreFs;
  retention: () => number;
  log: (message: string) => void;
}

function isReport(v: unknown): v is Report {
  const r = v as Partial<Report> | null;
  return (
    typeof r === 'object' && r !== null && r.schemaVersion === SCHEMA_VERSION && typeof r.id === 'string' &&
    typeof r.takenAt === 'number' && Array.isArray(r.milestones) && Array.isArray(r.phases) && Array.isArray(r.extensions)
  );
}

/** One JSON file per launch and window. Files that do not parse as a current report are left alone. */
export class ReportStore {
  constructor(private readonly deps: StoreDeps) {}

  private fileFor(id: string): string {
    return path.join(this.deps.dir, `${id.replace(/[^\w.-]/g, '_')}.json`);
  }

  async save(report: Report): Promise<void> {
    await this.deps.fs.mkdir(this.deps.dir);
    await this.deps.fs.writeFile(this.fileFor(report.id), JSON.stringify(report));
    await this.prune();
  }

  /** Newest first. */
  async list(): Promise<Report[]> {
    return (await this.readAll()).map((e) => e.report).sort((a, b) => b.takenAt - a.takenAt);
  }

  async clear(): Promise<void> {
    for (const { file } of await this.readAll()) await this.deps.fs.unlink(file).catch(() => undefined);
  }

  private async prune(): Promise<void> {
    const all = (await this.readAll()).sort((a, b) => b.report.takenAt - a.report.takenAt);
    for (const { file } of all.slice(Math.max(1, this.deps.retention()))) await this.deps.fs.unlink(file).catch(() => undefined);
  }

  private async readAll(): Promise<{ file: string; report: Report }[]> {
    let names: string[];
    try {
      names = await this.deps.fs.readdir(this.deps.dir);
    } catch {
      return [];
    }
    const out: { file: string; report: Report }[] = [];
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      const file = path.join(this.deps.dir, name);
      try {
        const parsed: unknown = JSON.parse(await this.deps.fs.readFile(file));
        if (isReport(parsed)) out.push({ file, report: parsed });
      } catch (err) {
        this.deps.log(`skipping unreadable report ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return out;
  }
}
