/**
 * One card for every Claude account: per usage window, the average percent remaining across
 * the accounts that report it. The per-account breakdown sits behind "Details".
 *
 * Shares the QuotaCard shell (QuotaCard.module.scss) so it reads as one of the grid's cards;
 * only the headline rows have their own styles.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconMaximize2, IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { ClaudeQuotaState, ResolvedTheme } from '@/types';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { bindQuotaClasses } from '../types';
import { aggregateClaudeQuota } from '../providers/claude/aggregate';
import { QuotaMeter } from './QuotaMeter';
import bodyStyles from './QuotaBody.module.scss';
import cardStyles from './QuotaCard.module.scss';
import styles from './ClaudeAggregateCard.module.scss';

const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

/** Aggregate wording for known windows; anything else keeps its per-account label. */
const AGGREGATE_LABEL_KEYS: Record<string, string> = {
  'five-hour': 'claude_quota.aggregate_session',
  'seven-day': 'claude_quota.aggregate_weekly',
  'seven-day-fable': 'claude_quota.aggregate_weekly_fable',
  'seven-day-opus': 'claude_quota.aggregate_weekly_opus',
  'seven-day-sonnet': 'claude_quota.aggregate_weekly_sonnet',
};

const SKELETON_ROWS = [0, 1, 2];

export interface ClaudeAggregateCardProps {
  /** Quota state of every account summarized, `undefined` when never loaded. */
  quotas: (ClaudeQuotaState | undefined)[];
  resolvedTheme: ResolvedTheme;
  canRefresh: boolean;
  /** The batch loader drops overlapping batches, so refresh waits for the current one. */
  batchLoading: boolean;
  /** Cascade entrance delay; null = no entrance (same contract as QuotaCard). */
  entranceDelayMs?: number | null;
  onRefresh: () => void;
  onOpenDetails: () => void;
}

export function ClaudeAggregateCard({
  quotas,
  resolvedTheme,
  canRefresh,
  batchLoading,
  entranceDelayMs,
  onRefresh,
  onOpenDetails,
}: ClaudeAggregateCardProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const { windows, total, loaded, loading, failed, stale } = useMemo(
    () => aggregateClaudeQuota(quotas, now),
    [quotas, now]
  );

  const [mountEntranceDelayMs] = useState<number | null>(entranceDelayMs ?? null);
  const entranceStyle =
    mountEntranceDelayMs === null
      ? undefined
      : ({ '--card-delay': `${mountEntranceDelayMs}ms` } as CSSProperties);

  const iconSrc = getAuthFileIcon('claude', resolvedTheme);
  const typeLabel = getTypeLabel(t, 'claude');
  const refreshDisabled = !canRefresh || batchLoading || loading > 0;

  const renderBody = () => {
    if (loaded === 0 && loading > 0) {
      return (
        <div className={cardStyles.skeleton} aria-busy="true">
          <span className={cardStyles.srOnly}>{t('claude_quota.loading')}</span>
          {SKELETON_ROWS.map((row) => (
            <div key={row} className={cardStyles.skeletonRow} aria-hidden="true">
              <span className={cardStyles.skeletonLabel} />
              <span className={cardStyles.skeletonTrack} />
            </div>
          ))}
        </div>
      );
    }
    if (loaded === 0 && failed > 0) {
      return (
        <div className={cardStyles.errorStrip} role="alert">
          {t('claude_quota.aggregate_all_failed')}
        </div>
      );
    }
    if (loaded === 0) {
      return (
        <button
          type="button"
          className={cardStyles.idleBody}
          onClick={onRefresh}
          disabled={refreshDisabled}
        >
          <IconRefreshCw size={15} aria-hidden="true" className={cardStyles.idleGlyph} />
          <span className={cardStyles.idleHint}>{t('claude_quota.aggregate_idle')}</span>
        </button>
      );
    }
    if (windows.length === 0) {
      return <div className={quotaClasses.quotaMessage}>{t('claude_quota.empty_windows')}</div>;
    }
    return windows.map((window, index) => {
      const labelKey = AGGREGATE_LABEL_KEYS[window.id] ?? window.labelKey;
      return (
        <div key={window.id} className={styles.row}>
          <div className={styles.rowHead}>
            <span className={styles.rowLabel}>{labelKey ? t(labelKey) : window.label}</span>
            <span className={styles.rowValue}>
              <span className={styles.percent}>{Math.round(window.remainingPercent)}%</span>
              <span className={styles.left}>{t('claude_quota.aggregate_left')}</span>
            </span>
          </div>
          <QuotaMeter percent={window.remainingPercent} classes={quotaClasses} index={index} />
          <div className={styles.rowMeta}>
            <span>{t('claude_quota.aggregate_accounts', { count: window.accountCount })}</span>
            {window.nextResetAtMs !== null && (
              <span title={formatInstantShort(window.nextResetAtMs)}>
                {t('claude_quota.aggregate_next_reset', {
                  when: formatRelativeInstant(window.nextResetAtMs, now, i18n.resolvedLanguage),
                })}
              </span>
            )}
          </div>
        </div>
      );
    });
  };

  return (
    <article
      className={`${cardStyles.card} ${mountEntranceDelayMs === null ? '' : cardStyles.cardEnter}`}
      style={entranceStyle}
    >
      <header className={cardStyles.head}>
        <span
          className={cardStyles.iconWrap}
          title={typeLabel}
          style={
            isThemeSurfaceIconProvider('claude')
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" className={cardStyles.icon} />
          ) : (
            <span className={cardStyles.iconFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <span className={styles.title}>{t('claude_quota.aggregate_title')}</span>
        <span className={styles.count}>
          {t('claude_quota.aggregate_accounts', { count: total })}
        </span>
      </header>

      <div className={cardStyles.body}>
        {renderBody()}
        {/* Accounts showing older data after a failed refresh still count as loaded. */}
        {loaded > 0 && (loaded < total || stale > 0 || loading > 0) && (
          <p className={styles.note} role="status">
            {loaded < total && (
              <span>{t('claude_quota.aggregate_partial', { loaded, total })}</span>
            )}
            {failed > 0 && (
              <span className={styles.noteFailed}>
                {t('claude_quota.aggregate_failed', { count: failed })}
              </span>
            )}
            {stale > 0 && <span>{t('claude_quota.aggregate_stale', { count: stale })}</span>}
            {loading > 0 && <span>{t('claude_quota.aggregate_loading', { count: loading })}</span>}
          </p>
        )}
      </div>

      <footer className={cardStyles.actionRow}>
        <button
          type="button"
          className={cardStyles.actionPill}
          onClick={onRefresh}
          disabled={refreshDisabled}
          title={t('claude_quota.aggregate_refresh_hint')}
        >
          <IconRefreshCw size={13} className={loading > 0 ? cardStyles.spinning : undefined} />
          {t('auth_files.quota_refresh_single')}
        </button>
        <button
          type="button"
          className={cardStyles.actionPill}
          onClick={onOpenDetails}
          aria-haspopup="dialog"
        >
          <IconMaximize2 size={13} />
          {t('claude_quota.details_button')}
        </button>
      </footer>
    </article>
  );
}
