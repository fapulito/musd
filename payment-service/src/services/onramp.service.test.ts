/**
 * Unit tests for OnrampService.getQuote and quote caching logic.
 * Validates Requirements 7.1-7.5: Fee structure and display.
 */

// Mock dependencies before importing the service
const mockSave = jest.fn().mockImplementation((entity: any) => Promise.resolve(entity));
const mockCreate = jest.fn().mockImplementation((data: any) => data);
const mockGetOne = jest.fn();
const mockCreateQueryBuilder = jest.fn().mockReturnValue({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getOne: mockGetOne,
});

jest.mock('../config/stripe.config', () => ({ stripe: {} }));
jest.mock('../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn().mockReturnValue({
      create: mockCreate,
      save: mockSave,
      createQueryBuilder: mockCreateQueryBuilder,
      findOne: jest.fn(),
      findAndCount: jest.fn(),
    }),
  },
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { OnrampService } from './onramp.service';

describe('OnrampService.getQuote', () => {
  let service: OnrampService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOne.mockResolvedValue(null); // No cache by default
    service = new OnrampService();
  });

  it('calculates Stripe fee as 2.9% + $0.30 (Req 7.1)', async () => {
    const result = await service.getQuote({
      sourceAmount: '100',
      sourceCurrency: 'usd',
      destinationCurrency: 'musd',
    });

    // Stripe fee for $100: 100 * 0.029 + 0.30 = 3.20
    expect(result.fees.stripeFee).toBe('3.20');
  });

  it('includes network fee in total (Req 7.4)', async () => {
    const result = await service.getQuote({
      sourceAmount: '100',
      sourceCurrency: 'usd',
      destinationCurrency: 'musd',
    });

    expect(result.fees.networkFee).toBe('0.50');
    // Total: 3.20 + 0.50 = 3.70
    expect(result.fees.totalFee).toBe('3.70');
  });

  it('calculates net MUSD amount after fees (Req 7.3)', async () => {
    const result = await service.getQuote({
      sourceAmount: '100',
      sourceCurrency: 'usd',
      destinationCurrency: 'musd',
    });

    // Net: 100 - 3.70 = 96.30
    expect(parseFloat(result.destinationAmount)).toBeCloseTo(96.30, 2);
    expect(parseFloat(result.netAmount)).toBeCloseTo(96.30, 2);
  });

  it('returns all fee breakdown fields (Req 7.4)', async () => {
    const result = await service.getQuote({
      sourceAmount: '50',
      sourceCurrency: 'usd',
      destinationCurrency: 'musd',
    });

    expect(result.fees).toHaveProperty('stripeFee');
    expect(result.fees).toHaveProperty('networkFee');
    expect(result.fees).toHaveProperty('totalFee');
    expect(result).toHaveProperty('sourceAmount');
    expect(result).toHaveProperty('netAmount');
    expect(result).toHaveProperty('destinationAmount');
    expect(result).toHaveProperty('exchangeRate');
    expect(result).toHaveProperty('expiresAt');
  });

  it('rejects non-positive amounts', async () => {
    await expect(
      service.getQuote({
        sourceAmount: '0',
        sourceCurrency: 'usd',
        destinationCurrency: 'musd',
      })
    ).rejects.toThrow('sourceAmount must be a positive number');

    await expect(
      service.getQuote({
        sourceAmount: '-5',
        sourceCurrency: 'usd',
        destinationCurrency: 'musd',
      })
    ).rejects.toThrow('sourceAmount must be a positive number');
  });

  it('returns cached quote when available', async () => {
    const cachedQuote = {
      id: 'cached-id',
      sourceAmount: 100,
      sourceCurrency: 'usd',
      destinationAmount: 96.3,
      destinationCurrency: 'musd',
      exchangeRate: 1.0,
      fees: { stripeFee: '3.20', networkFee: '0.50', totalFee: '3.70' },
      validUntil: new Date(Date.now() + 30000),
      createdAt: new Date(),
    };
    mockGetOne.mockResolvedValueOnce(cachedQuote);

    const result = await service.getQuote({
      sourceAmount: '100',
      sourceCurrency: 'usd',
      destinationCurrency: 'musd',
    });

    // Should not have saved a new quote
    expect(mockSave).not.toHaveBeenCalled();
    expect(parseFloat(result.destinationAmount)).toBeCloseTo(96.3, 1);
  });

  it('saves new quote to database when cache misses', async () => {
    await service.getQuote({
      sourceAmount: '200',
      sourceCurrency: 'usd',
      destinationCurrency: 'musd',
    });

    expect(mockCreate).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalled();
  });

  it('ensures net amount is never negative for tiny amounts', async () => {
    const result = await service.getQuote({
      sourceAmount: '0.50',
      sourceCurrency: 'usd',
      destinationCurrency: 'musd',
    });

    expect(parseFloat(result.destinationAmount)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(result.netAmount)).toBeGreaterThanOrEqual(0);
  });
});
