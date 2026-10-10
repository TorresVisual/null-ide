'use strict';

import { ALL_TIME, formatDuration } from './stats';
import { NullActivityApi } from './types';

export interface Badge {
  file: string;
  label: string;
  value: string;
  color: string;
}

export type BadgeSource = Pick<NullActivityApi, 'getDailyStats' | 'getLanguageStats'>;

/** Total time, average per active day, and most-used language — all-time. */
export function buildBadges(api: BadgeSource): Badge[] {
  const days = api.getDailyStats(ALL_TIME);
  const total = days.reduce((sum, d) => sum + d.ms, 0);
  const average = days.length ? total / days.length : 0;
  const top = api.getLanguageStats(ALL_TIME).find((l) => l.language !== '');
  return [
    { file: 'null-activity-total.svg', label: 'coding time', value: formatDuration(total), color: '#007ec6' },
    { file: 'null-activity-daily-average.svg', label: 'daily average', value: formatDuration(average), color: '#4c1' },
    { file: 'null-activity-top-language.svg', label: 'top language', value: top?.language ?? 'none', color: '#fe7d37' },
  ];
}
