/**
 * Refund service for handling failed deposits and withdrawals.
 * Requirement 8.1: Auto-refund when Stripe payment succeeds but MUSD minting fails.
 * Requirement 8.2: Restore MUSD balance when withdrawal fails.
 * Requirement 8.4: Retry failed blockchain transactions up to 3 times.
 */

import { stripe } from '../config/stripe.config';
import { logger } from '../utils/logger';
import { ErrorCode } from '../utils/errors';
import { withRetryForErrorCode, RetryResult } from '../utils/retry';
import { notificationService } from './notification.service';

export interface FailedDepositContext {
  transactionId: string;
  userId: string;
  userEmail?: string;
  stripePaymentId: string;
  walletAddress: string;
  amount: number; // fiat cents
  currency: string;
}

export interface FailedWithdrawalContext {
  transactionId: string;
  userId: string;
  userEmail?: string;
  musdAmount: number;
  walletAddress: string;
}

export interface RefundResult {
  refunded: boolean;
  stripeRefundId?: string;
  error?: string;
}

export interface BalanceRestoreResult {
  restored: boolean;
  error?: string;
}

export class RefundService {
  /**
   * Handle a failed deposit: retry minting, then refund via Stripe if all retries fail.
   * Requirement 8.1, 8.4
   *
   * @param ctx       Context about the failed deposit.
   * @param mintFn    The async function that attempts to mint MUSD.
   * @param delayFn   Injectable delay (for testing).
   */
  async handleFailedDeposit(
    ctx: FailedDepositContext,
    mintFn: () => Promise<void>,
    delayFn?: (ms: number) => Promise<void>,
  ): Promise<RefundResult> {
    logger.info('Handling failed deposit — attempting retries', {
      transactionId: ctx.transactionId,
      stripePaymentId: ctx.stripePaymentId,
    });

    // Retry minting with the MINT_FAILED config (3 retries, exponential backoff)
    const retryResult: RetryResult<void> = await withRetryForErrorCode(
      mintFn,
      ErrorCode.MINT_FAILED,
      `mint MUSD for deposit ${ctx.transactionId}`,
      delayFn,
    );

    if (retryResult.success) {
      logger.info('Mint succeeded after retry', {
        transactionId: ctx.transactionId,
        attempts: retryResult.attempts,
      });
      return { refunded: false };
    }

    // All retries exhausted — initiate Stripe refund (Req 8.1)
    logger.warn('All mint retries exhausted, initiating Stripe refund', {
      transactionId: ctx.transactionId,
      stripePaymentId: ctx.stripePaymentId,
      attempts: retryResult.attempts,
    });

    return this.initiateStripeRefund(ctx);
  }

  /**
   * Initiate a Stripe refund for a failed deposit.
   * Requirement 8.1
   */
  async initiateStripeRefund(ctx: FailedDepositContext): Promise<RefundResult> {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: ctx.stripePaymentId,
        reason: 'requested_by_customer',
        metadata: {
          transactionId: ctx.transactionId,
          reason: 'musd_mint_failed',
        },
      });

      logger.info('Stripe refund initiated', {
        transactionId: ctx.transactionId,
        stripeRefundId: refund.id,
        amount: ctx.amount,
        currency: ctx.currency,
      });

      // Notify user (Req 8.3)
      const message = notificationService.buildFailureMessage('deposit', 'refunded');
      await notificationService.notifyTransactionFailure({
        userId: ctx.userId,
        email: ctx.userEmail,
        transactionId: ctx.transactionId,
        transactionType: 'deposit',
        status: 'refunded',
        message,
        channels: ['email', 'in_app'],
      });

      return { refunded: true, stripeRefundId: refund.id };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to initiate Stripe refund', {
        transactionId: ctx.transactionId,
        stripePaymentId: ctx.stripePaymentId,
        error: errorMsg,
      });

      // Still notify user about the failure (Req 8.3)
      const message = notificationService.buildFailureMessage('deposit', 'failed');
      await notificationService.notifyTransactionFailure({
        userId: ctx.userId,
        email: ctx.userEmail,
        transactionId: ctx.transactionId,
        transactionType: 'deposit',
        status: 'failed',
        message,
        channels: ['email', 'in_app'],
      });

      return { refunded: false, error: errorMsg };
    }
  }

  /**
   * Handle a failed withdrawal by restoring the user's MUSD balance.
   * Requirement 8.2
   *
   * @param ctx         Context about the failed withdrawal.
   * @param restoreFn   The async function that restores the MUSD balance.
   * @param delayFn     Injectable delay (for testing).
   */
  async handleFailedWithdrawal(
    ctx: FailedWithdrawalContext,
    restoreFn: () => Promise<void>,
    delayFn?: (ms: number) => Promise<void>,
  ): Promise<BalanceRestoreResult> {
    logger.info('Handling failed withdrawal — attempting balance restore', {
      transactionId: ctx.transactionId,
      musdAmount: ctx.musdAmount,
    });

    // Retry the balance restore with BURN_FAILED config
    const retryResult = await withRetryForErrorCode(
      restoreFn,
      ErrorCode.BURN_FAILED,
      `restore MUSD balance for withdrawal ${ctx.transactionId}`,
      delayFn,
    );

    if (retryResult.success) {
      logger.info('MUSD balance restored', {
        transactionId: ctx.transactionId,
        musdAmount: ctx.musdAmount,
        attempts: retryResult.attempts,
      });

      // Notify user (Req 8.3)
      const message = notificationService.buildFailureMessage('withdrawal', 'balance_restored');
      await notificationService.notifyTransactionFailure({
        userId: ctx.userId,
        email: ctx.userEmail,
        transactionId: ctx.transactionId,
        transactionType: 'withdrawal',
        status: 'balance_restored',
        message,
        channels: ['email', 'in_app'],
      });

      return { restored: true };
    }

    const errorMsg = retryResult.error?.message ?? 'Unknown error';
    logger.error('Failed to restore MUSD balance after retries', {
      transactionId: ctx.transactionId,
      error: errorMsg,
    });

    // Notify user about unresolved failure (Req 8.3, 8.5)
    const message = notificationService.buildFailureMessage('withdrawal', 'failed');
    await notificationService.notifyTransactionFailure({
      userId: ctx.userId,
      email: ctx.userEmail,
      transactionId: ctx.transactionId,
      transactionType: 'withdrawal',
      status: 'failed',
      message,
      channels: ['email', 'in_app'],
    });

    return { restored: false, error: errorMsg };
  }
}

export const refundService = new RefundService();
