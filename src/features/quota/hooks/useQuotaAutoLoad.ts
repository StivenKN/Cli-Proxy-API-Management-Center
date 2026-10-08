import { useEffect, useRef } from 'react';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { shouldAutoLoadQuota, type QuotaFileEntry } from '../logic';
import { QUOTA_ADAPTERS, getQuotaMap } from '../providers';

/**
 * Page-open auto-load (Devin's visible cards, every Claude account behind the aggregate card):
 * at most once per credential per visit, skipping fresh or in-flight ones (shouldAutoLoadQuota)
 * in a single batch so concurrent requests never trip the batch loader's in-flight guard.
 * Other providers keep click-to-load. No polling.
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
    const now = Date.now();
    const targets = entries.filter(({ type, file }) => {
      const key = JSON.stringify([
        session,
        fileGenerations[file.name] ?? 0,
        type,
        file.name,
        file.authIndex,
      ]);
      if (attempted.current.has(key)) return false;
      // Fresh and in-flight credentials count as this visit's load too, so a load that
      // fails later in the visit is not retried automatically.
      attempted.current.add(key);
      const quota = getQuotaMap(QUOTA_ADAPTERS[type])[getQuotaCacheKey(file)];
      return shouldAutoLoadQuota(type, quota, now);
    });
    if (targets.length > 0) void loadQuota(targets);
  }, [disabled, entries, fileGenerations, loadQuota, session]);
}
