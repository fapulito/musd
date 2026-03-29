import { Router, Request, Response, NextFunction } from 'express';
import { feeService, type TransactionType } from '../services/fee.service';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

const VALID_TRANSACTION_TYPES: TransactionType[] = [
  'deposit',
  'withdrawal',
  'stablecoin_payment',
];

/**
 * GET /api/v1/fees/estimate
 *
 * Returns a fee breakdown for the given amount and transaction type.
 * Implements Requirements 7.1-7.4.
 *
 * Query params:
 *   amount           – numeric, required
 *   currency         – string, optional (default: usd)
 *   transactionType  – 'deposit' | 'withdrawal' | 'stablecoin_payment', required
 */
router.get(
  '/estimate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { amount, currency = 'usd', transactionType } = req.query;

      if (!amount) {
        throw new AppError(400, 'amount is required');
      }

      if (!transactionType) {
        throw new AppError(400, 'transactionType is required');
      }

      const parsedAmount = parseFloat(amount as string);
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        throw new AppError(400, 'amount must be a non-negative number');
      }

      const txType = transactionType as TransactionType;
      if (!VALID_TRANSACTION_TYPES.includes(txType)) {
        throw new AppError(
          400,
          `transactionType must be one of: ${VALID_TRANSACTION_TYPES.join(', ')}`,
        );
      }

      const breakdown = feeService.calculateFees(
        parsedAmount,
        txType,
        (currency as string).toLowerCase(),
      );

      logger.info('Fee estimate calculated', {
        amount: parsedAmount,
        transactionType: txType,
        totalFee: breakdown.totalFee,
      });

      res.json({
        success: true,
        data: breakdown,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/fees/compare
 *
 * Compare fees across all payment methods for a given amount.
 * Implements Requirement 7.4: fee comparison between payment methods.
 *
 * Query params:
 *   amount   – numeric, required
 *   currency – string, optional (default: usd)
 */
router.get(
  '/compare',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { amount, currency = 'usd' } = req.query;

      if (!amount) {
        throw new AppError(400, 'amount is required');
      }

      const parsedAmount = parseFloat(amount as string);
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        throw new AppError(400, 'amount must be a non-negative number');
      }

      const comparison = feeService.compareFees(
        parsedAmount,
        (currency as string).toLowerCase(),
      );

      res.json({
        success: true,
        data: comparison,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
