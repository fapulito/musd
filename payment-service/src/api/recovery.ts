import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { ErrorCode, PaymentGatewayError } from '../utils/errors';
import { withRetryForErrorCode, RetryResult } from '../utils/retry';
import { refundService } from '../services/refund.service';
import { notificationService } from '../services/notification.service';

const router = Router();

/**
 * In-memory recovery status store.
 * In production this would be backed by the database.
 */
export interface RecoveryRecord {
  transactionId: string;
  action: 'retry' | 'refund';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  message: string;
  createdAt: string;
  updatedAt: string;
}

const recoveryStore = new Map<string, RecoveryRecord>();

/** Helper to upsert a recovery record */
function upsertRecovery(
  transactionId: string,
  action: 'retry' | 'refund',
  status: RecoveryRecord['status'],
  message: string,
): RecoveryRecord {
  const now = new Date().toISOString();
  const existing = recoveryStore.get(transactionId);
  const record: RecoveryRecord = {
    transactionId,
    action,
    status,
    message,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  recoveryStore.set(transactionId, record);
  return record;
}

/**
 * POST /api/v1/recovery/retry/:transactionId
 * Retry a failed transaction.
 * Requirements: 8.2, 8.3 — retry failed blockchain transactions, notify user.
 */
router.post(
  '/retry/:transactionId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { transactionId } = req.params;

      if (!transactionId) {
        throw new AppError(400, 'transactionId is required');
      }

      // Check if a recovery is already in progress
      const existing = recoveryStore.get(transactionId);
      if (existing && existing.status === 'processing') {
        return res.status(409).json({
          success: false,
          message: 'A recovery operation is already in progress for this transaction.',
          data: existing,
        });
      }

      const record = upsertRecovery(transactionId, 'retry', 'processing', 'Retry in progress');

      logger.info('Recovery retry initiated', { transactionId });

      // Simulate retry via the retry utility.
      // In production this would look up the transaction from the DB and
      // re-execute the failed blockchain operation (mint / burn / etc.).
      const retryResult: RetryResult<void> = await withRetryForErrorCode(
        async () => {
          // Placeholder: the actual re-execution logic would go here,
          // e.g. re-attempt minting MUSD or re-submitting a payout.
          logger.info('Executing retry attempt for transaction', { transactionId });
        },
        ErrorCode.MINT_FAILED,
        `retry transaction ${transactionId}`,
      );

      if (retryResult.success) {
        upsertRecovery(transactionId, 'retry', 'completed', 'Transaction retried successfully');
        logger.info('Recovery retry succeeded', { transactionId, attempts: retryResult.attempts });

        return res.json({
          success: true,
          data: {
            transactionId,
            status: 'completed',
            message: 'Transaction retried successfully.',
            attempts: retryResult.attempts,
          },
        });
      }

      // Retry exhausted
      upsertRecovery(
        transactionId,
        'retry',
        'failed',
        retryResult.error?.message ?? 'Retry failed after maximum attempts',
      );

      logger.warn('Recovery retry exhausted', {
        transactionId,
        attempts: retryResult.attempts,
        error: retryResult.error?.message,
      });

      return res.status(502).json({
        success: false,
        message: 'Transaction retry failed after maximum attempts. Please request a refund or contact support.',
        data: {
          transactionId,
          status: 'failed',
          attempts: retryResult.attempts,
          supportEmail: 'support@mezo.org',
          supportUrl: 'https://mezo.org/support',
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/recovery/refund/:transactionId
 * Request a manual refund for a non-retryable failed deposit.
 * Requirements: 8.2, 8.5 — restore balance / refund, provide support contact.
 */
router.post(
  '/refund/:transactionId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { transactionId } = req.params;
      const { reason } = req.body;

      if (!transactionId) {
        throw new AppError(400, 'transactionId is required');
      }

      // Check if a recovery is already in progress
      const existing = recoveryStore.get(transactionId);
      if (existing && existing.status === 'processing') {
        return res.status(409).json({
          success: false,
          message: 'A recovery operation is already in progress for this transaction.',
          data: existing,
        });
      }

      upsertRecovery(transactionId, 'refund', 'processing', 'Refund request submitted');

      logger.info('Manual refund requested', { transactionId, reason });

      // In production this would look up the Stripe payment ID from the DB
      // and call refundService.initiateStripeRefund(). For now we record the
      // request so it can be processed by the admin / support team.
      upsertRecovery(
        transactionId,
        'refund',
        'pending',
        'Refund request received. Our team will review and process your refund within 5-10 business days.',
      );

      // Notify user about the refund request (Req 8.3)
      await notificationService.notifyTransactionFailure({
        userId: 'unknown', // In production, resolved from the transaction record
        transactionId,
        transactionType: 'deposit',
        status: 'refunded',
        message: notificationService.buildFailureMessage('deposit', 'refunded'),
        channels: ['in_app'],
      });

      logger.info('Refund request recorded', { transactionId });

      res.status(202).json({
        success: true,
        data: {
          transactionId,
          status: 'pending',
          message: 'Refund request received. Our team will review and process your refund within 5-10 business days.',
          supportEmail: 'support@mezo.org',
          supportUrl: 'https://mezo.org/support',
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /api/v1/recovery/status/:transactionId
 * Get the current recovery status for a transaction.
 * Requirements: 8.3 — keep user informed of recovery progress.
 */
router.get(
  '/status/:transactionId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { transactionId } = req.params;

      if (!transactionId) {
        throw new AppError(400, 'transactionId is required');
      }

      const record = recoveryStore.get(transactionId);

      if (!record) {
        return res.status(404).json({
          success: false,
          message: 'No recovery record found for this transaction.',
        });
      }

      res.json({
        success: true,
        data: {
          transactionId: record.transactionId,
          action: record.action,
          status: record.status,
          message: record.message,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          supportEmail: 'support@mezo.org',
          supportUrl: 'https://mezo.org/support',
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;

/** Exported for testing */
export { recoveryStore };
