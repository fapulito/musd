/**
 * Unit tests for RefundService.
 * Validates Requirements 8.1, 8.2, 8.3, 8.4
 */

// ── Mocks ──────────────────────────────────────────────────────────

const mockRefundCreate = jest.fn();

jest.mock('../config/stripe.config', () => ({
  stripe: {
    refunds: { create: (...args: any[]) => mockRefundCreate(...args) },
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockNotify = jest.fn().mockResolvedValue({ sent: true, channels: ['email', 'in_app'], errors: [] });
const mockBuildMessage = jest.fn().mockReturnValue('Failure message with support info.');

jest.mock('./notification.service', () => ({
  notificationService: {
    notifyTransactionFailure: (...args: any[]) => mockNotify(...args),
    buildFailureMessage: (...args: any[]) => mockBuildMessage(...args),
  },
}));

import { RefundService, FailedDepositContext, FailedWithdrawalContext } from './refund.service';

const noDelay = () => Promise.resolve();

describe('RefundService', () => {
  let service: RefundService;

  const depositCtx: FailedDepositContext = {
    transactionId: 'tx-001',
    userId: 'user-001',
    userEmail: 'user@example.com',
    stripePaymentId: 'pi_abc123',
    walletAddress: '0x' + 'a'.repeat(40),
    amount: 10000,
    currency: 'usd',
  };

  const withdrawalCtx: FailedWithdrawalContext = {
    transactionId: 'tx-002',
    userId: 'user-002',
    userEmail: 'user2@example.com',
    musdAmount: 100,
    walletAddress: '0x' + 'b'.repeat(40),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RefundService();
  });

  // ── handleFailedDeposit ────────────────────────────────────────

  describe('handleFailedDeposit', () => {
    it('returns without refund when mint succeeds on first retry (Req 8.4)', async () => {
      const mintFn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue(undefined);

      const result = await service.handleFailedDeposit(depositCtx, mintFn, noDelay);

      expect(result.refunded).toBe(false);
      expect(mintFn).toHaveBeenCalledTimes(2);
      expect(mockRefundCreate).not.toHaveBeenCalled();
    });

    it('initiates Stripe refund after all retries exhausted (Req 8.1)', async () => {
      const mintFn = jest.fn().mockRejectedValue(new Error('always fails'));
      mockRefundCreate.mockResolvedValue({ id: 're_refund123' });

      const result = await service.handleFailedDeposit(depositCtx, mintFn, noDelay);

      expect(result.refunded).toBe(true);
      expect(result.stripeRefundId).toBe('re_refund123');
      // MINT_FAILED config: 3 retries → 4 total calls
      expect(mintFn).toHaveBeenCalledTimes(4);
      expect(mockRefundCreate).toHaveBeenCalledWith(
        expect.objectContaining({ payment_intent: 'pi_abc123' }),
      );
    });

    it('sends refund notification to user (Req 8.3)', async () => {
      const mintFn = jest.fn().mockRejectedValue(new Error('fail'));
      mockRefundCreate.mockResolvedValue({ id: 're_refund456' });

      await service.handleFailedDeposit(depositCtx, mintFn, noDelay);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-001',
          transactionType: 'deposit',
          status: 'refunded',
          channels: ['email', 'in_app'],
        }),
      );
    });

    it('notifies user even when Stripe refund fails (Req 8.3)', async () => {
      const mintFn = jest.fn().mockRejectedValue(new Error('fail'));
      mockRefundCreate.mockRejectedValue(new Error('Stripe down'));

      const result = await service.handleFailedDeposit(depositCtx, mintFn, noDelay);

      expect(result.refunded).toBe(false);
      expect(result.error).toBe('Stripe down');
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' }),
      );
    });
  });

  // ── handleFailedWithdrawal ─────────────────────────────────────

  describe('handleFailedWithdrawal', () => {
    it('restores balance on first attempt (Req 8.2)', async () => {
      const restoreFn = jest.fn().mockResolvedValue(undefined);

      const result = await service.handleFailedWithdrawal(withdrawalCtx, restoreFn, noDelay);

      expect(result.restored).toBe(true);
      expect(restoreFn).toHaveBeenCalledTimes(1);
    });

    it('retries and restores balance (Req 8.2, 8.4)', async () => {
      const restoreFn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue(undefined);

      const result = await service.handleFailedWithdrawal(withdrawalCtx, restoreFn, noDelay);

      expect(result.restored).toBe(true);
      expect(restoreFn).toHaveBeenCalledTimes(2);
    });

    it('sends balance_restored notification (Req 8.3)', async () => {
      const restoreFn = jest.fn().mockResolvedValue(undefined);

      await service.handleFailedWithdrawal(withdrawalCtx, restoreFn, noDelay);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-002',
          transactionType: 'withdrawal',
          status: 'balance_restored',
        }),
      );
    });

    it('returns failure after all retries exhausted (Req 8.2)', async () => {
      const restoreFn = jest.fn().mockRejectedValue(new Error('chain down'));

      const result = await service.handleFailedWithdrawal(withdrawalCtx, restoreFn, noDelay);

      expect(result.restored).toBe(false);
      expect(result.error).toBe('chain down');
      // BURN_FAILED config: 3 retries → 4 total calls
      expect(restoreFn).toHaveBeenCalledTimes(4);
    });

    it('sends failed notification when restore exhausted (Req 8.3, 8.5)', async () => {
      const restoreFn = jest.fn().mockRejectedValue(new Error('chain down'));

      await service.handleFailedWithdrawal(withdrawalCtx, restoreFn, noDelay);

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' }),
      );
    });
  });
});
