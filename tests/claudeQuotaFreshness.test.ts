/**
 * Claude's usage endpoint is rate limited per account. These pin the rules that keep the quota
 * page inside that limit: no page-open refetch of fresh data, last good data kept through a
 * failed refresh, and the profile call made only until the plan is known.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import i18n from '@/i18n';
import { QUOTA_AUTO_LOAD_FRESH_MS } from '@/features/quota/constants';
import { shouldAutoLoadQuota } from '@/features/quota/logic';
import { aggregateClaudeQuota } from '@/features/quota/providers/claude/aggregate';
import { CLAUDE_CONFIG } from '@/features/quota/providers/claude/data';
import { apiCallApi, type ApiCallRequest } from '@/services/api/apiCall';
import { CLAUDE_PROFILE_URL, CLAUDE_USAGE_URL, getStatusFromError } from '@/utils/quota';
import type { ClaudeQuotaState } from '@/types';

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const MINUTE = 60_000;

const loadedState = (loadedAt: number): ClaudeQuotaState =>
  CLAUDE_CONFIG.buildSuccessState({
    windows: [
      {
        id: 'five-hour',
        label: '5-hour limit',
        usedPercent: 20,
        resetLabel: '-',
        resetAtMs: NOW + 60 * MINUTE,
      },
    ],
    extraUsage: null,
    planType: 'plan_max',
    loadedAt,
  });

describe('Claude quota keeps its last good data through a reload', () => {
  test('a loading state and a failed refresh carry the previous successful load', () => {
    const previous = loadedState(NOW - 10 * MINUTE);
    const loading = CLAUDE_CONFIG.buildLoadingState(previous);
    expect(loading).toMatchObject({ status: 'loading', planType: 'plan_max' });
    expect(loading.windows).toBe(previous.windows);
    expect(loading.loadedAt).toBe(previous.loadedAt);

    const failed = CLAUDE_CONFIG.buildErrorState('Rate limited', 429, loading);
    expect(failed).toMatchObject({
      status: 'error',
      error: 'Rate limited',
      errorStatus: 429,
      planType: 'plan_max',
      loadedAt: previous.loadedAt,
    });
    expect(failed.windows).toBe(previous.windows);

    // Repeated failures keep pointing at the original successful load.
    const failedAgain = CLAUDE_CONFIG.buildErrorState('Rate limited', 429, failed);
    expect(failedAgain.loadedAt).toBe(previous.loadedAt);
    expect(failedAgain.windows).toBe(previous.windows);
  });

  test('without earlier data a failure is a plain error with nothing to show', () => {
    const failed = CLAUDE_CONFIG.buildErrorState(
      'Rate limited',
      429,
      CLAUDE_CONFIG.buildLoadingState(undefined)
    );
    expect(failed).toEqual({
      status: 'error',
      windows: [],
      error: 'Rate limited',
      errorStatus: 429,
    });
  });

  test('the aggregate counts a failed refresh over earlier data as stale, not failed', () => {
    const stale = CLAUDE_CONFIG.buildErrorState('Rate limited', 429, loadedState(NOW - MINUTE));
    const refreshing = CLAUDE_CONFIG.buildLoadingState(loadedState(NOW - MINUTE));
    const noData = CLAUDE_CONFIG.buildErrorState('Rate limited', 429);
    const result = aggregateClaudeQuota([stale, refreshing, noData, loadedState(NOW)], NOW);
    expect(result).toMatchObject({ total: 4, loaded: 3, stale: 1, failed: 1, loading: 1 });
    expect(result.windows[0]).toMatchObject({ id: 'five-hour', accountCount: 3 });
  });
});

describe('page-open auto-load skips fresh accounts', () => {
  test('skips an account loaded within the last 10 minutes, loads it after', () => {
    expect(shouldAutoLoadQuota('claude', loadedState(NOW - 9 * MINUTE), NOW)).toBe(false);
    expect(shouldAutoLoadQuota('claude', loadedState(NOW - QUOTA_AUTO_LOAD_FRESH_MS), NOW)).toBe(
      true
    );
    expect(shouldAutoLoadQuota('claude', undefined, NOW)).toBe(true);
  });

  test('a recent good load still counts after a failed refresh; in-flight loads never repeat', () => {
    const rateLimited = CLAUDE_CONFIG.buildErrorState('429', 429, loadedState(NOW - MINUTE));
    expect(shouldAutoLoadQuota('claude', rateLimited, NOW)).toBe(false);
    expect(shouldAutoLoadQuota('claude', CLAUDE_CONFIG.buildErrorState('429', 429), NOW)).toBe(
      true
    );
    expect(shouldAutoLoadQuota('claude', CLAUDE_CONFIG.buildLoadingState(), NOW)).toBe(false);
  });

  test('only auto-load providers qualify', () => {
    expect(shouldAutoLoadQuota('codex', undefined, NOW)).toBe(false);
    expect(shouldAutoLoadQuota('devin', undefined, NOW)).toBe(true);
  });
});

describe('upstream calls per Claude account load', () => {
  const originalRequest = apiCallApi.request;
  afterEach(() => {
    apiCallApi.request = originalRequest;
  });

  const recordCalls = (usageStatus = 200) => {
    const calls: string[] = [];
    apiCallApi.request = async (request: ApiCallRequest) => {
      calls.push(request.url);
      const body =
        request.url === CLAUDE_PROFILE_URL
          ? { account: { has_claude_max: true } }
          : { five_hour: { utilization: 20, resets_at: '2026-10-07T13:00:00Z' } };
      return {
        statusCode: request.url === CLAUDE_USAGE_URL ? usageStatus : 200,
        body,
        bodyText: '',
        header: {},
      };
    };
    return calls;
  };
  const file = { name: 'claude-dev1@example.com.json', type: 'claude', authIndex: 'idx-1' };

  test('fetches the profile only until the plan is known', async () => {
    const calls = recordCalls();
    const first = await CLAUDE_CONFIG.fetchQuota(file, i18n.t);
    expect(calls).toEqual([CLAUDE_USAGE_URL, CLAUDE_PROFILE_URL]);
    expect(first.planType).toBe('plan_max');
    expect(typeof first.loadedAt).toBe('number');

    calls.length = 0;
    const second = await CLAUDE_CONFIG.fetchQuota(
      file,
      i18n.t,
      CLAUDE_CONFIG.buildLoadingState(CLAUDE_CONFIG.buildSuccessState(first))
    );
    expect(calls).toEqual([CLAUDE_USAGE_URL]);
    expect(second.planType).toBe('plan_max');
  });

  test('a rate-limited usage call surfaces its 429 status', async () => {
    recordCalls(429);
    const failure = await CLAUDE_CONFIG.fetchQuota(file, i18n.t).catch((err: unknown) => err);
    expect(getStatusFromError(failure)).toBe(429);
  });
});
