/**
 * Unit tests for TransactionService.
 * Validates Requirements 5.1, 5.2, 5.3, 5.4:
 * - Aggregates onramp, payment, and payout transactions
 * - Pagination and filtering
 * - CSV export
 */

const mockFindOne = jest.fn();
const mockGetMany = jest.fn();
const mockWhere = jest.fn().mockReturnThis();
const mockAndWhere = jest.fn().mockReturnThis();
const mockCreateQueryBuilder = jest.fn().mockReturnValue({
  where: mockWhere,
  andWhere: mockAndWhere,
  getMany: mockGetMany,
});

jest.mock('../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn().mockReturnValue({
      findOne: mockFindOne,
      createQueryBuilder: mockCreateQueryBuilder,
    }),
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { TransactionService } from './transaction.service';

// ── Fixtures ────────────────────────────────────────────────────

const fakeUser = { id: 'user-1', walletAddress: '0x1234567890abcdef1234567890abcdef12345678' };

const fakeOnramp = {
  id: 'onramp-1',
  userId: 'user-1',
  stripeSessionId: 'cs_test_123',
  status: 'completed',
  sourceAmount: 100,
  sourceCurrency: 'usd',
  destinationAmount: 96.3,
  transactionFee: 3.2,
  networkFee: 0.5,
  txHash: '0xabc',
  blockNumber: 1000,
  createdAt: new Date('2024-01-15'),
  updatedAt: new Date('2024-01-15'),
  completedAt: new Date('2024-01-15'),
  errorMessage: null,
};

const fakePayment = {
  id: 'payment-1',
  userId: 'user-1',
  stripePaymentIntentId: 'pi_test_456',
  status: 'succeeded',
  amount: 5000, // cents
  currency: 'usd',
  musdAmount: 50.75,
  txHash: '0xdef',
  blockNumber: 2000,
  createdAt: new Date('2024-01-16'),
  updatedAt: new Date('2024-01-16'),
  succeededAt: new Date('2024-01-16'),
  errorMessage: null,
};

const fakePayout = {
  id: 'payout-1',
  userId: 'user-1',
  stripePayoutId: 'po_test_789',
  status: 'paid',
  amount: 20000, // cents
  currency: 'usd',
  musdAmount: 198,
  txHash: '0xghi',
  blockNumber: 3000,
  createdAt: new Date('2024-01-17'),
  updatedAt: new Date('2024-01-17'),
  paidAt: new Date('2024-01-17'),
  errorMessage: null,
};

describe('TransactionService', () => {
  let service: TransactionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TransactionService();
  });

  describe('getTransactions', () => {
    it('returns empty when user not found', async () => {
      mockFindOne.mockResolvedValue(null);

      const result = await service.getTransactions({
        walletAddress: '0x0000000000000000000000000000000000000000',
      });

      expect(result).toEqual({ transactions: [], total: 0, hasMore: false });
    });

    it('aggregates all three transaction types sorted by date desc (Req 5.1, 5.2, 5.3)', async () => {
      mockFindOne.mockResolvedValue(fakeUser);
      // Each call to getMany returns one type
      mockGetMany
        .mockResolvedValueOnce([fakeOnramp])   // onramp
        .mockResolvedValueOnce([fakePayment])  // payment
        .mockResolvedValueOnce([fakePayout]);   // payout

      const result = await service.getTransactions({
        walletAddress: fakeUser.walletAddress,
      });

      expect(result.total).toBe(3);
      // Sorted by date desc: payout (Jan 17), payment (Jan 16), onramp (Jan 15)
      expect(result.transactions[0].type).toBe('payout');
      expect(result.transactions[1].type).toBe('payment');
      expect(result.transactions[2].type).toBe('onramp');
    });

    it('filters by type when specified', async () => {
      mockFindOne.mockResolvedValue(fakeUser);
      mockGetMany.mockResolvedValue([fakeOnramp]);

      const result = await service.getTransactions({
        walletAddress: fakeUser.walletAddress,
        type: 'onramp',
      });

      // Only one createQueryBuilder call (for onramp), not three
      expect(mockCreateQueryBuilder).toHaveBeenCalledTimes(1);
      expect(result.total).toBe(1);
      expect(result.transactions[0].type).toBe('onramp');
    });

    it('applies status filter via query builder', async () => {
      mockFindOne.mockResolvedValue(fakeUser);
      mockGetMany.mockResolvedValue([]);

      await service.getTransactions({
        walletAddress: fakeUser.walletAddress,
        type: 'payment',
        status: 'succeeded',
      });

      expect(mockAndWhere).toHaveBeenCalledWith('p.status = :status', { status: 'succeeded' });
    });

    it('paginates correctly', async () => {
      mockFindOne.mockResolvedValue(fakeUser);
      // Return 3 items total
      mockGetMany
        .mockResolvedValueOnce([fakeOnramp])
        .mockResolvedValueOnce([fakePayment])
        .mockResolvedValueOnce([fakePayout]);

      const page1 = await service.getTransactions({
        walletAddress: fakeUser.walletAddress,
        page: 1,
        limit: 2,
      });

      expect(page1.transactions).toHaveLength(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.total).toBe(3);
    });

    it('maps onramp fields correctly (Req 5.1)', async () => {
      mockFindOne.mockResolvedValue(fakeUser);
      mockGetMany
        .mockResolvedValueOnce([fakeOnramp])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.getTransactions({
        walletAddress: fakeUser.walletAddress,
      });

      const tx = result.transactions[0];
      expect(tx.type).toBe('onramp');
      expect(tx.stripePaymentId).toBe('cs_test_123');
      expect(tx.fiatAmount).toBe(100);
      expect(tx.musdAmount).toBe(96.3);
      expect(tx.fees).toBeCloseTo(3.7, 1);
    });

    it('maps payment fields correctly — converts cents to dollars (Req 5.2)', async () => {
      mockFindOne.mockResolvedValue(fakeUser);
      mockGetMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([fakePayment])
        .mockResolvedValueOnce([]);

      const result = await service.getTransactions({
        walletAddress: fakeUser.walletAddress,
      });

      const tx = result.transactions[0];
      expect(tx.type).toBe('payment');
      expect(tx.fiatAmount).toBe(50); // 5000 cents → $50
      expect(tx.stripePaymentId).toBe('pi_test_456');
    });
  });

  describe('exportTransactionsCSV', () => {
    it('generates valid CSV with header and rows (Req 5.4)', async () => {
      mockFindOne.mockResolvedValue(fakeUser);
      mockGetMany
        .mockResolvedValueOnce([fakeOnramp])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const csv = await service.exportTransactionsCSV(fakeUser.walletAddress);

      const lines = csv.split('\n');
      expect(lines[0]).toContain('ID,Type,Status');
      expect(lines).toHaveLength(2); // header + 1 row
      expect(lines[1]).toContain('onramp');
      expect(lines[1]).toContain('completed');
    });

    it('returns header only when no transactions', async () => {
      mockFindOne.mockResolvedValue(null);

      const csv = await service.exportTransactionsCSV('0x0000000000000000000000000000000000000000');

      const lines = csv.split('\n');
      expect(lines).toHaveLength(1); // header only
    });

    it('escapes CSV values containing commas', async () => {
      const onrampWithComma = {
        ...fakeOnramp,
        errorMessage: 'Error, with comma',
      };
      mockFindOne.mockResolvedValue(fakeUser);
      mockGetMany
        .mockResolvedValueOnce([onrampWithComma])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const csv = await service.exportTransactionsCSV(fakeUser.walletAddress);

      expect(csv).toContain('"Error, with comma"');
    });
  });
});
