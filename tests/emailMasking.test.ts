import { describe, expect, test } from 'bun:test';
import { maskEmail, maskEmailsInText } from '@/utils/format';
import { getMaskedQuotaDisplayName } from '@/utils/quota/identity';

describe('maskEmail', () => {
  test('keeps two leading characters of local part and domain name, and the TLD', () => {
    expect(maskEmail('jonathan@gmail.com')).toBe('jo***@gm***.com');
    expect(maskEmail('dev1@skylive.world')).toBe('de***@sk***.world');
  });

  test('never reveals more than half of a short part', () => {
    expect(maskEmail('ab@cd.io')).toBe('a***@c***.io');
    expect(maskEmail('x@y.co')).toBe('***@***.co');
  });

  test('keeps only the last domain label of multi-level domains', () => {
    expect(maskEmail('someone@mail.example.co.uk')).toBe('so***@ma***.uk');
  });

  test('degrades safely for empty and non-email input', () => {
    expect(maskEmail('   ')).toBe('');
    expect(maskEmail('localpart')).toBe('lo***');
    expect(maskEmail('user@localhost')).toBe('us***@lo***');
  });
});

describe('maskEmailsInText', () => {
  test('masks the email inside a Claude credential filename and keeps the rest', () => {
    const name = 'claude-e88029f3-dev1@skylive.world.json';
    expect(maskEmailsInText(name, 'dev1@skylive.world')).toBe(
      'claude-e88029f3-de***@sk***.world.json'
    );
    expect(maskEmailsInText('claude-dev1@skylive.world.json', 'dev1@skylive.world')).toBe(
      'claude-de***@sk***.world.json'
    );
  });

  test('keeps hyphens around a known email intact, case-insensitively', () => {
    expect(
      maskEmailsInText('claude-1a2b3c4d-John-Smith@Gmail.com.json', 'john-smith@gmail.com')
    ).toBe('claude-1a2b3c4d-jo***@gm***.com.json');
  });

  test('without a known email, masks anything email-shaped and never leaks the address', () => {
    const masked = maskEmailsInText('claude-e88029f3-dev1@skylive.world.json');
    expect(masked).not.toContain('dev1');
    expect(masked).not.toContain('skylive');
    expect(masked.endsWith('.world.json')).toBe(true);
  });

  test('leaves text without an email untouched', () => {
    expect(maskEmailsInText('codex-team.json')).toBe('codex-team.json');
  });
});

describe('getMaskedQuotaDisplayName', () => {
  test('masks the filename and appends the masked email only when the name lacks it', () => {
    expect(
      getMaskedQuotaDisplayName({
        name: 'claude-e88029f3-dev1@skylive.world.json',
        email: 'dev1@skylive.world',
      })
    ).toBe('claude-e88029f3-de***@sk***.world.json');
    expect(
      getMaskedQuotaDisplayName({ name: 'claude-work.json', email: 'jonathan@gmail.com' })
    ).toBe('claude-work.json · jo***@gm***.com');
    expect(getMaskedQuotaDisplayName({ name: 'claude-work.json' })).toBe('claude-work.json');
  });
});
