'use strict';

export interface HomeUpdate { version: string; ready: boolean; }
export interface DashboardHome { update?: HomeUpdate; todayMs?: number; }

interface DailyStatsSource { getDailyStats(range: { from: number; to: number }): Array<{ ms: number }>; }

/** An update is "ready" once its download is verified and staged; until then the rail only reports it. */
export function homeUpdate(available?: { latest?: string }, staged?: { version: string; verified: boolean }): HomeUpdate | undefined {
  if (!available?.latest) return undefined;
  return { version: available.latest, ready: staged?.version === available.latest && staged.verified };
}

/** Active coding time since local midnight; undefined when null-activity is not installed. */
export function todayMs(activity: DailyStatsSource | undefined, now = Date.now()): number | undefined {
  if (!activity) return undefined;
  const from = new Date(now).setHours(0, 0, 0, 0);
  return activity.getDailyStats({ from, to: now + 1 }).reduce((sum, day) => sum + day.ms, 0);
}
