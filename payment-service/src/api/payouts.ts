import { Router, Request, Response, NextFunction } from 'express';
import { payoutService } from '../services/payout.service';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/v1/payouts
 * Create a new stablecoin payout (Fiat → MUSD)
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */
router.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { amount, currency, destinationAddress, connectedAccountId } = req.body;

      if (!amount || typeof amount !== 'number') {
        throw new AppError(400, 'amount is required and must be a number (in cents)');
      }

      if (!currency) {
        throw new AppError(400, 'currency is required');
      }

      if (!destinationAddress) {
        throw new AppError(400, 'destinationAddress is required');
      }

      const result = await payoutService.createPayout({
        amount,
        currency,
        destinationAddress,
        connectedAccountId,
      });

      logger.info('Payout created', {
        payoutId: result.payoutId,
        amount,
        currency,
        destinationAddress,
      });

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/payouts/:id
 * Get payout status and details
 */
router.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const payout = await payoutService.getPayout(id);

      res.json({
        success: true,
        data: {
          id: payout.id,
          status: payout.status,
          amount: payout.amount,
          currency: payout.currency,
          musdAmount: payout.musdAmount,
          destinationAddress: payout.destinationAddress,
          destinationNetwork: payout.destinationNetwork,
          txHash: payout.txHash,
          blockNumber: payout.blockNumber,
          connectedAccountId: payout.connectedAccountId,
          estimatedArrival: payout.estimatedArrival,
          errorMessage: payout.errorMessage,
          createdAt: payout.createdAt,
          paidAt: payout.paidAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/payouts/history
 * Get payout history by wallet address
 */
router.get(
  '/history',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const walletAddress = req.query.walletAddress as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      if (!walletAddress) {
        throw new AppError(400, 'walletAddress query parameter is required');
      }

      const result = await payoutService.getUserPayouts(walletAddress, page, limit);

      res.json({
        success: true,
        data: {
          payouts: result.payouts,
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
  }
);

export default router;
