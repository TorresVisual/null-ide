'use strict';

export const SCHEMA_VERSION = 1;

/** Output of the `_null.startup.snapshot` command (patch 010). Epoch ms unless noted. */
export interface SnapshotMark {
  source: string;
  name: string;
  startTime: number;
}

export interface SnapshotContribution {
  phase: number;
  id: string;
  /** Duration. */
  ms: number;
}

export interface SnapshotExtension {
  id: string;
  activationEvent: string;
  /** The extension that triggered this activation. */
  reason: string;
  eager: boolean;
  /** Epoch ms on the same clock as the marks. */
  startMs?: number;
  endMs?: number;
  /** Durations measured in the extension host. */
  loadMs?: number;
  callMs?: number;
  resolveMs?: number;
}

export interface Snapshot {
  schemaVersion: 1;
  takenAt: number;
  appVersion: string;
  initialStartup: boolean;
  metrics: Record<string, number>;
  marks: SnapshotMark[];
  contributions: SnapshotContribution[];
  extensions: SnapshotExtension[];
}

export type MilestoneId = 'windowCreated' | 'uiInteractive' | 'workspaceRestored' | 'extensionsSettled';

/** Everything below is milliseconds since launch unless named otherwise. */
export interface Milestone {
  id: MilestoneId;
  label: string;
  atMs?: number;
}

export interface PhaseEntry {
  id: string;
  label: string;
  process: 'main' | 'renderer';
  startMs?: number;
  endMs?: number;
  durationMs?: number;
  /** Wall-clock time this phase adds that no earlier-starting phase already covers. */
  impactMs?: number;
}

export interface ExtensionEntry {
  id: string;
  activationEvent: string;
  reason: string;
  eager: boolean;
  /** Ended after `workspaceRestored` (or, without that mark, not eager). */
  deferred: boolean;
  startMs?: number;
  endMs?: number;
  loadMs?: number;
  callMs?: number;
  resolveMs?: number;
  /** loadMs + callMs + resolveMs. */
  totalMs?: number;
  /** Wall-clock time this activation adds beyond earlier-starting activations. */
  impactMs?: number;
}

export interface Report {
  schemaVersion: 1;
  id: string;
  windowId: string;
  /** Epoch ms of the snapshot. */
  takenAt: number;
  appVersion: string;
  initialStartup: boolean;
  /** No launch-start mark was found, so every offset is unknown. */
  partial: boolean;
  /** `workspaceRestored`. */
  headlineMs?: number;
  milestones: Milestone[];
  phases: PhaseEntry[];
  extensions: ExtensionEntry[];
}
