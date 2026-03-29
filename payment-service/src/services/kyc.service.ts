/**
 * KYC (Know Your Customer) compliance service.
 * Stripe handles KYC/AML automatically through the onramp widget,
 * but we enforce daily transaction limits and track verification status.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { AppDataSource } from '../config/database';
import { User } from '../models/User';
import { OnrampSession } from '../models/OnrampSession';
import { PaymentIntent } from '../models/PaymentIntent';
import { Payout } from '../models/Payout';
import { logger } from '../utils/logger';
import { notificationService } from './notification.service';
import {
  kycRequired,
  kycFailed,
  dailyLimitExceeded,
  PaymentGatewayError,
  ErrorCode,
} from '../utils/errors';

/** Daily transaction threshold (in USD) that triggers KYC requirement */
export const KYC_THRESHOLD = 1000;

export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface KycCheckResult {
  allowed: boolean;
  kycStatus: KycStatus;
  dailyTotal: number;
  remainingBeforeKyc: number;
  requiresVerification: boolean;
}

export interface VerificationSession {
  sessionId: string;
  url: string;
  status: string;
}

export class KycService {
  private userRepository = AppDataSource.getRepository(User);
  private onrampRepo = AppDataSource.getRepository(OnrampSession);
  private paymentRepo = AppDataSource.getRepository(PaymentIntent);
  private payoutRepo = AppDataSource.getRepository(Payout);

