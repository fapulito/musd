import { AppDataSource } from '../config/database';
import { OnrampSession } from '../models/OnrampSession';
import { PaymentIntent } from '../models/PaymentIntent';
import { Payout } from '../models/Payout';
import { User } from '../models/User';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';

/**
 * Unified transaction representation aggregated from OnrampSession,
 * PaymentIntent, and Payout tables.
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */
export interface UnifiedTransaction {
  id: string;
  userId: string;
  type: 'onramp' | 'payment' | 'payout';
  status: string;
  fiatAmount: number;
  fiatCurrency: string;
  musdAmount: number;
  fees: number;
  stripePaymentId: string | null;
  stripePayoutId: string | null;
  txHash: string | null;
  blockNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
}

export interface TransactionListResult {
  transactions: UnifiedTransaction[];
  total: number;
  hasMore: boolean;
}

export interface TransactionFilters {
  walletAddress: string;
  page?: number;
  limit?: number;
  type?: 'onramp' | 'payment' | 'payout';
  status?: string;
  startDate?: string;
  endDate?: string;
}

export class TransactionService {
  private onrampRepo = AppDataSource.getRepository(OnrampSession);
  private paymentRepo = AppDataSource.getRepository(PaymentIntent);
  private payoutRepo = AppDataSource.getRepository(Payout);
  private userRepo = AppDataSource.getRepository(User);

  /**
   * Get paginated, filtered transaction history for a user.
   * Aggregates across OnrampSession, PaymentIntent, and Payout tables.
   */
  async getTransactions(filters: TransactionFilters): Promise<TransactionListResult> {
    const { walletAddress, page = 1, limit = 10, type, status, startDate, endDate } = filters;

    const user = await this.userRepo.findOne({ where: { walletAddress } });
    if (!user) {
      return { transactions: [], total: 0, hasMore: false };
    }

    const allTransactions: UnifiedTransaction[] = [];

    // Collect from each source unless filtered to a specific type
    if (!type || type === 'onramp') {
      const onramps = await this.queryOnrampSessions(user.id, status, startDate, endDate);
      allTransactions.push(...onramps);
    }

    if (!type || type === 'payment') {
      const payments = await this.queryPaymentIntents(user.id, status, startDate, endDate);
      allTransactions.push(...payments);
    }

    if (!type || type === 'payout') {
      const payouts = await this.queryPayouts(user.id, status, startDate, endDate);
      allTransactions.push(...payouts);
    }

    // Sort by createdAt descending
    allTransactions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = allTransactions.length;
    const offset = (page - 1) * limit;
    const paged = allTransactions.slice(offset, offset + limit);

    return {
      transactions: paged,
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Generate CSV content for transaction export.
   * Requirements: 5.4
   */
  async exportTransactionsCSV(
    walletAddress: string,
    startDate?: string,
    endDate?: string,
  ): Promise<string> {
    const result = await this.getTransactions({
      walletAddress,
      page: 1,
      limit: 10000, // Export all within date range
      startDate,
      endDate,
    });

    const header = [
      'ID',
      'Type',
      'Status',
      'Fiat Amount',
      'Fiat Currency',
      'MUSD Amount',
      'Fees',
      'Stripe Payment ID',
      'Stripe Payout ID',
      'Tx Hash',
      'Block Number',
      'Created At',
      'Completed At',
      'Error Message',
    ].join(',');

    const rows = result.transactions.map((tx) =>
      [
        tx.id,
        tx.type,
        tx.status,
        tx.fiatAmount.toFixed(2),
        tx.fiatCurrency,
        tx.musdAmount.toFixed(6),
        tx.fees.toFixed(2),
        tx.stripePaymentId || '',
        tx.stripePayoutId || '',
        tx.txHash || '',
        tx.blockNumber ?? '',
        tx.createdAt.toISOString(),
        tx.completedAt?.toISOString() || '',
        this.escapeCSV(tx.errorMessage || ''),
      ].join(','),
    );

    return [header, ...rows].join('\n');
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async queryOnrampSessions(
    userId: string,
    status?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<UnifiedTransaction[]> {
    const qb = this.onrampRepo
      .createQueryBuilder('o')
      .where('o.user_id = :userId', { userId });

    if (status) qb.andWhere('o.status = :status', { status });
    if (startDate) qb.andWhere('o.created_at >= :startDate', { startDate });
    if (endDate) qb.andWhere('o.created_at <= :endDate', { endDate });

    const sessions = await qb.getMany();

    return sessions.map((s): UnifiedTransaction => ({
      id: s.id,
      userId: s.userId,
      type: 'onramp',
      status: s.status,
      fiatAmount: Number(s.sourceAmount) || 0,
      fiatCurrency: s.sourceCurrency || 'usd',
      musdAmount: Number(s.destinationAmount) || 0,
      fees: (Number(s.transactionFee) || 0) + (Number(s.networkFee) || 0),
      stripePaymentId: s.stripeSessionId,
      stripePayoutId: null,
      txHash: s.txHash || null,
      blockNumber: s.blockNumber ? Number(s.blockNumber) : null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      completedAt: s.completedAt || null,
      errorMessage: s.errorMessage || null,
    }));
  }

  private async queryPaymentIntents(
    userId: string,
    status?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<UnifiedTransaction[]> {
    const qb = this.paymentRepo
      .createQueryBuilder('p')
      .where('p.user_id = :userId', { userId });

    if (status) qb.andWhere('p.status = :status', { status });
    if (startDate) qb.andWhere('p.created_at >= :startDate', { startDate });
    if (endDate) qb.andWhere('p.created_at <= :endDate', { endDate });

    const intents = await qb.getMany();

    return intents.map((p): UnifiedTransaction => ({
      id: p.id,
      userId: p.userId,
      type: 'payment',
      status: p.status,
      fiatAmount: Number(p.amount) / 100, // cents → dollars
      fiatCurrency: p.currency,
      musdAmount: Number(p.musdAmount) || 0,
      fees: 0, // fees tracked at Stripe level
      stripePaymentId: p.stripePaymentIntentId,
      stripePayoutId: null,
      txHash: p.txHash || null,
      blockNumber: p.blockNumber ? Number(p.blockNumber) : null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      completedAt: p.succeededAt || null,
      errorMessage: p.errorMessage || null,
    }));
  }

  private async queryPayouts(
    userId: string,
    status?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<UnifiedTransaction[]> {
    const qb = this.payoutRepo
      .createQueryBuilder('po')
      .where('po.user_id = :userId', { userId });

    if (status) qb.andWhere('po.status = :status', { status });
    if (startDate) qb.andWhere('po.created_at >= :startDate', { startDate });
    if (endDate) qb.andWhere('po.created_at <= :endDate', { endDate });

    const payouts = await qb.getMany();

    return payouts.map((po): UnifiedTransaction => ({
      id: po.id,
      userId: po.userId,
      type: 'payout',
      status: po.status,
      fiatAmount: Number(po.amount) / 100, // cents → dollars
      fiatCurrency: po.currency,
      musdAmount: Number(po.musdAmount) || 0,
      fees: 0,
      stripePaymentId: null,
      stripePayoutId: po.stripePayoutId,
      txHash: po.txHash || null,
      blockNumber: po.blockNumber ? Number(po.blockNumber) : null,
      createdAt: po.createdAt,
      updatedAt: po.updatedAt,
      completedAt: po.paidAt || null,
      errorMessage: po.errorMessage || null,
    }));
  }

  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

export const transactionService = new TransactionService();
