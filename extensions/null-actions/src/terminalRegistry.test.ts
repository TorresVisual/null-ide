'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { ButtonRunState, TerminalExecution, TerminalRegistry, TerminalHandle, TerminalHost } from './terminalRegistry';

class FakeTerminal implements TerminalHandle {
  public sentTexts: string[] = [];
  public shown = false;
  constructor(public readonly name: string) {}
  sendText(text: string, _addNewLine?: boolean): void { this.sentTexts.push(text); }
  show(): void { this.shown = true; }
}

class FakeTerminalHost implements TerminalHost {
  public terminals: FakeTerminal[];
  public createCount = 0;
  constructor(initial: FakeTerminal[] = []) { this.terminals = initial; }
  listTerminals(): TerminalHandle[] { return this.terminals; }
  createTerminal(options: { name: string }): TerminalHandle {
    this.createCount++;
    const t = new FakeTerminal(options.name);
    this.terminals.push(t);
    return t;
  }
}

test('dispatch creates exactly one terminal on first call, named after the button label', async () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('build', 'Build', 'npm run build');
  assert.strictEqual(host.createCount, 1);
  assert.strictEqual(host.terminals[0].name, 'Action: Build');
  assert.deepStrictEqual(host.terminals[0].sentTexts, ['npm run build']);
});

test('repeated dispatch reuses the cached terminal instead of creating new ones', async () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('build', 'Build', 'npm run build');
  await registry.dispatch('build', 'Build', 'npm run build');
  await registry.dispatch('build', 'Build', 'npm run build');
  assert.strictEqual(host.createCount, 1);
  assert.strictEqual(host.terminals[0].sentTexts.length, 3);
});

test('a terminal already present under the button label (simulated extension-host restart / restored persistent session) is adopted, never duplicated', async () => {
  const restored = new FakeTerminal('Action: Build');
  const host = new FakeTerminalHost([restored]);
  const registry = new TerminalRegistry(host); // fresh instance — no in-memory cache
  await registry.dispatch('build', 'Build', 'npm run build');
  assert.strictEqual(host.createCount, 0, 'must not create a duplicate when a matching terminal already exists');
  assert.strictEqual(host.terminals.length, 1);
  assert.deepStrictEqual(restored.sentTexts, ['npm run build']);
});

test('changing the button command text does not create a new terminal — identity is keyed by id, not command', async () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('build', 'Build', 'npm run build');
  await registry.dispatch('build', 'Build', 'npm run build -- --watch');
  assert.strictEqual(host.createCount, 1);
  assert.deepStrictEqual(host.terminals[0].sentTexts, ['npm run build', 'npm run build -- --watch']);
});

test('renaming the button label mid-session reuses the same terminal — no duplicate, even though the tab keeps showing the old name', async () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('build', 'Build', 'npm run build');
  await registry.dispatch('build', 'Build (dev)', 'npm run build');
  assert.strictEqual(host.createCount, 1, 'the id-keyed cache must reuse the existing terminal despite the label change');
  assert.strictEqual(host.terminals[0].name, 'Action: Build', 'Terminal.name is read-only after creation — no rename API exists to keep it in sync');
  assert.deepStrictEqual(host.terminals[0].sentTexts, ['npm run build', 'npm run build']);
});

test('multiple stale terminals sharing the button label: adopts one (the most recent), creates no more', async () => {
  const older = new FakeTerminal('Action: Build');
  const newer = new FakeTerminal('Action: Build');
  const host = new FakeTerminalHost([older, newer]);
  const registry = new TerminalRegistry(host);
  await registry.dispatch('build', 'Build', 'npm run build');
  assert.strictEqual(host.createCount, 0);
  assert.deepStrictEqual(newer.sentTexts, ['npm run build']);
  assert.deepStrictEqual(older.sentTexts, [], 'the other stale terminal must be left untouched, not closed or written to');
});

test('a terminal the user closed is not reused — dispatch after removal from the host creates a fresh one', async () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('build', 'Build', 'npm run build');
  host.terminals = []; // simulate the user closing it
  await registry.dispatch('build', 'Build', 'npm run build');
  assert.strictEqual(host.createCount, 2);
});

