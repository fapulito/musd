/**
 * Unit tests for the error handler middleware.
 * Validates that PaymentGatewayError, AppError, and unexpected errors
 * produce the correct HTTP responses.
 */

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { Request, Response, NextFunction } from 'express';
import { errorHandler, AppError } from './errorHandler';
import { PaymentGatewayError, ErrorCode } from '../utils/errors';

function mockRes(): Response {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

const mockReq = { path: '/test', method: 'POST' } as Request;
const mockNext: NextFunction = jest.fn();

describe('errorHandler middleware', () => {
  it('handles PaymentGatewayError with correct status and user message', () => {
    const err = new PaymentGatewayError(
      ErrorCode.MINT_FAILED,
      'internal detail',
      'User-friendly message',
      true,
      { txId: '123' },
    );
    const res = mockRes();

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(502); // MINT_FAILED → 502
    expect(res.json).toHaveBeenCalledWith({
      status: 'error',
      code: ErrorCode.MINT_FAILED,
      message: 'User-friendly message',
      retryable: true,
    });
  });

  it('handles AppError with statusCode and message', () => {
    const err = new AppError(404, 'Not found');
    const res = mockRes();

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      status: 'error',
      message: 'Not found',
    });
  });

  it('handles unexpected errors with 500 and generic message', () => {
    const err = new Error('something broke');
    const res = mockRes();

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      status: 'error',
      message: 'Internal server error',
    });
  });

  it('does not leak internal details for PaymentGatewayError', () => {
    const err = new PaymentGatewayError(
      ErrorCode.STRIPE_API_ERROR,
      'Stripe returned 503 with body ...',
      'Temporary issue',
      true,
      { raw: 'secret' },
    );
    const res = mockRes();

    errorHandler(err, mockReq, res, mockNext);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.message).toBe('Temporary issue');
    expect(body).not.toHaveProperty('metadata');
    expect(body).not.toHaveProperty('stack');
  });

  it('maps STRIPE_PAYMENT_DECLINED to 402', () => {
    const err = new PaymentGatewayError(
      ErrorCode.STRIPE_PAYMENT_DECLINED,
      'declined',
      'Payment declined',
      false,
    );
    const res = mockRes();

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(402);
  });

  it('maps KYC_REQUIRED to 403', () => {
    const err = new PaymentGatewayError(
      ErrorCode.KYC_REQUIRED,
      'kyc needed',
      'Please verify identity',
      false,
    );
    const res = mockRes();

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
