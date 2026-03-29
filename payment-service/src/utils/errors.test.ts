/**
 * Unit tests for PaymentGatewayError, ErrorCode, and factory functions.
 * Validates Requirements 8.1-8.5
 */

import {
  PaymentGatewayError,
  ErrorCode,
  getHttpStatus,
  stripePaymentDeclined,
  stripeApiError,
  mintFailed,
  burnFailed,
  insufficientGas,
  kycRequired,
  kycFailed,
  insufficientBalance,
  dailyLimitExceeded,
  amountTooLow,
  reserveRatioLow,
} from './errors';

describe('PaymentGatewayError', () => {
  it('extends Error and carries code, userMessage, retryable, metadata', () => {
    const err = new PaymentGatewayError(
      ErrorCode.MINT_FAILED,
      'internal msg',
      'user msg',
      true,
      { txId: '123' },
    );

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(PaymentGatewayError);
    expect(err.name).toBe('PaymentGatewayError');
    expect(err.code).toBe(ErrorCode.MINT_FAILED);
    expect(err.message).toBe('internal msg');
    expect(err.userMessage).toBe('user msg');
    expect(err.retryable).toBe(true);
    expect(err.metadata).toEqual({ txId: '123' });
  });
});

describe('getHttpStatus', () => {
  it('maps each ErrorCode to the expected HTTP status', () => {
    expect(getHttpStatus(ErrorCode.STRIPE_PAYMENT_DECLINED)).toBe(402);
    expect(getHttpStatus(ErrorCode.STRIPE_API_ERROR)).toBe(502);
    expect(getHttpStatus(ErrorCode.MINT_FAILED)).toBe(502);
    expect(getHttpStatus(ErrorCode.BURN_FAILED)).toBe(502);
    expect(getHttpStatus(ErrorCode.INSUFFICIENT_GAS)).toBe(502);
    expect(getHttpStatus(ErrorCode.KYC_REQUIRED)).toBe(403);
    expect(getHttpStatus(ErrorCode.KYC_FAILED)).toBe(403);
    expect(getHttpStatus(ErrorCode.INSUFFICIENT_BALANCE)).toBe(400);
    expect(getHttpStatus(ErrorCode.DAILY_LIMIT_EXCEEDED)).toBe(429);
    expect(getHttpStatus(ErrorCode.AMOUNT_TOO_LOW)).toBe(400);
    expect(getHttpStatus(ErrorCode.RESERVE_RATIO_LOW)).toBe(503);
  });
});

describe('Factory functions', () => {
  const factories = [
    { fn: stripePaymentDeclined, code: ErrorCode.STRIPE_PAYMENT_DECLINED, retryable: false },
    { fn: stripeApiError, code: ErrorCode.STRIPE_API_ERROR, retryable: true },
    { fn: mintFailed, code: ErrorCode.MINT_FAILED, retryable: true },
    { fn: burnFailed, code: ErrorCode.BURN_FAILED, retryable: true },
    { fn: insufficientGas, code: ErrorCode.INSUFFICIENT_GAS, retryable: true },
    { fn: kycRequired, code: ErrorCode.KYC_REQUIRED, retryable: false },
    { fn: kycFailed, code: ErrorCode.KYC_FAILED, retryable: false },
    { fn: insufficientBalance, code: ErrorCode.INSUFFICIENT_BALANCE, retryable: false },
    { fn: dailyLimitExceeded, code: ErrorCode.DAILY_LIMIT_EXCEEDED, retryable: false },
    { fn: amountTooLow, code: ErrorCode.AMOUNT_TOO_LOW, retryable: false },
    { fn: reserveRatioLow, code: ErrorCode.RESERVE_RATIO_LOW, retryable: false },
  ];

  it.each(factories)(
    '$code factory produces correct error',
    ({ fn, code, retryable }) => {
      const err = fn({ extra: 'data' });
      expect(err).toBeInstanceOf(PaymentGatewayError);
      expect(err.code).toBe(code);
      expect(err.retryable).toBe(retryable);
      expect(err.userMessage).toBeTruthy();
      expect(err.metadata).toEqual({ extra: 'data' });
    },
  );
});
