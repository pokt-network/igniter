import { parseEnvInt, checkEnvVariables, failureReasonDisplay, cosmosSdkErrorMessage } from './utils';

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

describe('failureReasonDisplay', () => {
  it('returns null when the transaction is not a failure (caller shows a dash)', () => {
    expect(failureReasonDisplay(false, 'insufficient funds')).toBeNull();
    expect(failureReasonDisplay(false, null)).toBeNull();
    expect(failureReasonDisplay(false, undefined)).toBeNull();
  });

  it('returns the trimmed reason for a failure', () => {
    expect(failureReasonDisplay(true, 'insufficient funds')).toBe('insufficient funds');
    expect(failureReasonDisplay(true, '  sequence mismatch  ')).toBe('sequence mismatch');
  });

  it('falls back to "Unknown error" when a failure has no usable reason', () => {
    expect(failureReasonDisplay(true, null)).toBe('Unknown error');
    expect(failureReasonDisplay(true, undefined)).toBe('Unknown error');
    expect(failureReasonDisplay(true, '')).toBe('Unknown error');
    expect(failureReasonDisplay(true, '   ')).toBe('Unknown error');
  });

  it('maps a corroborated sdk code to its friendly message', () => {
    expect(
      failureReasonDisplay(true, 'spendable balance 0upokt is smaller than 60000000000upokt: insufficient funds', 5),
    ).toBe('Insufficient funds to cover the transaction');
    expect(
      failureReasonDisplay(true, 'out of gas in location: WritePerByte; gasWanted: 200000, gasUsed: 213417: out of gas', 11),
    ).toBe('Transaction ran out of gas');
  });

  it('shows the raw reason when the code is not corroborated by the log (module codespace collision)', () => {
    // poktroll "supplier" codespace code 5 is NOT sdk insufficient-funds
    expect(failureReasonDisplay(true, 'supplier stake below minimum', 5)).toBe('supplier stake below minimum');
  });

  it('shows the raw reason when the code is unknown or absent', () => {
    expect(failureReasonDisplay(true, 'some module error', 999)).toBe('some module error');
    expect(failureReasonDisplay(true, 'some module error', null)).toBe('some module error');
    expect(failureReasonDisplay(true, 'some module error')).toBe('some module error');
  });
});

describe('cosmosSdkErrorMessage', () => {
  it('returns the friendly message when code and log agree', () => {
    expect(cosmosSdkErrorMessage(32, 'account sequence mismatch, expected 5, got 3: incorrect account sequence'))
      .toBe('Wrong account sequence — transaction sent out of order');
    expect(cosmosSdkErrorMessage(13, 'insufficient fees; got: 1upokt required: 10upokt: insufficient fee'))
      .toBe('Fee too low for this transaction');
  });

  it('matches case-insensitively', () => {
    expect(cosmosSdkErrorMessage(11, 'OUT OF GAS: gasWanted 1, gasUsed 2')).toBe('Transaction ran out of gas');
  });

  it('returns null without corroboration, unknown code, or missing input', () => {
    expect(cosmosSdkErrorMessage(5, 'supplier stake below minimum')).toBeNull();
    expect(cosmosSdkErrorMessage(999, 'insufficient funds')).toBeNull();
    expect(cosmosSdkErrorMessage(null, 'insufficient funds')).toBeNull();
    expect(cosmosSdkErrorMessage(5, null)).toBeNull();
    expect(cosmosSdkErrorMessage(5, '')).toBeNull();
  });
});
