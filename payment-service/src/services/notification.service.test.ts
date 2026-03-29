/**
 * Unit tests for NotificationService.
 * Validates Requirements 8.3 (email notification) and 8.5 (support contact).
 */

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { NotificationService, TransactionNotification } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationService();
  });

  const baseNotification: TransactionNotification = {
    userId: 'user-001',
    email: 'user@example.com',
    transactionId: 'tx-001',
    transactionType: 'deposit',
    status: 'failed',
    message: 'Your deposit failed.',
    channels: ['email', 'in_app'],
  };

  describe('notifyTransactionFailure', () => {
    it('sends to all requested channels (Req 8.3)', async () => {
      const result = await service.notifyTransactionFailure(baseNotification);

      expect(result.sent).toBe(true);
      expect(result.channels).toEqual(['email', 'in_app']);
      expect(result.errors).toHaveLength(0);
    });

    it('sends to email only when only email channel requested', async () => {
      const result = await service.notifyTransactionFailure({
        ...baseNotification,
        channels: ['email'],
      });

      expect(result.sent).toBe(true);
      expect(result.channels).toEqual(['email']);
    });

    it('returns sent=false when no channels succeed', async () => {
      // Empty channels array
      const result = await service.notifyTransactionFailure({
        ...baseNotification,
        channels: [],
      });

      expect(result.sent).toBe(false);
      expect(result.channels).toHaveLength(0);
    });
  });

  describe('buildFailureMessage', () => {
    it('includes refund info for refunded status (Req 8.1)', () => {
      const msg = service.buildFailureMessage('deposit', 'refunded');

      expect(msg).toContain('refund');
      expect(msg).toContain('5-10 business days');
    });

    it('includes balance restored info for balance_restored status (Req 8.2)', () => {
      const msg = service.buildFailureMessage('withdrawal', 'balance_restored');

      expect(msg).toContain('MUSD balance has been restored');
    });

    it('includes investigating info for failed status', () => {
      const msg = service.buildFailureMessage('payment', 'failed');

      expect(msg).toContain('investigating');
    });

    it('always includes customer support contact (Req 8.5)', () => {
      const statuses: Array<'failed' | 'refunded' | 'balance_restored'> = [
        'failed',
        'refunded',
        'balance_restored',
      ];

      for (const status of statuses) {
        const msg = service.buildFailureMessage('deposit', status);
        expect(msg).toContain('support@mezo.org');
        expect(msg).toContain('https://mezo.org/support');
      }
    });
  });
});
