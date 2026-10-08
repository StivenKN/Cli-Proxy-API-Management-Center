/**
 * Combined Claude quota across accounts: one row per usage window.
 * React-free — consumed directly by tests/claudeQuotaAggregate.test.ts.
 */

import type { ClaudeQuotaState } from '@/types';

/** Rows the aggregate always leads with; any other window follows in first-seen order. */
const LEADING_WINDOW_IDS = ['five-hour', 'seven-day-fable', 'seven-day'];

export interface ClaudeAggregateWindow {
  id: string;
  /** Label of the first account reporting this window (fallback for unknown ids). */
  label: string;
  labelKey?: string;
  /** Average percent remaining over the accounts that report this window. */
  remainingPercent: number;
  /** How many accounts report this window — the denominator of the average. */
  accountCount: number;
  /** Soonest upcoming reset among those accounts; null when none is known. */
  nextResetAtMs: number | null;
}

export interface ClaudeQuotaAggregate {
  windows: ClaudeAggregateWindow[];
  total: number;
  loaded: number;
  loading: number;
  failed: number;
}

/**
 * Average each window's remaining percent across the loaded accounts.
 *
 * An account without a window is left out of that window's average rather than counted
 * as full: one account on a plain 7-day limit at 60% reads "60% left", not a diluted 90%.
 * Loading, failed and not-yet-loaded accounts only show up in the counts.
 */
export function aggregateClaudeQuota(
  quotas: readonly (ClaudeQuotaState | undefined)[],
  nowMs: number
): ClaudeQuotaAggregate {
  const byId = new Map<string, ClaudeAggregateWindow & { remainingSum: number }>();
  let loaded = 0;
  let loading = 0;
  let failed = 0;

  for (const quota of quotas) {
    if (quota?.status === 'loading') loading += 1;
    if (quota?.status === 'error') failed += 1;
    if (quota?.status !== 'success') continue;
    loaded += 1;

    const seen = new Set<string>();
    for (const window of quota.windows) {
      const used = window.usedPercent;
      if (used === null || !Number.isFinite(used) || seen.has(window.id)) continue;
      seen.add(window.id);

      const row = byId.get(window.id) ?? {
        id: window.id,
        label: window.label,
        labelKey: window.labelKey,
        remainingPercent: 0,
        accountCount: 0,
        nextResetAtMs: null,
        remainingSum: 0,
      };
      row.remainingSum += 100 - Math.min(100, Math.max(0, used));
      row.accountCount += 1;
      const resetAt = window.resetAtMs;
      if (
        typeof resetAt === 'number' &&
        resetAt > nowMs &&
        (row.nextResetAtMs === null || resetAt < row.nextResetAtMs)
      ) {
        row.nextResetAtMs = resetAt;
      }
      byId.set(window.id, row);
    }
  }

  const rank = (id: string) => {
    const index = LEADING_WINDOW_IDS.indexOf(id);
    return index === -1 ? LEADING_WINDOW_IDS.length : index;
  };
  const windows = [...byId.values()]
    .map(({ remainingSum, ...row }) => ({
      ...row,
      remainingPercent: remainingSum / row.accountCount,
    }))
    .sort((a, b) => rank(a.id) - rank(b.id));

  return { windows, total: quotas.length, loaded, loading, failed };
}
