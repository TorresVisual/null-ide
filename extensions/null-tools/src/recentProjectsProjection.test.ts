import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

interface Project { path: string; label: string; timestamp: number; pinned: boolean; available: boolean; isWorkspaceFile: boolean; gitStatus: null; }
interface Projection {
  projectSections(projects: Project[], query: string, sort: 'lastOpened' | 'name' | 'location'): Array<{ title: string; projects: Project[] }>;
  relativeProjectTime(timestamp: number, now?: number): string;
}

const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, '..', 'lib', 'recent-projects.js'), 'utf8'), sandbox);
const projection = sandbox as unknown as Projection;

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const projects: Project[] = [
  { path: 'D:\\work\\alpha', label: 'Alpha', timestamp: 1, pinned: false, available: true, isWorkspaceFile: false, gitStatus: null },
  { path: 'D:\\work\\beta', label: 'Beta', timestamp: 3, pinned: true, available: true, isWorkspaceFile: false, gitStatus: null },
  { path: 'C:\\other\\gamma', label: 'Gamma', timestamp: 2, pinned: false, available: true, isWorkspaceFile: false, gitStatus: null },
];

test('projectSections matches paths case-insensitively before grouping', () => {
  assert.deepEqual(
    Array.from(projection.projectSections(projects, 'D:/WORK', 'location'), section => section.title),
    ['Pinned', 'D:\\work'],
  );
});

test('projectSections sorts pinned first then by the requested property', () => {
  assert.deepEqual(Array.from(projection.projectSections(projects, '', 'name')[1].projects, project => project.label), ['Alpha']);
  assert.deepEqual(Array.from(projection.projectSections(projects, '', 'location'), section => section.title), ['Pinned', 'C:\\other', 'D:\\work']);
});

test('projectSections does not create empty directory sections after filtering', () => {
  assert.deepEqual(Array.from(projection.projectSections(projects, 'gamma', 'lastOpened'), section => section.title), ['C:\\other']);
});

test('relativeProjectTime produces concise deterministic labels', () => {
  assert.equal(projection.relativeProjectTime(NOW - 60_000, NOW), '1 minute ago');
  assert.equal(projection.relativeProjectTime(NOW - 2 * 60 * 60_000, NOW), '2 hours ago');
});
