import { formatDuration } from './time';

describe('formatDuration', () => {
  it('formats days and hours', () => {
    expect(formatDuration(21 * 86400 + 3 * 3600)).toBe('21d 3h');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(5 * 3600 + 30 * 60)).toBe('5h 30m');
  });

  it('formats minutes only', () => {
    expect(formatDuration(45 * 60)).toBe('45m');
  });

  it('returns "< 1m" for durations under 1 minute', () => {
    expect(formatDuration(30)).toBe('< 1m');
    expect(formatDuration(0)).toBe('< 1m');
  });

  it('omits minutes when days are present', () => {
    // 1 day, 0 hours, 30 minutes → should show "1d" (minutes hidden)
    expect(formatDuration(86400 + 30 * 60)).toBe('1d');
  });

  it('shows days and hours together', () => {
    expect(formatDuration(2 * 86400 + 12 * 3600)).toBe('2d 12h');
  });

  it('formats exactly 1 hour', () => {
    expect(formatDuration(3600)).toBe('1h');
  });

  it('formats exactly 1 day', () => {
    expect(formatDuration(86400)).toBe('1d');
  });
});
