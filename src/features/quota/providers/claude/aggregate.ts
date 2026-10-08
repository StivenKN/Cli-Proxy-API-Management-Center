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
  /** Accounts with data, including stale ones still showing their last good load. */
  loaded: number;
  /** Loads in flight (with or without earlier data). */
  loading: number;
  /** Last refresh failed and there is no earlier data. */
  failed: number;
  /** Last refresh failed (e.g. rate limited); the account still shows its last good data. */
  stale: number;
}

/**
 * Average each window's remaining percent across the accounts with data.
 *
 * An account without a window is left out of that window's average rather than counted
 * as full: one account on a plain 7-day limit at 60% reads "60% left", not a diluted 90%.
 * An account whose refresh is in flight or failed keeps contributing its last good data
 * (`loadedAt`); accounts with no data at all only show up in the counts.
 */
export function aggregateClaudeQuota(
  quotas: readonly (ClaudeQuotaState | undefined)[],
  nowMs: number
): ClaudeQuotaAggregate {
  const byId = new Map<string, ClaudeAggregateWindow & { remainingSum: number }>();
  let loaded = 0;
  let loading = 0;
  let failed = 0;
  let stale = 0;

  for (const quota of quotas) {
    if (!quota) continue;
    const hasData = quota.status === 'success' || quota.loadedAt !== undefined;
    if (quota.status === 'loading') loading += 1;
    if (quota.status === 'error') {
      if (hasData) stale += 1;
      else failed += 1;
    }
    if (!hasData) continue;
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

  return { windows, total: quotas.length, loaded, loading, failed, stale };
}
