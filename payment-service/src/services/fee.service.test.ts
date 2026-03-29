/**
 * Unit tests for FeeService.
 * Validates Requirements 7.1, 7.2, 7.3, 7.4.
 */

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { FeeService } from './fee.service';

describe('FeeService', () => {
  let service: FeeService;

  beforeEach(() => {
    service = new FeeService();
  });

  // ── Deposit fees (Req 7.1) ──────────────────────────────────────────

  describe('calculateDepositFees', () => {
    it('applies 2.9% + $0.30 Stripe fee for $100 deposit', () => {
      const result = service.calculateDepositFees(100);
      // 100 * 0.029 + 0.30 = 3.20
      expect(result.stripeFee).toBe(3.2);
      expect(result.platformFee).toBe(0);
      expect(result.totalFee).toBe(3.2);
      expect(result.netAmount).toBe(96.8);
    });

    it('applies correct fee for small deposit ($10)', () => {
      const result = service.calculateDepositFees(10);
      // 10 * 0.029 + 0.30 = 0.59
      expect(result.stripeFee).toBe(0.59);
      expect(result.netAmount).toBe(9.41);
    });

    it('returns zero breakdown for zero amount', () => {
      const result = service.calculateDepositFees(0);
      expect(result.stripeFee).toBe(0);
      expect(result.totalFee).toBe(0);
      expect(result.netAmount).toBe(0);
    });

    it('returns zero breakdown for negative amount', () => {
      const result = service.calculateDepositFees(-50);
      expect(result.totalFee).toBe(0);
    });

    it('sets transactionType to deposit', () => {
      const result = service.calculateDepositFees(100);
      expect(result.transactionType).toBe('deposit');
    });
  });

  // ── Withdrawal fees (Req 7.2) ───────────────────────────────────────

  describe('calculateWithdrawalFees', () => {
    it('applies 1% withdrawal fee for $200', () => {
      const result = service.calculateWithdrawalFees(200);
      // 200 * 0.01 = 2.00
      expect(result.platformFee).toBe(2);
      expect(result.netAmount).toBe(198);
    });

    it('enforces $1 minimum withdrawal fee', () => {
      const result = service.calculateWithdrawalFees(50);
      // 50 * 0.01 = 0.50 → min $1
      expect(result.platformFee).toBe(1);
      expect(result.totalFee).toBe(1);
      expect(result.netAmount).toBe(49);
    });

    it('returns zero breakdown for zero amount', () => {
      const result = service.calculateWithdrawalFees(0);
      expect(result.totalFee).toBe(0);
    });

    it('sets transactionType to withdrawal', () => {
      const result = service.calculateWithdrawalFees(100);
      expect(result.transactionType).toBe('withdrawal');
    });
  });

  // ── Stablecoin payment fees ─────────────────────────────────────────

  describe('calculateStablecoinPaymentFees', () => {
    it('applies 1.5% processing fee', () => {
      const result = service.calculateStablecoinPaymentFees(100);
      expect(result.stripeFee).toBe(1.5);
      expect(result.netAmount).toBe(98.5);
    });

    it('returns zero breakdown for zero amount', () => {
      const result = service.calculateStablecoinPaymentFees(0);
      expect(result.totalFee).toBe(0);
    });
  });

  // ── Generic dispatcher ──────────────────────────────────────────────

  describe('calculateFees', () => {
    it('dispatches to deposit calculation', () => {
      const result = service.calculateFees(100, 'deposit');
      expect(result.transactionType).toBe('deposit');
      expect(result.stripeFee).toBe(3.2);
    });

    it('dispatches to withdrawal calculation', () => {
      const result = service.calculateFees(200, 'withdrawal');
      expect(result.transactionType).toBe('withdrawal');
      expect(result.platformFee).toBe(2);
    });

    it('dispatches to stablecoin_payment calculation', () => {
      const result = service.calculateFees(100, 'stablecoin_payment');
      expect(result.transactionType).toBe('stablecoin_payment');
      expect(result.stripeFee).toBe(1.5);
    });
  });

  // ── Fee comparison (Req 7.4) ────────────────────────────────────────

  describe('compareFees', () => {
    it('returns all four payment methods', () => {
      const result = service.compareFees(100);
      expect(result).toHaveLength(4);
      const methods = result.map((r) => r.method);
      expect(methods).toEqual([
        'onramp_card',
        'onramp_bank',
        'stablecoin',
        'wallet',
      ]);
    });

    it('wallet method has zero fees', () => {
      const result = service.compareFees(100);
      const wallet = result.find((r) => r.method === 'wallet')!;
      expect(wallet.totalFee).toBe(0);
      expect(wallet.netAmount).toBe(100);
    });

    it('returns empty array for zero amount', () => {
      expect(service.compareFees(0)).toEqual([]);
    });

    it('orders methods from most to least expensive', () => {
      const result = service.compareFees(100);
      // card (3.5%) > bank (1.5%) = stablecoin (1.5%) > wallet (0%)
      expect(result[0].totalFee).toBeGreaterThanOrEqual(result[1].totalFee);
      expect(result[3].totalFee).toBe(0);
    });
  });

  // ── Rounding ────────────────────────────────────────────────────────

  describe('rounding', () => {
    it('rounds fees to 2 decimal places', () => {
      // 33.33 * 0.029 + 0.30 = 1.26657 → 1.27
      const result = service.calculateDepositFees(33.33);
      expect(result.stripeFee).toBe(1.27);
      expect(result.netAmount).toBe(32.06);
    });
  });
});
