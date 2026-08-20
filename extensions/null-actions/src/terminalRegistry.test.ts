'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { TerminalRegistry, TerminalHandle, TerminalHost } from './terminalRegistry';

class FakeTerminal implements TerminalHandle {
  public sentTexts: string[] = [];
  public shown = false;
  constructor(public readonly name: string) {}
  sendText(text: string): void { this.sentTexts.push(text); }
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

test('dispatch creates exactly one terminal on first call, named after the button id', () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  assert.strictEqual(host.createCount, 1);
  assert.strictEqual(host.terminals[0].name, 'Action: build');
  assert.deepStrictEqual(host.terminals[0].sentTexts, ['npm run build']);
});

test('repeated dispatch reuses the cached terminal instead of creating new ones', () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  registry.dispatch('build', 'npm run build');
  registry.dispatch('build', 'npm run build');
  assert.strictEqual(host.createCount, 1);
  assert.strictEqual(host.terminals[0].sentTexts.length, 3);
});

test('a terminal already present under the button name (simulated extension-host restart / restored persistent session) is adopted, never duplicated', () => {
  const restored = new FakeTerminal('Action: build');
  const host = new FakeTerminalHost([restored]);
  const registry = new TerminalRegistry(host); // fresh instance — no in-memory cache
  registry.dispatch('build', 'npm run build');
  assert.strictEqual(host.createCount, 0, 'must not create a duplicate when a matching terminal already exists');
  assert.strictEqual(host.terminals.length, 1);
  assert.deepStrictEqual(restored.sentTexts, ['npm run build']);
});

test('changing the button command text does not create a new terminal — identity is keyed by id, not command', () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  registry.dispatch('build', 'npm run build -- --watch');
  assert.strictEqual(host.createCount, 1);
  assert.deepStrictEqual(host.terminals[0].sentTexts, ['npm run build', 'npm run build -- --watch']);
});

test('multiple stale terminals sharing the button name: adopts one (the most recent), creates no more', () => {
  const older = new FakeTerminal('Action: build');
  const newer = new FakeTerminal('Action: build');
  const host = new FakeTerminalHost([older, newer]);
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  assert.strictEqual(host.createCount, 0);
  assert.deepStrictEqual(newer.sentTexts, ['npm run build']);
  assert.deepStrictEqual(older.sentTexts, [], 'the other stale terminal must be left untouched, not closed or written to');
});

test('a terminal the user closed is not reused — dispatch after removal from the host creates a fresh one', () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  host.terminals = []; // simulate the user closing it
  registry.dispatch('build', 'npm run build');
  assert.strictEqual(host.createCount, 2);
});

test('different button ids get independent terminals', () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  registry.dispatch('test', 'npm test');
  assert.strictEqual(host.createCount, 2);
  assert.strictEqual(host.terminals[0].name, 'Action: build');
  assert.strictEqual(host.terminals[1].name, 'Action: test');
});

test('focus option shows the terminal after dispatch, absent focus does not', () => {
  const host = new FakeTerminalHost();
  const registry = new TerminalRegistry(host);
  registry.dispatch('build', 'npm run build');
  assert.strictEqual((host.terminals[0] as FakeTerminal).shown, false);
  registry.dispatch('build', 'npm run build', { focus: true });
  assert.strictEqual((host.terminals[0] as FakeTerminal).shown, true);
});
