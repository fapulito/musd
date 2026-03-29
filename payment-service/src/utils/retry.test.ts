/**
 * Unit tests for retry utility with exponential backoff.
 * Validates Requirement 8.4: Retry failed blockchain transactions up to 3 times.
 */

jest.mock('./logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  withRetry,
  withRetryForErrorCode,
  calculateDelay,
  RETRY_CONFIGS,
  DEFAULT_RETRY_CONFIG,
  RetryConfig,
} from './retry';
import { ErrorCode } from './errors';

/** No-op delay so tests run instantly */
const noDelay = () => Promise.resolve();

describe('calculateDelay', () => {
  const config: RetryConfig = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  };

  it('returns initialDelay for attempt 0', () => {
    expect(calculateDelay(0, config)).toBe(1000);
  });

  it('doubles each attempt', () => {
    expect(calculateDelay(1, config)).toBe(2000);
    expect(calculateDelay(2, config)).toBe(4000);
    expect(calculateDelay(3, config)).toBe(8000);
  });

  it('clamps to maxDelay', () => {
    expect(calculateDelay(4, config)).toBe(10000);
    expect(calculateDelay(10, config)).toBe(10000);
  });
});

describe('RETRY_CONFIGS', () => {
  it('has MINT_FAILED with 3 retries, 5s initial, 60s max, 2x backoff', () => {
    const cfg = RETRY_CONFIGS[ErrorCode.MINT_FAILED];
    expect(cfg).toEqual({
      maxRetries: 3,
      initialDelay: 5000,
      maxDelay: 60000,
      backoffMultiplier: 2,
    });
  });

  it('has BURN_FAILED with 3 retries', () => {
    const cfg = RETRY_CONFIGS[ErrorCode.BURN_FAILED];
    expect(cfg.maxRetries).toBe(3);
  });

  it('has STRIPE_API_ERROR with 2 retries', () => {
    const cfg = RETRY_CONFIGS[ErrorCode.STRIPE_API_ERROR];
    expect(cfg.maxRetries).toBe(2);
    expect(cfg.initialDelay).toBe(2000);
  });
});

describe('withRetry', () => {
  it('returns success on first attempt when fn succeeds', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    const result = await withRetry(fn, DEFAULT_RETRY_CONFIG, 'test', noDelay);

    expect(result.success).toBe(true);
    expect(result.data).toBe('ok');
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries and succeeds on second attempt', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, DEFAULT_RETRY_CONFIG, 'test', noDelay);

    expect(result.success).toBe(true);
    expect(result.data).toBe('ok');
    expect(result.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('exhausts retries and returns failure', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));
    const config: RetryConfig = { maxRetries: 2, initialDelay: 100, maxDelay: 1000, backoffMultiplier: 2 };

    const result = await withRetry(fn, config, 'test', noDelay);

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('always fails');
    expect(result.attempts).toBe(3); // 1 initial + 2 retries
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls delayFn between retries with correct backoff', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const delays: number[] = [];
    const trackDelay = (ms: number) => { delays.push(ms); return Promise.resolve(); };

    const config: RetryConfig = { maxRetries: 3, initialDelay: 1000, maxDelay: 10000, backoffMultiplier: 2 };
    await withRetry(fn, config, 'test', trackDelay);

    expect(delays).toEqual([1000, 2000]);
  });

  it('does not delay after the last failed attempt', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    const delays: number[] = [];
    const trackDelay = (ms: number) => { delays.push(ms); return Promise.resolve(); };

    const config: RetryConfig = { maxRetries: 1, initialDelay: 500, maxDelay: 5000, backoffMultiplier: 2 };
    await withRetry(fn, config, 'test', trackDelay);

    // Only 1 delay (between attempt 1 and 2), not after the final attempt
    expect(delays).toEqual([500]);
  });
});

describe('withRetryForErrorCode', () => {
  it('uses MINT_FAILED config for ErrorCode.MINT_FAILED', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('mint error'));

    const result = await withRetryForErrorCode(fn, ErrorCode.MINT_FAILED, 'mint', noDelay);

    expect(result.success).toBe(false);
    // 1 initial + 3 retries = 4 total
    expect(result.attempts).toBe(4);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('falls back to DEFAULT_RETRY_CONFIG for unknown codes', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('unknown'));

    const result = await withRetryForErrorCode(fn, 'UNKNOWN_CODE', 'unknown', noDelay);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(DEFAULT_RETRY_CONFIG.maxRetries + 1);
  });
});
