/**
 * Unit tests for WebhookService payout event handling
 * Validates Requirements 5.1, 5.2, 5.5: Transaction recording and webhook processing
 */

// Mock dependencies before importing the service
const mockSave = jest.fn().mockImplementation((entity: any) => Promise.resolve(entity));
const mockCreate = jest.fn().mockImplementation((data: any) => data);
const mockFindOne = jest.fn();

const mockOnrampUpdateSession = jest.fn();
const mockPaymentUpdateIntent = jest.fn();
const mockPayoutUpdateFromWebhook = jest.fn();

jest.mock('../config/stripe.config', () => ({
  stripe: {
    webhooks: {
      constructEvent: jest.fn(),
    },
  },
}));

jest.mock('../config', () => ({
  config: {
    stripe: {
      webhookSecret: 'whsec_test_secret',
    },
  },
}));

jest.mock('../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn().mockReturnValue({
      create: (...args: any[]) => mockCreate(...args),
      save: (...args: any[]) => mockSave(...args),
      findOne: (...args: any[]) => mockFindOne(...args),
      find: jest.fn().mockResolvedValue([]),
    }),
  },
}));

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('./onramp.service', () => ({
  onrampService: {
    updateSessionFromWebhook: (...args: any[]) => mockOnrampUpdateSession(...args),
  },
}));

jest.mock('./payment.service', () => ({
  paymentService: {
    updatePaymentIntentFromWebhook: (...args: any[]) => mockPaymentUpdateIntent(...args),
  },
}));

jest.mock('./payout.service', () => ({
  payoutService: {
    updatePayoutFromWebhook: (...args: any[]) => mockPayoutUpdateFromWebhook(...args),
  },
}));

import { WebhookService } from './webhook.service';
import Stripe from 'stripe';

describe('WebhookService - Payout Webhooks', () => {
  let service: WebhookService;

  const makeEvent = (type: string, object: any): Stripe.Event =>
    ({
      id: `evt_test_${Date.now()}`,
      type,
      data: { object },
    } as unknown as Stripe.Event);

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOne.mockResolvedValue(null); // No duplicate events
    mockPayoutUpdateFromWebhook.mockResolvedValue(undefined);
    service = new WebhookService();
  });

  describe('payout.paid', () => {
    it('calls payoutService.updatePayoutFromWebhook with paid status (Req 5.1, 5.2)', async () => {
      const payoutObj = {
        id: 'po_test_123',
        amount: 10000,
        currency: 'usd',
        status: 'paid',
      };
      const event = makeEvent('payout.paid', payoutObj);

      await service.processWebhook(event);

      expect(mockPayoutUpdateFromWebhook).toHaveBeenCalledWith(
        'po_test_123',
        'paid',
        payoutObj
      );
    });

    it('marks webhook event as processed after handling payout.paid', async () => {
      const event = makeEvent('payout.paid', { id: 'po_test_456', amount: 5000, currency: 'usd' });

      await service.processWebhook(event);

      // The last save call should mark processed = true
      const savedEvent = mockSave.mock.calls[mockSave.mock.calls.length - 1][0];
      expect(savedEvent.processed).toBe(true);
      expect(savedEvent.processedAt).toBeInstanceOf(Date);
    });
  });

  describe('payout.failed', () => {
    it('calls payoutService.updatePayoutFromWebhook with failed status (Req 5.1, 5.2)', async () => {
      const payoutObj = {
        id: 'po_test_789',
        amount: 10000,
        currency: 'usd',
        failure_message: 'Insufficient funds',
      };
      const event = makeEvent('payout.failed', payoutObj);

      await service.processWebhook(event);

      expect(mockPayoutUpdateFromWebhook).toHaveBeenCalledWith(
        'po_test_789',
        'failed',
        payoutObj
      );
    });
  });

  describe('payout.canceled', () => {
    it('calls payoutService.updatePayoutFromWebhook with canceled status (Req 5.1, 5.2)', async () => {
      const payoutObj = {
        id: 'po_test_cancel',
      };
      const event = makeEvent('payout.canceled', payoutObj);

      await service.processWebhook(event);

      expect(mockPayoutUpdateFromWebhook).toHaveBeenCalledWith(
        'po_test_cancel',
        'canceled',
        payoutObj
      );
    });
  });

  describe('idempotency', () => {
    it('skips already-processed events (Req 5.5)', async () => {
      mockFindOne.mockResolvedValueOnce({
        stripeEventId: 'evt_already_done',
        processed: true,
      });

      const event = makeEvent('payout.paid', { id: 'po_test_dup' });
      event.id = 'evt_already_done';

      await service.processWebhook(event);

      expect(mockPayoutUpdateFromWebhook).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('records processing error on webhook event when handler throws', async () => {
      mockPayoutUpdateFromWebhook.mockRejectedValueOnce(new Error('DB connection lost'));

      const event = makeEvent('payout.paid', { id: 'po_test_err', amount: 1000, currency: 'usd' });

      await expect(service.processWebhook(event)).rejects.toThrow('DB connection lost');

      // The error should be saved on the webhook event
      const errorSaveCall = mockSave.mock.calls[mockSave.mock.calls.length - 1][0];
      expect(errorSaveCall.processingError).toBe('DB connection lost');
    });
  });
});
