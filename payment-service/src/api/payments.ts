import { Router, Request, Response, NextFunction } from 'express';
import { paymentService } from '../services/payment.service';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/v1/payments/intents
 * Create a new stablecoin payment intent (MUSD → Fiat)
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */
router.post(
  '/intents',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { amount, currency, walletAddress, metadata } = req.body;

      if (!amount || typeof amount !== 'number') {
        throw new AppError(400, 'amount is required and must be a number (in cents)');
      }

      if (!currency) {
        throw new AppError(400, 'currency is required');
      }

      if (!walletAddress) {
        throw new AppError(400, 'walletAddress is required');
      }

      const result = await paymentService.createPaymentIntent({
        amount,
        currency,
        walletAddress,
        metadata,
      });

      logger.info('Payment intent created', {
        paymentIntentId: result.paymentIntentId,
        amount,
        currency,
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
 * GET /api/v1/payments/intents/:id
 * Get payment intent status
 */
router.get(
  '/intents/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;

      const paymentIntent = await paymentService.getPaymentIntent(id);

      res.json({
        success: true,
        data: {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          musdAmount: paymentIntent.musdAmount,
          musdNetwork: paymentIntent.musdNetwork,
          settlementAddress: paymentIntent.settlementAddress,
          txHash: paymentIntent.txHash,
          errorMessage: paymentIntent.errorMessage,
          createdAt: paymentIntent.createdAt,
          succeededAt: paymentIntent.succeededAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/payments/history
 * Get user's payment history
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

      const result = await paymentService.getUserPaymentIntents(walletAddress, page, limit);

      res.json({
        success: true,
        data: {
          paymentIntents: result.paymentIntents,
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
