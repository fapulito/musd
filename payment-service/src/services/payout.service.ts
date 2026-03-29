import { stripe } from '../config/stripe.config';
import { AppDataSource } from '../config/database';
import { Payout } from '../models/Payout';
import { User } from '../models/User';
import { stripeCryptoConfig, feeStructure } from '../config/stripe.config';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

export class PayoutService {
  private payoutRepository = AppDataSource.getRepository(Payout);
  private userRepository = AppDataSource.getRepository(User);

  /**
   * Create a new stablecoin payout (Fiat → MUSD)
   * Uses Stripe Connect Stablecoin Payouts (Private Preview)
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
   */
  async createPayout(params: {
    amount: number; // in cents
    currency: string;
    destinationAddress: string;
    connectedAccountId?: string;
  }): Promise<{
    payoutId: string;
    musdAmount: string;
    estimatedArrival: string;
  }> {
    try {
      const { amount, currency, destinationAddress, connectedAccountId } = params;

      // Validate inputs
      if (!amount || amount <= 0) {
        throw new AppError(400, 'Amount must be a positive number (in cents)');
      }

      if (!currency) {
        throw new AppError(400, 'Currency is required');
      }

      if (!destinationAddress || !destinationAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new AppError(400, 'Invalid destination address format');
      }

      // Get or create user by destination address
      let user = await this.userRepository.findOne({
        where: { walletAddress: destinationAddress },
      });

      if (!user) {
        try {
          user = this.userRepository.create({ walletAddress: destinationAddress });
          await this.userRepository.save(user);
          logger.info('Created new user for payout', {
            userId: user.id,
            walletAddress: destinationAddress,
          });
        } catch (error: any) {
          // Handle race condition
          if (error.code === 'SQLITE_CONSTRAINT' || error.errno === 19) {
            user = await this.userRepository.findOne({
              where: { walletAddress: destinationAddress },
            });
            if (!user) {
              throw error;
            }
            logger.info('User already exists (race condition handled)', {
              userId: user.id,
            });
          } else {
            throw error;
          }
        }
      }

      // Calculate MUSD amount (1:1 peg minus payout fee)
      const fiatAmount = amount / 100; // Convert cents to dollars
      const payoutFee = fiatAmount * feeStructure.stablecoinPayouts.payoutFee;
      const musdAmount = fiatAmount - payoutFee;

      // Build Stripe payout request
      // Stripe Connect Stablecoin Payouts API (Private Preview)
      const payoutParams: any = {
        amount,
        currency: currency.toLowerCase(),
        method: 'stablecoin',
        stablecoin_options: {
          currency: stripeCryptoConfig.stablecoinPayouts.currency,
          network: stripeCryptoConfig.stablecoinPayouts.network,
          destination_address: destinationAddress,
        },
        metadata: {
          destinationAddress,
          musdAmount: musdAmount.toFixed(6),
        },
      };

      // If connected account is specified, route payout through that account
      const stripeOptions: any = {};
      if (connectedAccountId) {
        payoutParams.destination = connectedAccountId;
        stripeOptions.stripeAccount = connectedAccountId;
      }

      const stripePayout: any = await (stripe as any).payouts.create(
        payoutParams,
        Object.keys(stripeOptions).length > 0 ? stripeOptions : undefined
      );

      // Estimated arrival: T+1 to T+2 business days
      const estimatedArrival = new Date();
      estimatedArrival.setDate(estimatedArrival.getDate() + 2);

      // Save payout to database
      const payout = this.payoutRepository.create({
        userId: user.id,
        stripePayoutId: stripePayout.id,
        status: 'pending',
        amount,
        currency: currency.toLowerCase(),
        musdAmount,
        destinationAddress,
        destinationNetwork: stripeCryptoConfig.stablecoinPayouts.network,
        connectedAccountId: connectedAccountId || undefined,
        estimatedArrival,
      });

      await this.payoutRepository.save(payout);

      logger.info('Created stablecoin payout', {
        payoutId: payout.id,
        stripePayoutId: stripePayout.id,
        amount,
        currency,
        musdAmount,
        destinationAddress,
        connectedAccountId,
      });

      return {
        payoutId: payout.id,
        musdAmount: musdAmount.toFixed(6),
        estimatedArrival: estimatedArrival.toISOString(),
      };
    } catch (error) {
      logger.error('Error creating payout', { error });
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'Failed to create payout');
    }
  }

  /**
   * Get payout by ID
   */
  async getPayout(payoutId: string): Promise<Payout> {
    const payout = await this.payoutRepository.findOne({
      where: { id: payoutId },
      relations: ['user'],
    });

    if (!payout) {
      throw new AppError(404, 'Payout not found');
    }

    // Fetch latest status from Stripe
    try {
      const stripePayout: any = await (stripe as any).payouts.retrieve(
        payout.stripePayoutId
      );

      if (stripePayout.status !== payout.status) {
        payout.status = this.mapStripePayoutStatus(stripePayout.status);

        if (stripePayout.status === 'paid') {
          payout.paidAt = new Date();

          // Extract on-chain transaction details if available
          if (stripePayout.stablecoin_details?.transaction_hash) {
            payout.txHash = stripePayout.stablecoin_details.transaction_hash;
          }
          if (stripePayout.stablecoin_details?.block_number) {
            payout.blockNumber = stripePayout.stablecoin_details.block_number;
          }
        }

        if (stripePayout.failure_message) {
          payout.errorMessage = stripePayout.failure_message;
        }

        await this.payoutRepository.save(payout);
      }
    } catch (error) {
      logger.error('Error fetching Stripe payout', { error, payoutId });
    }

    return payout;
  }

  /**
   * Update payout status from webhook
   * Requirements: 5.1, 5.2, 5.5
   */
  async updatePayoutFromWebhook(
    stripePayoutId: string,
    status: string,
    eventData?: any
  ): Promise<void> {
    const payout = await this.payoutRepository.findOne({
      where: { stripePayoutId },
    });

    if (!payout) {
      logger.warn('Payout not found for webhook', { stripePayoutId });
      return;
    }

    payout.status = this.mapStripePayoutStatus(status);

    if (eventData) {
      if (eventData.stablecoin_details?.transaction_hash) {
        payout.txHash = eventData.stablecoin_details.transaction_hash;
      }
      if (eventData.stablecoin_details?.block_number) {
        payout.blockNumber = eventData.stablecoin_details.block_number;
      }
      if (eventData.failure_message) {
        payout.errorMessage = eventData.failure_message;
      }
    }

    if (status === 'paid') {
      payout.paidAt = new Date();
    }

    await this.payoutRepository.save(payout);

    logger.info('Updated payout from webhook', {
      payoutId: payout.id,
      stripePayoutId,
      status: payout.status,
    });
  }

  /**
   * Get user's payout history
   */
  async getUserPayouts(
    walletAddress: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{ payouts: Payout[]; total: number }> {
    const user = await this.userRepository.findOne({
      where: { walletAddress },
    });

    if (!user) {
      return { payouts: [], total: 0 };
    }

    const [payouts, total] = await this.payoutRepository.findAndCount({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { payouts, total };
  }

  /**
   * Map Stripe payout status to our internal status values
   */
  private mapStripePayoutStatus(
    stripeStatus: string
  ): 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled' {
    switch (stripeStatus) {
      case 'paid':
        return 'paid';
      case 'failed':
        return 'failed';
      case 'canceled':
        return 'canceled';
      case 'in_transit':
        return 'in_transit';
      case 'pending':
      default:
        return 'pending';
    }
  }
}

export const payoutService = new PayoutService();
