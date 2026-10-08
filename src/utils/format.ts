import { parseTimestamp } from './timestamp';

/**
 * 格式化工具函数
 * 从原项目 src/utils/string.js 迁移
 */

/**
 * 隐藏 API Key 中间部分，仅保留前后两位
 */
export function maskApiKey(key: string): string {
  const trimmed = String(key || '').trim();
  if (!trimmed) {
    return '';
  }

  const MASKED_LENGTH = 10;
  const visibleChars = trimmed.length < 4 ? 1 : 2;
  const start = trimmed.slice(0, visibleChars);
  const end = trimmed.slice(-visibleChars);
  const maskedLength = Math.max(MASKED_LENGTH - visibleChars * 2, 1);
  const masked = '*'.repeat(maskedLength);

  return `${start}${masked}${end}`;
}

/** Keep at most two leading characters, and never more than half of the value. */
const maskTail = (value: string): string =>
  `${value.slice(0, Math.min(2, Math.floor(value.length / 2)))}***`;

/**
 * Mask an email for display while keeping it recognizable to its owner:
 * `jonathan@gmail.com` → `jo***@gm***.com`. The TLD is the only part kept whole.
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  if (!trimmed) return '';
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return maskTail(trimmed);

  const domain = trimmed.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const maskedDomain =
    dot > 0 ? `${maskTail(domain.slice(0, dot))}${domain.slice(dot)}` : maskTail(domain);
  return `${maskTail(trimmed.slice(0, at))}@${maskedDomain}`;
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Mask every email inside free text such as a credential filename
 * (`claude-e88029f3-dev1@skylive.world.json` → `claude-e88029f3-de***@sk***.world.json`).
 *
 * A known email is replaced as a whole first, so prefixes and hyphens around it survive.
 * Anything still email-shaped is then masked by pattern, which errs toward masking too much
 * (a hyphenated filename prefix can be swallowed into the local part) rather than too little.
 */
export function maskEmailsInText(text: string, knownEmail?: string): string {
  const email = knownEmail?.trim();
  const withKnown = email
    ? text.replace(new RegExp(escapeRegExp(email), 'gi'), maskEmail(email))
    : text;
  // Credential files end in `.json`; keep the extension out of the domain match.
  const extension = /\.json$/i.exec(withKnown)?.[0] ?? '';
  const stem = withKnown.slice(0, withKnown.length - extension.length);
  return `${stem.replace(EMAIL_PATTERN, (match) => maskEmail(match))}${extension}`;
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

const COMPACT_SUFFIXES = ['', 'K', 'M', 'B', 'T'] as const;

/**
 * 将较大的计数压缩为紧凑形式（1284 → 1.3K），用于统计卡片与图表标签
 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';

  const sign = value < 0 ? '-' : '';
  let scaled = Math.abs(value);
  let tier = 0;

  while (scaled >= 1000 && tier < COMPACT_SUFFIXES.length - 1) {
    scaled /= 1000;
    tier += 1;
  }

  // 三位有效数字以内保留一位小数；Number() 顺带去掉 "1.0K" 这类冗余尾巴
  let rendered = tier === 0 ? Math.round(scaled) : Number(scaled.toFixed(scaled < 100 ? 1 : 0));

  // 四舍五入后又进位到 1000（如 999,999 → 1000K）时再升一档
  if (rendered >= 1000 && tier < COMPACT_SUFFIXES.length - 1) {
    rendered = 1;
    tier += 1;
  }

  return `${sign}${rendered}${COMPACT_SUFFIXES[tier]}`;
}

/**
 * 格式化百分比，去掉无意义的 ".0" 尾巴
 */
export function formatPercent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return '—';

  const rendered = value.toFixed(fractionDigits);
  return `${rendered.replace(/\.0+$/, '')}%`;
}

/**
 * 将 Unix 时间戳（秒/毫秒/微秒/纳秒）格式化为本地时间字符串
 */
export function formatUnixTimestamp(value: unknown, locale?: string): string {
  if (value === null || value === undefined || value === '') return '';

  const asNumber = typeof value === 'number' ? value : Number(value);
  const date = (() => {
    if (!Number.isFinite(asNumber) || Number.isNaN(asNumber)) {
      return parseTimestamp(value) ?? new Date(String(value));
    }

    const abs = Math.abs(asNumber);

    // 秒：常见 10 位（~1e9）
    if (abs < 1e11) return new Date(asNumber * 1000);

    // 毫秒：常见 13 位（~1e12）
    if (abs < 1e14) return new Date(asNumber);

    // 微秒：常见 16 位（~1e15）
    if (abs < 1e17) return new Date(Math.round(asNumber / 1000));

    // 纳秒：常见 19 位（~1e18）
    return new Date(Math.round(asNumber / 1e6));
  })();

  if (Number.isNaN(date.getTime())) return '';
  return locale ? date.toLocaleString(locale) : date.toLocaleString();
}

export function parseDateValue(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const date =
    typeof value === 'number'
      ? new Date(value < 1e12 ? value * 1000 : value)
      : (parseTimestamp(value) ?? new Date(String(value)));

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateValue(value: unknown, locale?: string): string {
  const date = parseDateValue(value);
  if (!date) return '';
  return locale ? date.toLocaleDateString(locale) : date.toLocaleDateString();
}

export function formatDateTimeValue(value: unknown, locale?: string): string {
  const date = parseDateValue(value);
  if (!date) return '';
  return locale ? date.toLocaleString(locale) : date.toLocaleString();
}