  /**
   * Check whether a transaction is allowed given the user's KYC status
   * and their rolling 24-hour transaction volume.
   *
   * Requirement 6.1: Deposits > $1,000/24h require identity verification
   * Requirement 6.2: Withdrawals > $1,000/24h require identity verification
   * Requirement 6.5: Reject transactions exceeding $1,000 for unverified users
   */
  async checkTransactionAllowed(
    userId: string,
    amountUsd: number,
    type: 'deposit' | 'withdrawal',
  ): Promise<KycCheckResult> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new PaymentGatewayError(
        ErrorCode.KYC_REQUIRED,
        'User not found',
        'Unable to verify your identity. Please try again.',
        false,
        { userId },
      );
    }

    const kycStatus = (user.kycStatus || 'unverified') as KycStatus;

    // Verified users have no limit enforcement
    if (kycStatus === 'verified') {
      return {
        allowed: true,
        kycStatus,
        dailyTotal: 0,
        remainingBeforeKyc: Infinity,
        requiresVerification: false,
      };
    }

    // Rejected users cannot transact above threshold at all
    if (kycStatus === 'rejected') {
      const dailyTotal = await this.getDailyTransactionTotal(userId, type);
      if (dailyTotal + amountUsd > KYC_THRESHOLD) {
        throw kycFailed({ userId, dailyTotal, amountUsd, type });
      }
    }

    const dailyTotal = await this.getDailyTransactionTotal(userId, type);
    const projectedTotal = dailyTotal + amountUsd;
    const remaining = Math.max(KYC_THRESHOLD - dailyTotal, 0);
    const requiresVerification = projectedTotal > KYC_THRESHOLD;

    if (requiresVerification) {
      throw kycRequired({
        userId,
        dailyTotal,
        amountUsd,
        projectedTotal,
        type,
        threshold: KYC_THRESHOLD,
      });
    }

    return {
      allowed: true,
      kycStatus,
      dailyTotal,
      remainingBeforeKyc: remaining,
      requiresVerification: false,
    };
  }

  /**
   * Calculate the user's total transaction volume in the last 24 hours.
   */
  async getDailyTransactionTotal(
    userId: string,
    type: 'deposit' | 'withdrawal',
  ): Promise<number> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let total = 0;

    if (type === 'deposit') {
      // Sum completed onramp sessions in the last 24h
      const result = await this.onrampRepo
        .createQueryBuilder('o')
        .select('COALESCE(SUM(o.source_amount), 0)', 'total')
        .where('o.user_id = :userId', { userId })
        .andWhere('o.created_at >= :since', { since })
        .andWhere('o.status IN (:...statuses)', {
          statuses: ['initialized', 'pending', 'completed'],
        })
        .getRawOne();
      total = parseFloat(result?.total || '0');
    } else {
      // Sum payment intents + payouts in the last 24h
      const paymentResult = await this.paymentRepo
        .createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'total')
        .where('p.user_id = :userId', { userId })
        .andWhere('p.created_at >= :since', { since })
        .andWhere('p.status NOT IN (:...excluded)', {
          excluded: ['canceled'],
        })
        .getRawOne();

      const payoutResult = await this.payoutRepo
        .createQueryBuilder('po')
        .select('COALESCE(SUM(po.amount), 0)', 'total')
        .where('po.user_id = :userId', { userId })
        .andWhere('po.created_at >= :since', { since })
        .andWhere('po.status NOT IN (:...excluded)', {
          excluded: ['canceled'],
        })
        .getRawOne();

      // Payment amounts are stored in cents, convert to dollars
      const paymentTotal = parseFloat(paymentResult?.total || '0') / 100;
      const payoutTotal = parseFloat(payoutResult?.total || '0') / 100;
      total = paymentTotal + payoutTotal;
    }

    return total;
  }

  /**
   * Get the current KYC status for a user.
   * Requirement 6.4: Store verification status
   */
  async getKycStatus(userId: string): Promise<{
    status: KycStatus;
    verifiedAt: Date | null;
    dailyDepositTotal: number;
    dailyWithdrawalTotal: number;
    threshold: number;
  }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new PaymentGatewayError(
        ErrorCode.KYC_REQUIRED,
        'User not found',
        'User account not found.',
        false,
        { userId },
      );
    }

    const dailyDepositTotal = await this.getDailyTransactionTotal(userId, 'deposit');
    const dailyWithdrawalTotal = await this.getDailyTransactionTotal(userId, 'withdrawal');

    return {
      status: (user.kycStatus || 'unverified') as KycStatus,
      verifiedAt: user.kycVerifiedAt || null,
      dailyDepositTotal,
      dailyWithdrawalTotal,
      threshold: KYC_THRESHOLD,
    };
  }

  /**
   * Create a Stripe Identity verification session.
   * Requirement 6.3: Integrate with Stripe Identity for verification processing
   *
   * Note: This is a placeholder. In production, this calls the Stripe Identity API
   * to create a VerificationSession. Stripe handles the actual KYC process.
   */
  async createVerificationSession(userId: string): Promise<VerificationSession> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new PaymentGatewayError(
        ErrorCode.KYC_REQUIRED,
        'User not found',
        'User account not found.',
        false,
        { userId },
      );
    }

    if (user.kycStatus === 'verified') {
      return {
        sessionId: user.stripeIdentitySessionId || '',
        url: '',
        status: 'verified',
      };
    }

    // Placeholder: In production, call Stripe Identity API
    // const session = await stripe.identity.verificationSessions.create({
    //   type: 'document',
    //   metadata: { userId: user.id, walletAddress: user.walletAddress },
    // });

    const placeholderSessionId = `vs_placeholder_${Date.now()}`;

    user.kycStatus = 'pending';
    user.stripeIdentitySessionId = placeholderSessionId;
    await this.userRepository.save(user);

    logger.info('Created KYC verification session', {
      userId,
      sessionId: placeholderSessionId,
    });

    return {
      sessionId: placeholderSessionId,
      url: `https://verify.stripe.com/start/${placeholderSessionId}`,
      status: 'pending',
    };
  }

  /**
   * Handle Stripe Identity webhook events.
   * Requirement 6.3, 6.4: Process verification results from Stripe Identity
   */
  async handleIdentityWebhook(
    eventType: string,
    sessionData: { id: string; status: string; metadata?: Record<string, string> },
  ): Promise<void> {
    const userId = sessionData.metadata?.userId;
    if (!userId) {
      logger.warn('Identity webhook missing userId in metadata', {
        sessionId: sessionData.id,
      });
      return;
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      logger.warn('User not found for identity webhook', { userId });
      return;
    }

    switch (eventType) {
      case 'identity.verification_session.verified':
        user.kycStatus = 'verified';
        user.kycVerifiedAt = new Date();
        logger.info('KYC verification completed', { userId });

        // Send KYC completion notification
        await notificationService.notifyTransactionFailure({
          userId,
          email: user.email,
          transactionId: sessionData.id,
          transactionType: 'deposit',
          status: 'refunded', // reusing type for "success" notification
          message: 'Your identity verification is complete. You can now make transactions above $1,000.',
          channels: ['email', 'in_app'],
        });
        break;

      case 'identity.verification_session.requires_input':
        user.kycStatus = 'pending';
        logger.info('KYC verification requires additional input', { userId });
        break;

      case 'identity.verification_session.canceled':
        user.kycStatus = 'unverified';
        logger.info('KYC verification canceled', { userId });
        break;

      default:
        // Treat unknown terminal states as rejected
        if (sessionData.status === 'requires_input') {
          user.kycStatus = 'pending';
        } else {
          user.kycStatus = 'rejected';
          logger.warn('KYC verification failed/rejected', {
            userId,
            eventType,
            status: sessionData.status,
          });
        }
        break;
    }

    await this.userRepository.save(user);
  }

  /**
   * Update KYC status directly (for admin or testing purposes).
   * Requirement 6.4
   */
  async updateKycStatus(userId: string, status: KycStatus): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new PaymentGatewayError(
        ErrorCode.KYC_REQUIRED,
        'User not found',
        'User account not found.',
        false,
        { userId },
      );
    }

    user.kycStatus = status;
    if (status === 'verified') {
      user.kycVerifiedAt = new Date();
    }

    await this.userRepository.save(user);

    logger.info('KYC status updated', { userId, status });
  }
}

export const kycService = new KycService();
