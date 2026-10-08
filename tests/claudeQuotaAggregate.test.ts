import { describe, expect, test } from 'bun:test';
import { splitClaudeEntries, type QuotaFileEntry } from '@/features/quota/logic';
import { aggregateClaudeQuota } from '@/features/quota/providers/claude/aggregate';
import type { ClaudeQuotaState, ClaudeQuotaWindow } from '@/types';

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const HOUR = 3_600_000;

const window = (
  id: string,
  usedPercent: number | null,
  resetAtMs: number | null = null
): ClaudeQuotaWindow => ({ id, label: id, usedPercent, resetLabel: '-', resetAtMs });

const loaded = (...windows: ClaudeQuotaWindow[]): ClaudeQuotaState => ({
  status: 'success',
  windows,
});

const rounded = (quotas: (ClaudeQuotaState | undefined)[]) =>
  aggregateClaudeQuota(quotas, NOW).windows.map((row) => [
    row.id,
    Math.round(row.remainingPercent),
    row.accountCount,
  ]);

describe('aggregateClaudeQuota', () => {
  test('averages percent remaining per window over the accounts that report it', () => {
    // Reference: 5h remaining 97/100/100/100, Fable 100/73/100/100, plain 7-day only on one at 60.
    const quotas = [
      loaded(window('five-hour', 3), window('seven-day-fable', 0), window('seven-day', 40)),
      loaded(window('five-hour', 0), window('seven-day-fable', 27)),
      loaded(window('five-hour', 0), window('seven-day-fable', 0)),
      loaded(window('five-hour', 0), window('seven-day-fable', 0)),
    ];
    expect(rounded(quotas)).toEqual([
      ['five-hour', 99, 4],
      ['seven-day-fable', 93, 4],
      ['seven-day', 60, 1],
    ]);
  });

  test('leads with session, Fable and weekly; other windows follow in first-seen order', () => {
    const quotas = [
      loaded(window('seven-day-opus', 10), window('seven-day', 10)),
      loaded(
        window('seven-day-sonnet', 10),
        window('five-hour', 10),
        window('seven-day-fable', 10)
      ),
    ];
    expect(aggregateClaudeQuota(quotas, NOW).windows.map((row) => row.id)).toEqual([
      'five-hour',
      'seven-day-fable',
      'seven-day',
      'seven-day-opus',
      'seven-day-sonnet',
    ]);
  });

  test('counts loading, failed and unloaded accounts without averaging them', () => {
    const result = aggregateClaudeQuota(
      [
        loaded(window('five-hour', 50)),
        { status: 'loading', windows: [] },
        { status: 'error', windows: [], error: 'boom' },
        undefined,
      ],
      NOW
    );
    expect(result).toMatchObject({ total: 4, loaded: 1, loading: 1, failed: 1 });
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]).toMatchObject({ remainingPercent: 50, accountCount: 1 });
  });

  test('skips unknown usage, clamps out-of-range values and ignores duplicate window ids', () => {
    const quotas = [
      loaded(window('five-hour', null)),
      loaded(window('five-hour', 130), window('five-hour', 0)),
      loaded(window('five-hour', -20)),
    ];
    expect(rounded(quotas)).toEqual([['five-hour', 50, 2]]);
  });

  test('reports the soonest upcoming reset, ignoring resets already in the past', () => {
    const quotas = [
      loaded(window('five-hour', 10, NOW - HOUR)),
      loaded(window('five-hour', 10, NOW + 3 * HOUR)),
      loaded(window('five-hour', 10, NOW + 2 * HOUR)),
      loaded(window('seven-day', 10, null)),
    ];
    const rows = aggregateClaudeQuota(quotas, NOW).windows;
    expect(rows.find((row) => row.id === 'five-hour')?.nextResetAtMs).toBe(NOW + 2 * HOUR);
    expect(rows.find((row) => row.id === 'seven-day')?.nextResetAtMs).toBeNull();
  });
});

describe('splitClaudeEntries', () => {
  test('separates Claude credentials from the per-credential grid, preserving order', () => {
    const entry = (name: string, type: QuotaFileEntry['type']): QuotaFileEntry => ({
      file: { name },
      type,
    });
    const entries = [
      entry('claude-a.json', 'claude'),
      entry('codex-a.json', 'codex'),
      entry('claude-b.json', 'claude'),
      entry('kimi-a.json', 'kimi'),
    ];
    const { claude, grid } = splitClaudeEntries(entries);
    expect(claude.map(({ file }) => file.name)).toEqual(['claude-a.json', 'claude-b.json']);
    expect(grid.map(({ file }) => file.name)).toEqual(['codex-a.json', 'kimi-a.json']);
  });
});
