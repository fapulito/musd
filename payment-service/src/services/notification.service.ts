/**
 * Notification service for failed transactions.
 * Requirements: 8.3 (email notification), 8.5 (customer support contact).
 */

import { logger } from '../utils/logger';

const SUPPORT_EMAIL = 'support@mezo.org';
const SUPPORT_URL = 'https://mezo.org/support';

export type NotificationChannel = 'email' | 'in_app';

export interface TransactionNotification {
  userId: string;
  email?: string;
  transactionId: string;
  transactionType: 'deposit' | 'withdrawal' | 'payment' | 'payout';
  status: 'failed' | 'refunded' | 'balance_restored';
  message: string;
  channels: NotificationChannel[];
}

export interface NotificationResult {
  sent: boolean;
  channels: NotificationChannel[];
  errors: string[];
}

export class NotificationService {
  /**
   * Send a failure notification to the user via all requested channels.
   * Requirement 8.3: Notify users via email for all failed transactions.
   * Requirement 8.5: Provide customer support contact for unresolved issues.
   */
  async notifyTransactionFailure(notification: TransactionNotification): Promise<NotificationResult> {
    const errors: string[] = [];
    const sentChannels: NotificationChannel[] = [];

    for (const channel of notification.channels) {
      try {
        switch (channel) {
          case 'email':
            await this.sendEmail(notification);
            sentChannels.push('email');
            break;
          case 'in_app':
            await this.sendInApp(notification);
            sentChannels.push('in_app');
            break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${channel}: ${msg}`);
        logger.error(`Failed to send ${channel} notification`, {
          userId: notification.userId,
          transactionId: notification.transactionId,
          error: msg,
        });
      }
    }

    const sent = sentChannels.length > 0;

    logger.info('Transaction failure notification processed', {
      userId: notification.userId,
      transactionId: notification.transactionId,
      status: notification.status,
      sentChannels,
      errors,
    });

    return { sent, channels: sentChannels, errors };
  }

  /**
   * Build a user-facing message that includes customer support contact info.
   * Requirement 8.5
   */
  buildFailureMessage(
    transactionType: string,
    status: 'failed' | 'refunded' | 'balance_restored',
  ): string {
    const base = (() => {
      switch (status) {
        case 'refunded':
          return `Your ${transactionType} could not be completed. A refund has been initiated and should appear within 5-10 business days.`;
        case 'balance_restored':
          return `Your ${transactionType} could not be completed. Your MUSD balance has been restored.`;
        case 'failed':
        default:
          return `Your ${transactionType} could not be completed. Our team has been notified and is investigating.`;
      }
    })();

    return `${base} If you need further assistance, please contact us at ${SUPPORT_EMAIL} or visit ${SUPPORT_URL}.`;
  }

  // ── Channel implementations ──────────────────────────────────────

  /**
   * Send email notification (placeholder — integrate with SendGrid / SES / etc.)
   * Requirement 8.3
   */
  private async sendEmail(notification: TransactionNotification): Promise<void> {
    // In production, integrate with an email provider (SendGrid, AWS SES, etc.)
    logger.info('Sending email notification', {
      userId: notification.userId,
      email: notification.email ?? 'not provided',
      transactionId: notification.transactionId,
      status: notification.status,
      supportEmail: SUPPORT_EMAIL,
      supportUrl: SUPPORT_URL,
    });

    // Placeholder: actual email sending would happen here
    // await emailProvider.send({ to: notification.email, subject: ..., body: ... });
  }

  /**
   * Send in-app notification (placeholder — integrate with WebSocket / push service)
   */
  private async sendInApp(notification: TransactionNotification): Promise<void> {
    logger.info('Sending in-app notification', {
      userId: notification.userId,
      transactionId: notification.transactionId,
      status: notification.status,
      message: notification.message,
    });

    // Placeholder: actual in-app notification would happen here
    // await pushService.send({ userId: notification.userId, message: ... });
  }
}

export const notificationService = new NotificationService();