test('different button ids get independent terminals', async () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('build', 'Build', 'npm run build');
  await registry.dispatch('test', 'Test', 'npm test');
  assert.strictEqual(host.createCount, 2);
  assert.strictEqual(host.terminals[0].name, 'Action: Build');
  assert.strictEqual(host.terminals[1].name, 'Action: Test');
});

test('focus option shows the terminal after dispatch, absent focus does not', async () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('build', 'Build', 'npm run build');
  assert.strictEqual((host.terminals[0] as FakeTerminal).shown, false);
  await registry.dispatch('build', 'Build', 'npm run build', { focus: true });
  assert.strictEqual((host.terminals[0] as FakeTerminal).shown, true);
});

// --- run state (shell integration) ---

class IntegratedHost extends FakeTerminalHost {
  public executed: string[] = [];
  public ends: Array<(code: number | undefined) => void> = [];
  public integrated = true;
  async execute(_t: TerminalHandle, command: string): Promise<TerminalExecution | undefined> {
    if (!this.integrated) { return undefined; }
    this.executed.push(command);
    return { exitCode: new Promise(resolve => { this.ends.push(resolve); }) };
  }
}

const flush = () => new Promise<void>(r => setImmediate(r));

test('with shell integration the command is executed (not sendText) and the button is busy until it ends', async () => {
  const host = new IntegratedHost();
  let t = 1000;
  const registry = new TerminalRegistry(host, () => t);
  const seen: Array<ButtonRunState | undefined> = [];
  registry.onDidChangeState((_id, s) => seen.push(s));

  await registry.dispatch('build', 'Build', 'npm run build');
  assert.deepStrictEqual(host.executed, ['npm run build']);
  assert.deepStrictEqual((host.terminals[0] as FakeTerminal).sentTexts, []);
  assert.strictEqual(registry.isBusy('build'), true);

  t = 13_000;
  host.ends[0](0);
  await flush();
  assert.strictEqual(registry.isBusy('build'), false);
  assert.deepStrictEqual(registry.getState('build'), { kind: 'passed', exitCode: 0, durationMs: 12_000 });
  assert.deepStrictEqual(seen.map(s => s?.kind), ['running', 'passed']);
});

test('a non-zero exit code is a failure; an unknown one is just "ended"', async () => {
  const host = new IntegratedHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('a', 'A', 'x');
  host.ends[0](2);
  await flush();
  assert.strictEqual(registry.getState('a')?.kind, 'failed');
  await registry.dispatch('a', 'A', 'x');
  host.ends[1](undefined);
  await flush();
  assert.strictEqual(registry.getState('a')?.kind, 'ended');
});

test('without shell integration it falls back to sendText and never reports state', async () => {
  const host = new IntegratedHost();
  host.integrated = false;
  const registry = new TerminalRegistry(host);
  await registry.dispatch('build', 'Build', 'npm run build');
  assert.deepStrictEqual((host.terminals[0] as FakeTerminal).sentTexts, ['npm run build']);
  assert.strictEqual(registry.getState('build'), undefined);
  assert.strictEqual(registry.isBusy('build'), false);
});

test('interrupt sends Ctrl+C without a newline and resolves once the run ends', async () => {
  const host = new IntegratedHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('dev', 'Dev', 'npm run dev');
  const sent: Array<[string, boolean | undefined]> = [];
  (host.terminals[0] as FakeTerminal).sendText = (text: string, nl?: boolean) => { sent.push([text, nl]); };

  let done = false;
  const p = registry.interrupt('dev').then(() => { done = true; });
  await flush();
  assert.deepStrictEqual(sent, [['\x03', false]]);
  assert.strictEqual(done, false);
  host.ends[0](130);
  await p;
  assert.strictEqual(done, true);
});

test('interrupt gives up after the timeout when the command ignores Ctrl+C', async () => {
  const host = new IntegratedHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('dev', 'Dev', 'npm run dev');
  await registry.interrupt('dev', 10);
  assert.strictEqual(registry.isBusy('dev'), true);
});

