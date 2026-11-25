import { authSecretProblem, encryptionKeyProblem, secretProblems } from './secrets';

const GOOD_SECRET = 'k'.repeat(32);
const GOOD_KEY = 'ab'.repeat(32);

describe('authSecretProblem', () => {
  it.each([
    [undefined, 'empty'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['CHANGEME', 'placeholder'],
    ['changeme-but-long-enough-to-pass-32-bytes', 'placeholder'],
    ['k'.repeat(31), 'at least 32 bytes'],
  ])('refuses %p', (value, reason) => {
    expect(authSecretProblem(value)).toContain(reason);
  });

  it('accepts a 32-byte secret', () => {
    expect(authSecretProblem(GOOD_SECRET)).toBeNull();
  });
});

describe('encryptionKeyProblem', () => {
  it.each([
    [undefined, 'empty'],
    ['CHANGEME_ENCRYPTION_KEY', 'placeholder'],
    ['ab'.repeat(16), '32 bytes'],
    ['zz'.repeat(32), '32 bytes'],
    ['ab'.repeat(33), '32 bytes'],
  ])('refuses %p', (value, reason) => {
    expect(encryptionKeyProblem(value)).toContain(reason);
  });

  it('accepts a 64-character hex key', () => {
    expect(encryptionKeyProblem(GOOD_KEY)).toBeNull();
  });
});

describe('secretProblems', () => {
  it('lists every problem without echoing the values', () => {
    const problems = secretProblems({ AUTH_SECRET: 'CHANGEME_secret', APP_IDENTITY: '', ENCRYPTION_KEY: 'short' }, { encryptionKey: true });
    expect(problems).toHaveLength(3);
    expect(problems.join(' ')).not.toContain('CHANGEME_secret');
    expect(problems.join(' ')).not.toContain('short');
  });

  it('checks ENCRYPTION_KEY only when asked', () => {
    expect(secretProblems({ AUTH_SECRET: GOOD_SECRET, APP_IDENTITY: 'abc' })).toEqual([]);
    expect(secretProblems({ AUTH_SECRET: GOOD_SECRET, APP_IDENTITY: 'abc', ENCRYPTION_KEY: GOOD_KEY }, { encryptionKey: true })).toEqual([]);
  });
});
