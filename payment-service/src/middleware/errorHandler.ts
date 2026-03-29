import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { PaymentGatewayError, getHttpStatus } from '../utils/errors';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export const errorHandler = (
  err: Error | AppError | PaymentGatewayError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  // PaymentGatewayError — structured payment/blockchain errors
  if (err instanceof PaymentGatewayError) {
    logger.error('Payment gateway error:', {
      code: err.code,
      message: err.message,
      userMessage: err.userMessage,
      retryable: err.retryable,
      metadata: err.metadata,
      path: req.path,
      method: req.method,
    });

    return res.status(getHttpStatus(err.code)).json({
      status: 'error',
      code: err.code,
      message: err.userMessage,
      retryable: err.retryable,
    });
  }

  // AppError — general application errors (existing pattern)
  if (err instanceof AppError) {
    logger.error('Application error:', {
      statusCode: err.statusCode,
      message: err.message,
      path: req.path,
      method: req.method,
    });

    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
    });
  }

  // Unexpected errors — never leak internals to the client
  logger.error('Unexpected error:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  return res.status(500).json({
    status: 'error',
    message: 'Internal server error',
  });
};
