/**
 * Unit tests for PayoutService
 * Validates Requirements 2.1-2.5: Stablecoin Payouts (Fiat → MUSD)
 */

// Mock dependencies before importing the service
const mockSave = jest.fn().mockImplementation((entity: any) => Promise.resolve(entity));
const mockCreate = jest.fn().mockImplementation((data: any) => data);
const mockFindOne = jest.fn();
const mockFindAndCount = jest.fn();

const mockStripePayoutsCreate = jest.fn();
const mockStripePayoutsRetrieve = jest.fn();

jest.mock('../config/stripe.config', () => ({
  stripe: {
    payouts: {
      create: (...args: any[]) => mockStripePayoutsCreate(...args),
      retrieve: (...args: any[]) => mockStripePayoutsRetrieve(...args),
    },
  },
  stripeCryptoConfig: {
    stablecoinPayouts: {
      currency: 'musd',
      network: 'mezo',
    },
  },
  feeStructure: {
    stablecoinPayouts: {
      payoutFee: 0.01, // 1%
    },
  },
}));

jest.mock('../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn().mockReturnValue({
      create: (...args: any[]) => mockCreate(...args),
      save: (...args: any[]) => mockSave(...args),
      findOne: (...args: any[]) => mockFindOne(...args),
      findAndCount: (...args: any[]) => mockFindAndCount(...args),
    }),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { PayoutService } from './payout.service';

