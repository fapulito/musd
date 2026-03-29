/**
 * Centralized error definitions for the payment gateway.
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

/**
 * Error codes covering Stripe, blockchain, KYC, and business logic failures.
 */
export enum ErrorCode {
  // Stripe errors
  STRIPE_PAYMENT_DECLINED = 'STRIPE_PAYMENT_DECLINED',
  STRIPE_API_ERROR = 'STRIPE_API_ERROR',

  // Blockchain errors
  MINT_FAILED = 'MINT_FAILED',
  BURN_FAILED = 'BURN_FAILED',
  INSUFFICIENT_GAS = 'INSUFFICIENT_GAS',

  // KYC errors
  KYC_REQUIRED = 'KYC_REQUIRED',
  KYC_FAILED = 'KYC_FAILED',

  // Business logic errors
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  DAILY_LIMIT_EXCEEDED = 'DAILY_LIMIT_EXCEEDED',
  AMOUNT_TOO_LOW = 'AMOUNT_TOO_LOW',
  RESERVE_RATIO_LOW = 'RESERVE_RATIO_LOW',
}

/**
 * Extended error class for payment gateway operations.
 * Carries a machine-readable code, a user-friendly message,
 * a retryable flag, and optional metadata for logging/debugging.
 */
export class PaymentGatewayError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public userMessage: string,
    public retryable: boolean,
    public metadata?: Record<string, any>,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
    Object.setPrototypeOf(this, PaymentGatewayError.prototype);
  }
}

/** HTTP status code mapping for each error code */
const STATUS_MAP: Record<ErrorCode, number> = {
  [ErrorCode.STRIPE_PAYMENT_DECLINED]: 402,
  [ErrorCode.STRIPE_API_ERROR]: 502,
  [ErrorCode.MINT_FAILED]: 502,
  [ErrorCode.BURN_FAILED]: 502,
  [ErrorCode.INSUFFICIENT_GAS]: 502,
  [ErrorCode.KYC_REQUIRED]: 403,
  [ErrorCode.KYC_FAILED]: 403,
  [ErrorCode.INSUFFICIENT_BALANCE]: 400,
  [ErrorCode.DAILY_LIMIT_EXCEEDED]: 429,
  [ErrorCode.AMOUNT_TOO_LOW]: 400,
  [ErrorCode.RESERVE_RATIO_LOW]: 503,
};

/** Get the appropriate HTTP status code for a PaymentGatewayError */
export function getHttpStatus(code: ErrorCode): number {
  return STATUS_MAP[code] ?? 500;
}

// ── Factory helpers ────────────────────────────────────────────────

export function stripePaymentDeclined(metadata?: Record<string, any>): PaymentGatewayError {
  return new PaymentGatewayError(
    ErrorCode.STRIPE_PAYMENT_DECLINED,
    'Stripe payment was declined',
    'Your payment was declined. Please check your payment details and try again.',
    false,
    metadata,
  );
}

export function stripeApiError(metadata?: Record<string, any>): PaymentGatewayError {
  return new PaymentGatewayError(
    ErrorCode.STRIPE_API_ERROR,
    'Stripe API error',
    'We encountered a temporary issue processing your payment. Please try again shortly.',
    true,
    metadata,
  );
}

export function mintFailed(metadata?: Record<string, any>): PaymentGatewayError {
  return new PaymentGatewayError(
    ErrorCode.MINT_FAILED,
    'MUSD minting failed',
    'We were unable to complete your deposit. Our team is working on it and you will be refunded if the issue persists.',
    true,
    metadata,
  );
}

export function burnFailed(metadata?: Record<string, any>): PaymentGatewayError {
  return new PaymentGatewayError(
    ErrorCode.BURN_FAILED,
    'MUSD burn failed',
    'We were unable to process your withdrawal. Your MUSD balance has been restored.',
    true,
    metadata,
  );
}

export function insufficientGas(metadata?: Record<string, any>): PaymentGatewayError {
  return new PaymentGatewayError(
    ErrorCode.INSUFFICIENT_GAS,
    'Insufficient gas for blockchain transaction',
    'The transaction could not be completed due to network conditions. Please try again later.',
    true,
    metadata,
  );
}

export function kycRequired(metadata?: Record<string, any>): PaymentGatewayError {
  return new PaymentGatewayError(
    ErrorCode.KYC_REQUIRED,
    'KYC verification required',
    'Identity verification is required for this transaction. Please complete verification to proceed.',
    false,
    metadata,
  );
}

export function kycFailed(metadata?: Record<string, any>): PaymentGatewayError {
  return new PaymentGatewayError(
    ErrorCode.KYC_FAILED,
    'KYC verification failed',
    'Identity verification was unsuccessful. Please contact support for assistance.',
    false,
    metadata,
  );
}

export function insufficientBalance(metadata?: Record<string, any>): PaymentGatewayError {
  return new PaymentGatewayError(
    ErrorCode.INSUFFICIENT_BALANCE,
    'Insufficient MUSD balance',
    'You do not have enough MUSD to complete this transaction.',
    false,
    metadata,
  );
}

export function dailyLimitExceeded(metadata?: Record<string, any>): PaymentGatewayError {
  return new PaymentGatewayError(
    ErrorCode.DAILY_LIMIT_EXCEEDED,
    'Daily transaction limit exceeded',
    'You have reached your daily transaction limit. Please try again tomorrow or complete identity verification to increase your limit.',
    false,
    metadata,
  );
}

export function amountTooLow(metadata?: Record<string, any>): PaymentGatewayError {
  return new PaymentGatewayError(
    ErrorCode.AMOUNT_TOO_LOW,
    'Transaction amount too low',
    'The transaction amount is below the minimum required.',
    false,
    metadata,
  );
}

export function reserveRatioLow(metadata?: Record<string, any>): PaymentGatewayError {
  return new PaymentGatewayError(
    ErrorCode.RESERVE_RATIO_LOW,
    'Reserve ratio below threshold',
    'The service is temporarily unavailable. Please try again later.',
    false,
    metadata,
  );
}
