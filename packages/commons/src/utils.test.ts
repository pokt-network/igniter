import { parseEnvInt, checkEnvVariables } from './utils';

describe('parseEnvInt', () => {
  it('parses a valid integer string', () => {
    expect(parseEnvInt('42', 0)).toBe(42);
  });

  it('returns fallback for undefined', () => {
    expect(parseEnvInt(undefined, 99)).toBe(99);
  });

  it('returns fallback for empty string', () => {
    expect(parseEnvInt('', 10)).toBe(10);
  });

  it('returns fallback for non-numeric string', () => {
    expect(parseEnvInt('abc', 5)).toBe(5);
  });

  it('parses negative integers', () => {
    expect(parseEnvInt('-7', 0)).toBe(-7);
  });

  it('truncates float strings to integer', () => {
    expect(parseEnvInt('3.14', 0)).toBe(3);
  });
});

describe('checkEnvVariables', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does not throw when all variables are present', () => {
    process.env.TEST_VAR_A = 'hello';
    process.env.TEST_VAR_B = 'world';

    expect(() => checkEnvVariables(['TEST_VAR_A', 'TEST_VAR_B'])).not.toThrow();
  });

  it('throws when a variable is missing', () => {
    process.env.TEST_VAR_A = 'hello';
    delete process.env.TEST_VAR_MISSING;

    expect(() => checkEnvVariables(['TEST_VAR_A', 'TEST_VAR_MISSING'])).toThrow(
      'Missing required env variable: TEST_VAR_MISSING',
    );
  });

  it('throws when a variable is empty string', () => {
    process.env.TEST_VAR_EMPTY = '';

    expect(() => checkEnvVariables(['TEST_VAR_EMPTY'])).toThrow(
      'Missing required env variable: TEST_VAR_EMPTY',
    );
  });

  it('does not throw for an empty list', () => {
    expect(() => checkEnvVariables([])).not.toThrow();
  });
});
