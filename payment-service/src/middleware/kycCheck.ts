/**
 * Express middleware that enforces KYC requirements before transaction endpoints.
 * Checks the user's daily transaction volume against the $1,000 threshold
 * and rejects requests from unverified users who would exceed it.
 *
 * Requirements: 6.1, 6.2, 6.5
 */

import { Request, Response, NextFunction } from 'express';
import { kycService, KYC_THRESHOLD } from '../services/kyc.service';
import { PaymentGatewayError, getHttpStatus } from '../utils/errors';
import { logger } from '../utils/logger';

export type TransactionDirection = 'deposit' | 'withdrawal';

/**
 * Factory that returns middleware for a given transaction direction.
 *
 * Usage:
 *   router.post('/sessions', kycCheck('deposit'), handler);
 *   router.post('/payouts',  kycCheck('withdrawal'), handler);
 *
 * The middleware reads the transaction amount from `req.body`:
 *   - `sourceAmount` (string, in USD) for deposits
 *   - `amount` (number, in cents) for withdrawals
 *
 * If the user is not authenticated (no `req.userId`), the middleware
 * passes through — authentication middleware should run first.
 */
export function kycCheck(direction: TransactionDirection) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId: string | undefined = (req as any).userId;

      // If no authenticated user, skip KYC check (auth middleware handles this)
      if (!userId) {
        return next();
      }

      // Extract amount in USD from the request body
      let amountUsd = 0;

      if (direction === 'deposit') {
        // Onramp sessions use sourceAmount (string, in USD)
        const raw = req.body.sourceAmount || req.body.destinationAmount;
        amountUsd = parseFloat(raw) || 0;
      } else {
        // Payments/payouts use amount (number, in cents)
        const raw = req.body.amount;
        amountUsd = typeof raw === 'number' ? raw / 100 : parseFloat(raw) / 100 || 0;
      }

      // Small transactions don't need KYC checks
      if (amountUsd <= 0) {
        return next();
      }

      await kycService.checkTransactionAllowed(userId, amountUsd, direction);

      // Transaction is allowed — continue
      next();
    } catch (error) {
      if (error instanceof PaymentGatewayError) {
        logger.warn('KYC check blocked transaction', {
          userId: (req as any).userId,
          code: error.code,
          direction,
          metadata: error.metadata,
        });

        res.status(getHttpStatus(error.code)).json({
          status: 'error',
          code: error.code,
          message: error.userMessage,
          retryable: error.retryable,
          kycRequired: true,
          threshold: KYC_THRESHOLD,
        });
        return;
      }

      next(error);
    }
  };
}
