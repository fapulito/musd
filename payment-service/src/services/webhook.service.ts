import Stripe from 'stripe';
import { stripe } from '../config/stripe.config';
import { AppDataSource } from '../config/database';
import { WebhookEvent } from '../models/WebhookEvent';
import { onrampService } from './onramp.service';
import { paymentService } from './payment.service';
import { payoutService } from './payout.service';
import { kycService } from './kyc.service';
import { logger } from '../utils/logger';
import { config } from '../config';

export class WebhookService {
  private webhookEventRepository = AppDataSource.getRepository(WebhookEvent);

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string
  ): Stripe.Event {
    try {
      return stripe.webhooks.constructEvent(
        payload,
        signature,
        config.stripe.webhookSecret
      );
    } catch (error) {
      logger.error('Webhook signature verification failed', { error });
      throw new Error('Invalid webhook signature');
    }
  }

  /**
   * Process webhook event
   */
  async processWebhook(event: Stripe.Event): Promise<void> {
    // Check if event already processed (idempotency)
    const existingEvent = await this.webhookEventRepository.findOne({
      where: { stripeEventId: event.id },
    });

    if (existingEvent?.processed) {
      logger.info('Webhook event already processed', { eventId: event.id });
      return;
    }

    // Save webhook event
    const webhookEvent = this.webhookEventRepository.create({
      stripeEventId: event.id,
      eventType: event.type,
      eventData: event.data as any,
      processed: false,
    });

    await this.webhookEventRepository.save(webhookEvent);

    try {
      // Process based on event type
      switch (event.type) {
        case 'crypto.onramp_session.completed' as any:
          await this.handleOnrampCompleted(event);
          break;

        case 'crypto.onramp_session.updated' as any:
          await this.handleOnrampUpdated(event);
          break;

        case 'payment_intent.succeeded':
          await this.handlePaymentSucceeded(event);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentFailed(event);
          break;

        case 'payment_intent.canceled':
          await this.handlePaymentCanceled(event);
          break;

        case 'payout.paid':
          await this.handlePayoutPaid(event);
          break;

        case 'payout.failed':
          await this.handlePayoutFailed(event);
          break;

        case 'payout.canceled':
          await this.handlePayoutCanceled(event);
          break;

        case 'identity.verification_session.verified' as any:
        case 'identity.verification_session.requires_input' as any:
        case 'identity.verification_session.canceled' as any:
          await this.handleIdentityEvent(event);
          break;

        default:
          logger.info('Unhandled webhook event type', {
            eventType: event.type,
            eventId: event.id,
          });
      }

      // Mark as processed
      webhookEvent.processed = true;
      webhookEvent.processedAt = new Date();
      await this.webhookEventRepository.save(webhookEvent);

      logger.info('Webhook event processed successfully', {
        eventId: event.id,
        eventType: event.type,
      });
    } catch (error) {
      logger.error('Error processing webhook event', {
        eventId: event.id,
        eventType: event.type,
        error,
      });

      webhookEvent.processingError = error instanceof Error ? error.message : 'Unknown error';
      await this.webhookEventRepository.save(webhookEvent);

      throw error;
    }
  }

  /**
   * Handle onramp session completed event
   */
  private async handleOnrampCompleted(event: Stripe.Event): Promise<void> {
    const session = event.data.object as any;

    logger.info('Onramp session completed', {
      sessionId: session.id,
      walletAddress: session.wallet_address,
    });

    await onrampService.updateSessionFromWebhook(
      session.id,
      'completed',
      session.transaction_details
    );

    // Emit application event for completed onramp
    // This can be used to trigger notifications, analytics, etc.
    this.emitOnrampCompletedEvent(session);
  }

  /**
   * Handle onramp session updated event
   */
  private async handleOnrampUpdated(event: Stripe.Event): Promise<void> {
    const session = event.data.object as any;

    logger.info('Onramp session updated', {
      sessionId: session.id,
      status: session.status,
    });

    await onrampService.updateSessionFromWebhook(
      session.id,
      session.status,
      session.transaction_details
    );
  }

  /**
   * Handle payment_intent.succeeded event
   * Requirements: 5.1, 5.2, 5.5
   */
  private async handlePaymentSucceeded(event: Stripe.Event): Promise<void> {
    const pi = event.data.object as any;

    logger.info('Payment intent succeeded', {
      paymentIntentId: pi.id,
      amount: pi.amount,
      currency: pi.currency,
    });

    await paymentService.updatePaymentIntentFromWebhook(
      pi.id,
      'succeeded',
      pi
    );

    // Trigger order fulfillment or service activation
    this.emitPaymentSucceededEvent(pi);
  }

  /**
   * Handle payment_intent.payment_failed event
   * Requirements: 5.1, 5.2, 5.5
   */
  private async handlePaymentFailed(event: Stripe.Event): Promise<void> {
    const pi = event.data.object as any;

    logger.error('Payment intent failed', {
      paymentIntentId: pi.id,
      error: pi.last_payment_error?.message,
    });

    await paymentService.updatePaymentIntentFromWebhook(
      pi.id,
      'requires_payment_method',
      pi
    );
  }

  /**
   * Handle payment_intent.canceled event
   * Requirements: 5.1, 5.2, 5.5
   */
  private async handlePaymentCanceled(event: Stripe.Event): Promise<void> {
    const pi = event.data.object as any;

    logger.info('Payment intent canceled', {
      paymentIntentId: pi.id,
    });

    await paymentService.updatePaymentIntentFromWebhook(
      pi.id,
      'canceled',
      pi
    );
  }

  /**
   * Handle payout.paid event
   * Requirements: 5.1, 5.2, 5.5
   */
  private async handlePayoutPaid(event: Stripe.Event): Promise<void> {
    const payout = event.data.object as any;

    logger.info('Payout paid', {
      payoutId: payout.id,
      amount: payout.amount,
      currency: payout.currency,
    });

    await payoutService.updatePayoutFromWebhook(
      payout.id,
      'paid',
      payout
    );

    // Notify user of payout completion
    this.emitPayoutCompletedEvent(payout);
  }

  /**
   * Handle payout.failed event
   * Requirements: 5.1, 5.2, 5.5
   */
  private async handlePayoutFailed(event: Stripe.Event): Promise<void> {
    const payout = event.data.object as any;

    logger.error('Payout failed', {
      payoutId: payout.id,
      failureMessage: payout.failure_message,
    });

    await payoutService.updatePayoutFromWebhook(
      payout.id,
      'failed',
      payout
    );

    // Notify user of payout failure
    this.emitPayoutFailedEvent(payout);
  }

  /**
   * Handle payout.canceled event
   * Requirements: 5.1, 5.2, 5.5
   */
  private async handlePayoutCanceled(event: Stripe.Event): Promise<void> {
    const payout = event.data.object as any;

    logger.info('Payout canceled', {
      payoutId: payout.id,
    });

    await payoutService.updatePayoutFromWebhook(
      payout.id,
      'canceled',
      payout
    );
  }

  /**
   * Emit payment succeeded event for order fulfillment / service activation
   */
  private emitPaymentSucceededEvent(pi: any): void {
    logger.info('Emitting payment succeeded event', {
      paymentIntentId: pi.id,
      amount: pi.amount,
      currency: pi.currency,
    });

    // Placeholder: integrate with order fulfillment, notifications, etc.
    // eventEmitter.emit('payment.succeeded', { paymentIntent: pi });
  }

  /**
   * Emit onramp completed event for application listeners
   */
  private emitOnrampCompletedEvent(session: any): void {
    // This is a placeholder for event emission
    // In a real application, you might use EventEmitter, Redis pub/sub, or message queue
    logger.info('Emitting onramp completed event', {
      sessionId: session.id,
      walletAddress: session.wallet_address,
      amount: session.transaction_details?.destination_amount,
    });

    // Example: Trigger notifications, update analytics, etc.
    // eventEmitter.emit('onramp.completed', { session });
  }

  /**
   * Emit payout completed event to notify user of successful payout
   * Requirements: 5.1, 5.5
   */
  private emitPayoutCompletedEvent(payout: any): void {
    logger.info('Emitting payout completed event', {
      payoutId: payout.id,
      amount: payout.amount,
      currency: payout.currency,
    });

    // Placeholder: integrate with notification service, email, push, etc.
    // eventEmitter.emit('payout.completed', { payout });
  }

  /**
   * Emit payout failed event to notify user of payout failure
   * Requirements: 5.1, 5.5
   */
  private emitPayoutFailedEvent(payout: any): void {
    logger.info('Emitting payout failed event', {
      payoutId: payout.id,
      failureMessage: payout.failure_message,
    });

    // Placeholder: integrate with notification service, email, push, etc.
    // eventEmitter.emit('payout.failed', { payout });
  }

  /**
   * Handle Stripe Identity verification webhook events.
   * Requirements: 6.3, 6.4
   */
  private async handleIdentityEvent(event: Stripe.Event): Promise<void> {
    const session = event.data.object as any;

    logger.info('Identity verification event received', {
      eventType: event.type,
      sessionId: session.id,
      status: session.status,
    });

    await kycService.handleIdentityWebhook(event.type, {
      id: session.id,
      status: session.status,
      metadata: session.metadata,
    });
  }

  /**
   * Get webhook event by ID
   */
  async getWebhookEvent(eventId: string): Promise<WebhookEvent | null> {
    return this.webhookEventRepository.findOne({
      where: { stripeEventId: eventId },
    });
  }

  /**
   * Get unprocessed webhook events
   */
  async getUnprocessedEvents(limit: number = 100): Promise<WebhookEvent[]> {
    return this.webhookEventRepository.find({
      where: { processed: false },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Retry failed webhook event
   */
  async retryWebhookEvent(eventId: string): Promise<void> {
    const webhookEvent = await this.webhookEventRepository.findOne({
      where: { stripeEventId: eventId },
    });

    if (!webhookEvent) {
      throw new Error('Webhook event not found');
    }

    if (webhookEvent.processed) {
      throw new Error('Webhook event already processed');
    }

    // Reconstruct Stripe event
    const stripeEvent: Stripe.Event = {
      id: webhookEvent.stripeEventId,
      type: webhookEvent.eventType,
      data: webhookEvent.eventData as any,
    } as Stripe.Event;

    // Process the event
    await this.processWebhook(stripeEvent);
  }
}

export const webhookService = new WebhookService();
