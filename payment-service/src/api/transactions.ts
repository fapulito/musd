import { Router, Request, Response, NextFunction } from 'express';
import { transactionService } from '../services/transaction.service';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/v1/transactions
 * Fetch unified transaction history with pagination and filtering.
 * Requirements: 5.1, 5.2, 5.3
 */
router.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const walletAddress = req.query.walletAddress as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
      const type = req.query.type as 'onramp' | 'payment' | 'payout' | undefined;
      const status = req.query.status as string | undefined;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      if (!walletAddress) {
        throw new AppError(400, 'walletAddress query parameter is required');
      }

      if (type && !['onramp', 'payment', 'payout'].includes(type)) {
        throw new AppError(400, 'type must be one of: onramp, payment, payout');
      }

      const result = await transactionService.getTransactions({
        walletAddress,
        page,
        limit,
        type,
        status,
        startDate,
        endDate,
      });

      logger.info('Transaction history fetched', {
        walletAddress,
        page,
        limit,
        total: result.total,
      });

      res.json({
        success: true,
        data: {
          transactions: result.transactions,
          total: result.total,
          hasMore: result.hasMore,
          pagination: {
            page,
            limit,
            total: result.total,
            pages: Math.ceil(result.total / limit),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/transactions/export
 * Export transaction history as CSV file.
 * Requirements: 5.4
 */
router.get(
  '/export',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const walletAddress = req.query.walletAddress as string;
      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      if (!walletAddress) {
        throw new AppError(400, 'walletAddress query parameter is required');
      }

      const csv = await transactionService.exportTransactionsCSV(
        walletAddress,
        startDate,
        endDate,
      );

      logger.info('Transaction CSV exported', { walletAddress, startDate, endDate });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="transactions_${walletAddress.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send(csv);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
