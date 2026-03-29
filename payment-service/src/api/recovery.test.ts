/**
 * Unit tests for recovery API router.
 * Validates Requirements 8.2, 8.3, 8.5
 */

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../config/stripe.config', () => ({
  stripe: { refunds: { create: jest.fn() } },
}));

jest.mock('../services/notification.service', () => ({
  notificationService: {
    notifyTransactionFailure: jest.fn().mockResolvedValue({ sent: true, channels: ['in_app'], errors: [] }),
    buildFailureMessage: jest.fn().mockReturnValue('Failure message'),
  },
}));

import express from 'express';
import request from 'supertest';
import recoveryRouter, { recoveryStore } from './recovery';
import { errorHandler } from '../middleware/errorHandler';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/recovery', recoveryRouter);
  app.use(errorHandler);
  return app;
}

describe('Recovery API', () => {
  let app: express.Express;

  beforeEach(() => {
    recoveryStore.clear();
    app = createApp();
  });

  describe('POST /api/v1/recovery/retry/:transactionId', () => {
    it('returns 200 with success on retry (Req 8.2)', async () => {
      const res = await request(app)
        .post('/api/v1/recovery/retry/tx-100')
        .send();

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.transactionId).toBe('tx-100');
    });

    it('stores a completed recovery record', async () => {
      await request(app).post('/api/v1/recovery/retry/tx-101').send();

      const record = recoveryStore.get('tx-101');
      expect(record).toBeDefined();
      expect(record!.status).toBe('completed');
      expect(record!.action).toBe('retry');
    });
  });

  describe('POST /api/v1/recovery/refund/:transactionId', () => {
    it('returns 202 with pending status (Req 8.2, 8.5)', async () => {
      const res = await request(app)
        .post('/api/v1/recovery/refund/tx-200')
        .send({ reason: 'User requested' });

      expect(res.status).toBe(202);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.supportEmail).toBe('support@mezo.org');
      expect(res.body.data.supportUrl).toBe('https://mezo.org/support');
    });

    it('stores a pending recovery record', async () => {
      await request(app)
        .post('/api/v1/recovery/refund/tx-201')
        .send({ reason: 'test' });

      const record = recoveryStore.get('tx-201');
      expect(record).toBeDefined();
      expect(record!.status).toBe('pending');
      expect(record!.action).toBe('refund');
    });
  });

  describe('GET /api/v1/recovery/status/:transactionId', () => {
    it('returns 404 when no recovery record exists', async () => {
      const res = await request(app)
        .get('/api/v1/recovery/status/tx-nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns recovery record after retry (Req 8.3)', async () => {
      await request(app).post('/api/v1/recovery/retry/tx-300').send();

      const res = await request(app)
        .get('/api/v1/recovery/status/tx-300');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.transactionId).toBe('tx-300');
      expect(res.body.data.action).toBe('retry');
      expect(res.body.data.status).toBe('completed');
      expect(res.body.data.supportEmail).toBe('support@mezo.org');
      expect(res.body.data.supportUrl).toBe('https://mezo.org/support');
    });

    it('returns recovery record after refund request', async () => {
      await request(app)
        .post('/api/v1/recovery/refund/tx-301')
        .send({ reason: 'test' });

      const res = await request(app)
        .get('/api/v1/recovery/status/tx-301');

      expect(res.status).toBe(200);
      expect(res.body.data.action).toBe('refund');
      expect(res.body.data.status).toBe('pending');
    });
  });
});