describe('PayoutService', () => {
  let service: PayoutService;

  const validAddress = '0x1234567890abcdef1234567890abcdef12345678';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PayoutService();
  });

  describe('createPayout', () => {
    beforeEach(() => {
      // Default: user not found, then created
      mockFindOne.mockResolvedValue(null);
      mockStripePayoutsCreate.mockResolvedValue({
        id: 'po_test_123',
        status: 'pending',
      });
    });

    it('creates a payout and returns payoutId, musdAmount, estimatedArrival (Req 2.3)', async () => {
      const result = await service.createPayout({
        amount: 10000, // $100 in cents
        currency: 'usd',
        destinationAddress: validAddress,
      });

      expect(result).toHaveProperty('payoutId');
      expect(result).toHaveProperty('musdAmount');
      expect(result).toHaveProperty('estimatedArrival');
    });

    it('calculates MUSD amount with 1% payout fee deducted (Req 2.5)', async () => {
      const result = await service.createPayout({
        amount: 10000, // $100
        currency: 'usd',
        destinationAddress: validAddress,
      });

      // $100 - 1% fee ($1) = $99 MUSD
      expect(parseFloat(result.musdAmount)).toBeCloseTo(99.0, 2);
    });

    it('calls Stripe payouts.create with stablecoin options', async () => {
      await service.createPayout({
        amount: 5000,
        currency: 'usd',
        destinationAddress: validAddress,
      });

      expect(mockStripePayoutsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 5000,
          currency: 'usd',
          method: 'stablecoin',
          stablecoin_options: {
            currency: 'musd',
            network: 'mezo',
            destination_address: validAddress,
          },
        }),
        undefined
      );
    });

    it('passes stripeAccount option for connected account payouts (Req 2.3)', async () => {
      await service.createPayout({
        amount: 5000,
        currency: 'usd',
        destinationAddress: validAddress,
        connectedAccountId: 'acct_connected_123',
      });

      expect(mockStripePayoutsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: 'acct_connected_123',
        }),
        expect.objectContaining({
          stripeAccount: 'acct_connected_123',
        })
      );
    });

    it('saves payout record to database', async () => {
      await service.createPayout({
        amount: 10000,
        currency: 'usd',
        destinationAddress: validAddress,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          stripePayoutId: 'po_test_123',
          status: 'pending',
          amount: 10000,
          currency: 'usd',
          destinationAddress: validAddress,
          destinationNetwork: 'mezo',
        })
      );
      expect(mockSave).toHaveBeenCalled();
    });

    it('rejects non-positive amount', async () => {
      await expect(
        service.createPayout({
          amount: 0,
          currency: 'usd',
          destinationAddress: validAddress,
        })
      ).rejects.toThrow('Amount must be a positive number');
    });

    it('rejects missing currency', async () => {
      await expect(
        service.createPayout({
          amount: 1000,
          currency: '',
          destinationAddress: validAddress,
        })
      ).rejects.toThrow('Currency is required');
    });

    it('rejects invalid destination address', async () => {
      await expect(
        service.createPayout({
          amount: 1000,
          currency: 'usd',
          destinationAddress: 'not-an-address',
        })
      ).rejects.toThrow('Invalid destination address format');
    });

    it('handles user race condition on creation', async () => {
      const existingUser = { id: 'user-1', walletAddress: validAddress };
      // First findOne returns null, save throws constraint, second findOne returns user
      mockFindOne
        .mockResolvedValueOnce(null) // first lookup
        .mockResolvedValueOnce(existingUser); // after constraint error
      mockSave
        .mockRejectedValueOnce({ code: 'SQLITE_CONSTRAINT', errno: 19 }) // user save fails
        .mockResolvedValue({}); // payout save succeeds

      const result = await service.createPayout({
        amount: 5000,
        currency: 'usd',
        destinationAddress: validAddress,
      });

      expect(result).toHaveProperty('payoutId');
    });
  });

  describe('getPayout', () => {
    it('returns payout details when found', async () => {
      const mockPayout = {
        id: 'payout-1',
        stripePayoutId: 'po_test_123',
        status: 'pending',
        amount: 10000,
        currency: 'usd',
        musdAmount: 99.0,
        destinationAddress: validAddress,
      };
      mockFindOne.mockResolvedValue(mockPayout);
      mockStripePayoutsRetrieve.mockResolvedValue({ status: 'pending' });

      const result = await service.getPayout('payout-1');

      expect(result.id).toBe('payout-1');
      expect(result.status).toBe('pending');
    });

    it('throws 404 when payout not found', async () => {
      mockFindOne.mockResolvedValue(null);

      await expect(service.getPayout('nonexistent')).rejects.toThrow('Payout not found');
    });

    it('updates status from Stripe when it changes', async () => {
      const mockPayout = {
        id: 'payout-1',
        stripePayoutId: 'po_test_123',
        status: 'pending',
      };
      mockFindOne.mockResolvedValue(mockPayout);
      mockStripePayoutsRetrieve.mockResolvedValue({
        status: 'paid',
        stablecoin_details: {
          transaction_hash: '0xabc123',
          block_number: 42,
        },
      });

      const result = await service.getPayout('payout-1');

      expect(result.status).toBe('paid');
      expect(result.txHash).toBe('0xabc123');
      expect(result.blockNumber).toBe(42);
      expect(mockSave).toHaveBeenCalled();
    });
  });

  describe('updatePayoutFromWebhook', () => {
    it('updates payout status and tx details from webhook event', async () => {
      const mockPayout = {
        id: 'payout-1',
        stripePayoutId: 'po_test_123',
        status: 'pending',
      };
      mockFindOne.mockResolvedValue(mockPayout);

      await service.updatePayoutFromWebhook('po_test_123', 'paid', {
        stablecoin_details: {
          transaction_hash: '0xdef456',
          block_number: 100,
        },
      });

      expect(mockSave).toHaveBeenCalled();
      expect(mockPayout.status).toBe('paid');
    });

    it('does not throw when payout not found (logs warning)', async () => {
      mockFindOne.mockResolvedValue(null);

      await expect(
        service.updatePayoutFromWebhook('po_unknown', 'paid')
      ).resolves.toBeUndefined();
    });

    it('records error message on failure', async () => {
      const mockPayout: any = {
        id: 'payout-1',
        stripePayoutId: 'po_test_123',
        status: 'pending',
      };
      mockFindOne.mockResolvedValue(mockPayout);

      await service.updatePayoutFromWebhook('po_test_123', 'failed', {
        failure_message: 'Insufficient funds',
      });

      expect(mockPayout.status).toBe('failed');
      expect(mockPayout.errorMessage).toBe('Insufficient funds');
    });
  });

  describe('getUserPayouts', () => {
    it('returns empty when user not found', async () => {
      mockFindOne.mockResolvedValue(null);

      const result = await service.getUserPayouts(validAddress);

      expect(result.payouts).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('returns paginated payouts for existing user', async () => {
      mockFindOne.mockResolvedValue({ id: 'user-1' });
      mockFindAndCount.mockResolvedValue([[{ id: 'p1' }, { id: 'p2' }], 2]);

      const result = await service.getUserPayouts(validAddress, 1, 10);

      expect(result.payouts).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });
});
