import { feeStructure } from '../config/stripe.config';
import { logger } from '../utils/logger';

/**
 * Transaction type for fee calculation
 */
export type TransactionType = 'deposit' | 'withdrawal' | 'stablecoin_payment';

/**
 * Payment method identifier used for fee comparison
 */
export type FeePaymentMethod = 'onramp_card' | 'onramp_bank' | 'stablecoin' | 'wallet';

/**
 * Full fee breakdown returned by the service.
 * Matches the FeeCalculation interface from the design doc.
 */
export interface FeeBreakdown {
  amount: number;
  currency: string;
  transactionType: TransactionType;
  stripeFee: number;
  platformFee: number;
  totalFee: number;
  netAmount: number;
}

/**
 * Single-method entry used in the comparison result
 */
export interface MethodFeeComparison {
  method: FeePaymentMethod;
  label: string;
  stripeFee: number;
  platformFee: number;
  totalFee: number;
  netAmount: number;
}

/**
 * Centralised fee calculation service for all transaction types.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 */
export class FeeService {
  // ── Deposit (Fiat → MUSD) ────────────────────────────────────────────

  /**
   * Requirement 7.1: Stripe processing fee 2.9 % + $0.30
   */
  calculateDepositFees(amount: number, _currency = 'usd'): FeeBreakdown {
    if (amount <= 0) {
      return this.zeroBreakdown(amount, _currency, 'deposit');
    }

    const stripeFee = amount * 0.029 + 0.30;
    const platformFee = 0; // covered by Stripe fee
    const totalFee = stripeFee + platformFee;
    const netAmount = Math.max(amount - totalFee, 0);

    return {
      amount,
      currency: _currency,
      transactionType: 'deposit',
      stripeFee: this.round(stripeFee),
      platformFee: this.round(platformFee),
      totalFee: this.round(totalFee),
      netAmount: this.round(netAmount),
    };
  }

  // ── Withdrawal (MUSD → Fiat) ─────────────────────────────────────────

  /**
   * Requirement 7.2: Withdrawal fee 1 %, minimum $1
   */
  calculateWithdrawalFees(amount: number, _currency = 'usd'): FeeBreakdown {
    if (amount <= 0) {
      return this.zeroBreakdown(amount, _currency, 'withdrawal');
    }

    const stripeFee = 0; // Stripe payout fee handled separately
    const rawPlatformFee = amount * feeStructure.stablecoinPayouts.payoutFee;
    const platformFee = Math.max(rawPlatformFee, 1); // min $1
    const totalFee = stripeFee + platformFee;
    const netAmount = Math.max(amount - totalFee, 0);

    return {
      amount,
      currency: _currency,
      transactionType: 'withdrawal',
      stripeFee: this.round(stripeFee),
      platformFee: this.round(platformFee),
      totalFee: this.round(totalFee),
      netAmount: this.round(netAmount),
    };
  }

  // ── Stablecoin Payment (MUSD → Fiat settlement) ──────────────────────

  /**
   * Stablecoin payment processing fee: 1.5 % (from stripe config)
   */
  calculateStablecoinPaymentFees(amount: number, _currency = 'usd'): FeeBreakdown {
    if (amount <= 0) {
      return this.zeroBreakdown(amount, _currency, 'stablecoin_payment');
    }

    const stripeFee = amount * feeStructure.stablecoinPayments.processingFee;
    const platformFee = 0;
    const totalFee = stripeFee + platformFee;
    const netAmount = Math.max(amount - totalFee, 0);

    return {
      amount,
      currency: _currency,
      transactionType: 'stablecoin_payment',
      stripeFee: this.round(stripeFee),
      platformFee: this.round(platformFee),
      totalFee: this.round(totalFee),
      netAmount: this.round(netAmount),
    };
  }

  // ── Generic dispatcher ───────────────────────────────────────────────

  /**
   * Calculate fees for any transaction type.
   * Requirement 7.3: display estimated MUSD amount after fees
   * Requirement 7.4: show fee breakdown (Stripe fee, platform fee, net amount)
   */
  calculateFees(
    amount: number,
    transactionType: TransactionType,
    currency = 'usd',
  ): FeeBreakdown {
    switch (transactionType) {
      case 'deposit':
        return this.calculateDepositFees(amount, currency);
      case 'withdrawal':
        return this.calculateWithdrawalFees(amount, currency);
      case 'stablecoin_payment':
        return this.calculateStablecoinPaymentFees(amount, currency);
      default:
        logger.warn('Unknown transaction type for fee calculation', { transactionType });
        return this.zeroBreakdown(amount, currency, transactionType);
    }
  }

  // ── Fee comparison across payment methods ────────────────────────────

  /**
   * Compare fees across all available payment methods for a given amount.
   * Requirement 7.4: fee breakdown comparison
   */
  compareFees(amount: number, currency = 'usd'): MethodFeeComparison[] {
    if (amount <= 0) {
      return [];
    }

    const onrampCard = this.calculateOnrampCardFees(amount);
    const onrampBank = this.calculateOnrampBankFees(amount);
    const stablecoin = this.calculateStablecoinPaymentFees(amount, currency);

    return [
      {
        method: 'onramp_card',
        label: 'Buy with Card (Stripe)',
        stripeFee: this.round(amount * feeStructure.onramp.cardPayment),
        platformFee: 0,
        totalFee: this.round(amount * feeStructure.onramp.cardPayment),
        netAmount: this.round(amount - amount * feeStructure.onramp.cardPayment),
      },
      {
        method: 'onramp_bank',
        label: 'Buy with Bank Transfer',
        stripeFee: this.round(amount * feeStructure.onramp.bankTransfer),
        platformFee: 0,
        totalFee: this.round(amount * feeStructure.onramp.bankTransfer),
        netAmount: this.round(amount - amount * feeStructure.onramp.bankTransfer),
      },
      {
        method: 'stablecoin',
        label: 'Stablecoin Payment',
        stripeFee: stablecoin.stripeFee,
        platformFee: stablecoin.platformFee,
        totalFee: stablecoin.totalFee,
        netAmount: stablecoin.netAmount,
      },
      {
        method: 'wallet',
        label: 'Direct Wallet Transfer',
        stripeFee: 0,
        platformFee: 0,
        totalFee: 0,
        netAmount: this.round(amount),
      },
    ];
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private calculateOnrampCardFees(amount: number) {
    const fee = amount * feeStructure.onramp.cardPayment;
    return { fee: this.round(fee), net: this.round(amount - fee) };
  }

  private calculateOnrampBankFees(amount: number) {
    const fee = amount * feeStructure.onramp.bankTransfer;
    return { fee: this.round(fee), net: this.round(amount - fee) };
  }

  private zeroBreakdown(amount: number, currency: string, transactionType: TransactionType): FeeBreakdown {
    return {
      amount,
      currency,
      transactionType,
      stripeFee: 0,
      platformFee: 0,
      totalFee: 0,
      netAmount: amount > 0 ? this.round(amount) : 0,
    };
  }

  /** Round to 2 decimal places (cents) */
  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}

export const feeService = new FeeService();