test('a run superseded by a newer one cannot overwrite the newer state when it finally ends', async () => {
  const host = new IntegratedHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('dev', 'Dev', 'npm run dev');
  await registry.dispatch('dev', 'Dev', 'npm run dev'); // "run anyway"
  host.ends[0](1);
  await flush();
  assert.strictEqual(registry.isBusy('dev'), true, 'the newer run is still going');
  host.ends[1](0);
  await flush();
  assert.strictEqual(registry.getState('dev')?.kind, 'passed');
});

class FakeTaskHost extends FakeTerminalHost {
  public tasks: { label: string; command: string; matcher: string; end: (code: number | undefined) => void; terminated: boolean; shown: boolean }[] = [];
  async runTask(label: string, command: string, options: { problemMatcher: string }) {
    let end!: (code: number | undefined) => void;
    const exitCode = new Promise<number | undefined>(r => { end = r; });
    const rec = { label, command, matcher: options.problemMatcher, end, terminated: false, shown: false };
    this.tasks.push(rec);
    return { exitCode, terminate: () => { rec.terminated = true; end(undefined); }, show: () => { rec.shown = true; } };
  }
}

test('a button with a problem matcher runs as a task, not in a terminal', async () => {
  const host = new FakeTaskHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('build', 'Build', 'cargo build', { problemMatcher: '$null-rustc' });
  assert.strictEqual(host.createCount, 0);
  assert.deepStrictEqual([host.tasks[0].label, host.tasks[0].command, host.tasks[0].matcher], ['Build', 'cargo build', '$null-rustc']);
  assert.strictEqual(registry.isBusy('build'), true);
  host.tasks[0].end(101);
  await new Promise(r => setImmediate(r));
  assert.strictEqual(registry.getState('build')?.kind, 'failed');
});

test('task runs restart and show through the task, not a terminal', async () => {
  const host = new FakeTaskHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('build', 'Build', 'cargo build', { problemMatcher: '$null-rustc' });
  await registry.interrupt('build');
  assert.strictEqual(host.tasks[0].terminated, true);
  registry.show('build');
  assert.strictEqual(host.tasks[0].shown, true);
});

test('without a matcher, or a host that cannot run tasks, dispatch still uses the terminal', async () => {
  const withTasks = new FakeTaskHost();
  await new TerminalRegistry(withTasks).dispatch('a', 'A', 'echo');
  assert.strictEqual(withTasks.tasks.length, 0);
  assert.strictEqual(withTasks.terminals[0].sentTexts[0], 'echo');

  const plain = new FakeTerminalHost();
  await new TerminalRegistry(plain).dispatch('a', 'A', 'echo', { problemMatcher: '$tsc' });
  assert.strictEqual(plain.terminals[0].sentTexts[0], 'echo');
});

test('a task that fails to start clears the running state', async () => {
  const host = new FakeTaskHost();
  host.runTask = async () => { throw new Error('unknown matcher'); };
  const registry = new TerminalRegistry(host);
  await assert.rejects(registry.dispatch('a', 'A', 'x', { problemMatcher: '$nope' }));
  assert.strictEqual(registry.getState('a'), undefined);
});

test('a throwing shell-integration execute clears the running state and falls back to sendText', async () => {
  class ThrowingHost extends FakeTerminalHost {
    async execute(): Promise<never> { throw new Error('terminal disposed'); }
  }
  const host = new ThrowingHost();
  const registry = new TerminalRegistry(host);
  await registry.dispatch('build', 'Build', 'npm run build');
  assert.strictEqual(registry.isBusy('build'), false);
  assert.deepStrictEqual(host.terminals[0].sentTexts, ['npm run build']);
});

test('two buttons sharing a label adopt different restored terminals instead of sharing one', async () => {
  const a = new FakeTerminal('Action: Build');
  const b = new FakeTerminal('Action: Build');
  const host = new FakeTerminalHost([a, b]);
  const registry = new TerminalRegistry(host);
  await registry.dispatch('one', 'Build', 'cmd one');
  await registry.dispatch('two', 'Build', 'cmd two');
  assert.strictEqual(host.createCount, 0);
  assert.deepStrictEqual(b.sentTexts, ['cmd one']);
  assert.deepStrictEqual(a.sentTexts, ['cmd two']);
});
