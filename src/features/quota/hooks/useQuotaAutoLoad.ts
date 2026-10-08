import { useEffect, useRef } from 'react';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, getQuotaMap } from '../providers';
import type { QuotaProviderType } from '../providers/types';

/**
 * Providers queried without a click. Devin's active management query runs for visible cards;
 * Claude feeds the aggregate card, which has nothing to show until its accounts are loaded.
 */
const AUTO_LOAD_TYPES: ReadonlySet<QuotaProviderType> = new Set(['claude', 'devin']);

/**
 * Load auto-load credentials once per credential per visit, in a single batch so concurrent
 * requests never trip the batch loader's in-flight guard. Other providers keep click-to-load.
 * No polling.
 */
export function useQuotaAutoLoad(
  entries: QuotaFileEntry[],
  disabled: boolean,
  loadQuota: (targets: QuotaFileEntry[]) => Promise<void>
) {
  const attempted = useRef(new Set<string>());
  const session = useQuotaStore((state) => state.cacheGeneration);
  const fileGenerations = useQuotaStore((state) => state.fileGenerations);

  useEffect(() => {
    if (disabled) return;
    const targets = entries.filter(({ type, file }) => {
      if (!AUTO_LOAD_TYPES.has(type)) return false;
      const key = JSON.stringify([
        session,
        fileGenerations[file.name] ?? 0,
        type,
        file.name,
        file.authIndex,
      ]);
      if (attempted.current.has(key)) return false;
      attempted.current.add(key);
      // An explicit refresh already started in this effect cycle counts too.
      return getQuotaMap(QUOTA_ADAPTERS[type])[getQuotaCacheKey(file)]?.status !== 'loading';
    });
    if (targets.length > 0) void loadQuota(targets);
  }, [disabled, entries, fileGenerations, loadQuota, session]);
}
