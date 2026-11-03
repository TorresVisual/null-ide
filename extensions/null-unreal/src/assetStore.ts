import { ExportDoc } from './exportFormat';

export type AssetState =
  | { state: 'queued' }
  | { state: 'exporting' }
  | { state: 'ready'; doc: ExportDoc }
  | { state: 'failed'; error: string };

export type AssetResult = { file: string; doc: ExportDoc } | { file: string; error: string };

export interface StoreBackend {
  // Synchronous cache lookup, no engine.
  peek(file: string): ExportDoc | undefined;
  // One engine run for these files (the CLI's own cache check still applies unless `force`). Resolves
  // with the per-file error text it has; a file that peeks as a hit afterwards is ready regardless.
  run(files: string[], force: boolean): Promise<Map<string, string>>;
}

interface Waiting { force: boolean; promise: Promise<AssetResult>; settle(r: AssetResult): void }

// What the viewers read assets through: cache first, otherwise queue an export. One engine run at a
// time; requests made during a run, or in the same tick, go out together in the next run.
export class AssetStore {
  private waiting = new Map<string, Waiting>();
  private inflight = new Map<string, Promise<AssetResult>>();
  private listeners = new Set<(file: string, s: AssetState) => void>();
  private busy = false;

  constructor(private backend: StoreBackend) {}

  peek(file: string): ExportDoc | undefined {
    return this.backend.peek(file);
  }

  async get(file: string, o: { force?: boolean } = {}): Promise<ExportDoc> {
    const [r] = await this.getMany([file], o);
    if ('error' in r) throw new Error(r.error);
    return r.doc;
  }

  getMany(files: string[], o: { force?: boolean } = {}): Promise<AssetResult[]> {
    return Promise.all(files.map((f) => this.request(f, o.force === true)));
  }

  onState(listener: (file: string, s: AssetState) => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  }

  private emit(file: string, s: AssetState) {
    for (const l of this.listeners) l(file, s);
  }

  private request(file: string, force: boolean): Promise<AssetResult> {
    if (!force) {
      const doc = this.backend.peek(file);
      if (doc) return Promise.resolve({ file, doc });
      const flying = this.inflight.get(file);
      if (flying) return flying;
    }
    const queued = this.waiting.get(file);
    if (queued) {
      queued.force ||= force;
      return queued.promise;
    }
    let settle!: (r: AssetResult) => void;
    const promise = new Promise<AssetResult>((resolve) => (settle = resolve));
    this.waiting.set(file, { force, promise, settle });
    this.emit(file, { state: 'queued' });
    queueMicrotask(() => void this.pump());
    return promise;
  }

  private async pump(): Promise<void> {
    if (this.busy || this.waiting.size === 0) return;
    this.busy = true;
    try {
      const batch = [...this.waiting.entries()];
      this.waiting.clear();
      // Forced and ordinary requests need different CLI flags, so they go out as two runs.
      for (const force of [false, true]) {
        const group = batch.filter(([, w]) => w.force === force);
        if (group.length > 0) await this.runGroup(group, force);
      }
    } finally {
      this.busy = false;
    }
    void this.pump();
  }

  private async runGroup(group: [string, Waiting][], force: boolean): Promise<void> {
    for (const [file, w] of group) {
      this.inflight.set(file, w.promise);
      this.emit(file, { state: 'exporting' });
    }
    let errors = new Map<string, string>();
    let crashed: string | undefined;
    try {
      errors = await this.backend.run(group.map(([f]) => f), force);
    } catch (e) {
      crashed = (e as Error).message;
    }
    for (const [file, w] of group) {
      const doc = this.backend.peek(file);
      const result: AssetResult = doc
        ? { file, doc }
        : { file, error: errors.get(file) ?? crashed ?? 'the export produced no cache entry' };
      this.inflight.delete(file);
      this.emit(file, doc ? { state: 'ready', doc } : { state: 'failed', error: (result as { error: string }).error });
      w.settle(result);
    }
  }
}
