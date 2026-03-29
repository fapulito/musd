/**
 * Generic retry utility with exponential backoff.
 * Requirement 8.4: Retry failed blockchain transactions up to 3 times.
 */

import { logger } from './logger';
import { ErrorCode } from './errors';

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;   // ms
  maxDelay: number;        // ms
  backoffMultiplier: number;
}

/** Per-error-code retry configurations from the design doc */
export const RETRY_CONFIGS: Record<string, RetryConfig> = {
  [ErrorCode.MINT_FAILED]: {
    maxRetries: 3,
    initialDelay: 5000,
    maxDelay: 60000,
    backoffMultiplier: 2,
  },
  [ErrorCode.BURN_FAILED]: {
    maxRetries: 3,
    initialDelay: 5000,
    maxDelay: 60000,
    backoffMultiplier: 2,
  },
  [ErrorCode.STRIPE_API_ERROR]: {
    maxRetries: 2,
    initialDelay: 2000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  },
};

/** Default config used when no error-code-specific config exists */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

/**
 * Result of a retry-wrapped operation.
 * On success `data` is populated; on exhaustion `error` holds the last failure.
 */
export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
}

/**
 * Sleep helper that can be overridden in tests.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate the delay for a given attempt using exponential backoff,
 * clamped to `config.maxDelay`.
 */
export function calculateDelay(attempt: number, config: RetryConfig): number {
  const raw = config.initialDelay * Math.pow(config.backoffMultiplier, attempt);
  return Math.min(raw, config.maxDelay);
}

/**
 * Execute `fn` with retry logic.
 *
 * @param fn          The async operation to attempt.
 * @param config      Retry configuration (delays, max retries, backoff).
 * @param context     Human-readable label used in log messages.
 * @param delayFn     Injectable delay function (defaults to real setTimeout).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  context: string = 'operation',
  delayFn: (ms: number) => Promise<void> = delay,
): Promise<RetryResult<T>> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const data = await fn();
      if (attempt > 0) {
        logger.info(`${context} succeeded after ${attempt + 1} attempts`);
      }
      return { success: true, data, attempts: attempt + 1 };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      logger.warn(`${context} failed (attempt ${attempt + 1}/${config.maxRetries + 1})`, {
        error: lastError.message,
        attempt: attempt + 1,
        maxAttempts: config.maxRetries + 1,
      });

      // Don't delay after the last attempt
      if (attempt < config.maxRetries) {
        const waitMs = calculateDelay(attempt, config);
        logger.info(`${context}: retrying in ${waitMs}ms`);
        await delayFn(waitMs);
      }
    }
  }

  logger.error(`${context} failed after ${config.maxRetries + 1} attempts`, {
    error: lastError?.message,
  });

  return { success: false, error: lastError, attempts: config.maxRetries + 1 };
}

/**
 * Convenience wrapper that picks the retry config for a given ErrorCode.
 */
export async function withRetryForErrorCode<T>(
  fn: () => Promise<T>,
  errorCode: string,
  context: string = 'operation',
  delayFn?: (ms: number) => Promise<void>,
): Promise<RetryResult<T>> {
  const cfg = RETRY_CONFIGS[errorCode] ?? DEFAULT_RETRY_CONFIG;
  return withRetry(fn, cfg, context, delayFn);
}
