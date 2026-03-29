import { stripe } from '../config/stripe.config';
import { AppDataSource } from '../config/database';
import { PaymentIntent } from '../models/PaymentIntent';
import { User } from '../models/User';
import { stripeCryptoConfig, feeStructure } from '../config/stripe.config';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

export class PaymentService {
  private paymentIntentRepository = AppDataSource.getRepository(PaymentIntent);
  private userRepository = AppDataSource.getRepository(User);

  /**
   * Create a new payment intent for MUSD → Fiat stablecoin payment
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
   */
  async createPaymentIntent(params: {
    amount: number; // in cents
    currency: string;
    walletAddress: string;
    metadata?: Record<string, any>;
  }): Promise<{
    clientSecret: string;
    paymentIntentId: string;
    musdAmount: string;
    destinationAddress: string;
  }> {
    try {
      const { amount, currency, walletAddress, metadata } = params;

      // Validate inputs
      if (!amount || amount <= 0) {
        throw new AppError(400, 'Amount must be a positive number (in cents)');
      }

      if (!currency) {
        throw new AppError(400, 'Currency is required');
      }

      if (!walletAddress || !walletAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        throw new AppError(400, 'Invalid wallet address format');
      }

      // Get or create user
      let user = await this.userRepository.findOne({ where: { walletAddress } });

      if (!user) {
        try {
          user = this.userRepository.create({ walletAddress });
          await this.userRepository.save(user);
          logger.info('Created new user for payment', { userId: user.id, walletAddress });
        } catch (error: any) {
          // Handle race condition
          if (error.code === 'SQLITE_CONSTRAINT' || error.errno === 19) {
            user = await this.userRepository.findOne({ where: { walletAddress } });
            if (!user) {
              throw error;
            }
            logger.info('User already exists (race condition handled)', { userId: user.id });
          } else {
            throw error;
          }
        }
      }

      // Calculate MUSD amount from fiat amount (1:1 peg with processing fee)
      const processingFee = feeStructure.stablecoinPayments.processingFee;
      const fiatAmount = amount / 100; // Convert cents to dollars
      const feeAmount = fiatAmount * processingFee;
      const musdAmount = fiatAmount + feeAmount; // User pays fiat amount + fee in MUSD

      // Create Stripe Payment Intent with stablecoin payment method
      const stripePaymentIntent: any = await (stripe as any).paymentIntents.create({
        amount,
        currency: currency.toLowerCase(),
        payment_method_types: ['stablecoin'],
        payment_method_options: {
          stablecoin: {
            currency: stripeCryptoConfig.stablecoinPayments.currency,
            network: stripeCryptoConfig.stablecoinPayments.network,
          },
        },
        metadata: {
          walletAddress,
          musdAmount: musdAmount.toFixed(6),
          ...metadata,
        },
      });

      // Extract settlement address from Stripe response
      const destinationAddress =
        stripePaymentIntent.payment_method_options?.stablecoin?.settlement_address ||
        stripePaymentIntent.next_action?.stablecoin_transfer?.destination_address ||
        '';

      // Save payment intent to database
      const paymentIntent = this.paymentIntentRepository.create({
        userId: user.id,
        stripePaymentIntentId: stripePaymentIntent.id,
        status: stripePaymentIntent.status,
        amount,
        currency: currency.toLowerCase(),
        musdAmount,
        musdNetwork: stripeCryptoConfig.stablecoinPayments.network,
        settlementAddress: destinationAddress,
        clientSecret: stripePaymentIntent.client_secret,
        metadata,
      });

      await this.paymentIntentRepository.save(paymentIntent);

      logger.info('Created payment intent', {
        paymentIntentId: paymentIntent.id,
        stripePaymentIntentId: stripePaymentIntent.id,
        amount,
        currency,
        musdAmount,
        walletAddress,
      });

      return {
        clientSecret: stripePaymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        musdAmount: musdAmount.toFixed(6),
        destinationAddress,
      };
    } catch (error) {
      logger.error('Error creating payment intent', { error });
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'Failed to create payment intent');
    }
  }

  /**
   * Get payment intent by ID
   */
  async getPaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    const paymentIntent = await this.paymentIntentRepository.findOne({
      where: { id: paymentIntentId },
      relations: ['user'],
    });

    if (!paymentIntent) {
      throw new AppError(404, 'Payment intent not found');
    }

    // Fetch latest status from Stripe
    try {
      const stripePI: any = await (stripe as any).paymentIntents.retrieve(
        paymentIntent.stripePaymentIntentId
      );

      if (stripePI.status !== paymentIntent.status) {
        paymentIntent.status = stripePI.status;

        if (stripePI.status === 'succeeded') {
          paymentIntent.succeededAt = new Date();
        }

        await this.paymentIntentRepository.save(paymentIntent);
      }
    } catch (error) {
      logger.error('Error fetching Stripe payment intent', { error, paymentIntentId });
    }

    return paymentIntent;
  }

  /**
   * Update payment intent status from webhook
   * Requirements: 5.1, 5.2, 5.5
   */
  async updatePaymentIntentFromWebhook(
    stripePaymentIntentId: string,
    status: string,
    eventData?: any
  ): Promise<void> {
    const paymentIntent = await this.paymentIntentRepository.findOne({
      where: { stripePaymentIntentId },
    });

    if (!paymentIntent) {
      logger.warn('Payment intent not found for webhook', { stripePaymentIntentId });
      return;
    }

    paymentIntent.status = status as any;

    if (eventData) {
      paymentIntent.txHash = eventData.charges?.data?.[0]?.payment_method_details?.stablecoin?.transaction_hash
        || eventData.latest_charge?.payment_method_details?.stablecoin?.transaction_hash
        || paymentIntent.txHash;

      if (eventData.last_payment_error?.message) {
        paymentIntent.errorMessage = eventData.last_payment_error.message;
      }
    }

    if (status === 'succeeded') {
      paymentIntent.succeededAt = new Date();
    }

    await this.paymentIntentRepository.save(paymentIntent);

    logger.info('Updated payment intent from webhook', {
      paymentIntentId: paymentIntent.id,
      stripePaymentIntentId,
      status,
    });
  }

  /**
   * Get user's payment history
   */
  async getUserPaymentIntents(
    walletAddress: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{ paymentIntents: PaymentIntent[]; total: number }> {
    const user = await this.userRepository.findOne({ where: { walletAddress } });

    if (!user) {
      return { paymentIntents: [], total: 0 };
    }

    const [paymentIntents, total] = await this.paymentIntentRepository.findAndCount({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { paymentIntents, total };
  }
}

export const paymentService = new PaymentService();
