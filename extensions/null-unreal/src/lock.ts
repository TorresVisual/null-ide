import { ResolveError } from './uproject';

export interface LockIo {
  create(file: string, contents: string): boolean;   // exclusive create; false when the file exists
  read(file: string): string | undefined;
  remove(file: string): void;
  alive(pid: number): boolean;
  sleep(ms: number): Promise<void>;
  now(): number;
  pid: number;
}

// One engine run per project at a time, across processes. A lock whose PID is dead is taken over.
export async function withLock<T>(file: string, io: LockIo, fn: () => Promise<T>, waitMs = 600_000): Promise<T> {
  const started = io.now();
  while (!io.create(file, JSON.stringify({ pid: io.pid, started: started }))) {
    const held = io.read(file);
    let pid: unknown;
    try {
      pid = held === undefined ? undefined : JSON.parse(held).pid;
    } catch {
      pid = undefined;
    }
    // A missing or unreadable lock is stale too: the owner died mid-write or removed it.
    if (typeof pid !== 'number' || !io.alive(pid)) {
      io.remove(file);
      continue;
    }
    if (io.now() - started > waitMs) {
      throw new ResolveError(`another export (pid ${pid}) has held ${file} for more than ${Math.round(waitMs / 1000)}s`);
    }
    await io.sleep(500);
  }
  try {
    return await fn();
  } finally {
    io.remove(file);
  }
}
