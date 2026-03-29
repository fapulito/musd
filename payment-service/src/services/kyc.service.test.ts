/**
 * Unit tests for KycService.
 * Validates Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('./notification.service', () => ({
  notificationService: {
    notifyTransactionFailure: jest.fn().mockResolvedValue({ sent: true, channels: ['email'], errors: [] }),
  },
}));

// Mock TypeORM repositories
const mockUserRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
};

const mockOnrampRepo = {
  createQueryBuilder: jest.fn(),
};

const mockPaymentRepo = {
  createQueryBuilder: jest.fn(),
};

const mockPayoutRepo = {
  createQueryBuilder: jest.fn(),
};

jest.mock('../config/database', () => ({
  AppDataSource: {
    getRepository: jest.fn((entity: any) => {
      const name = typeof entity === 'function' ? entity.name : entity;
      switch (name) {
        case 'User': return mockUserRepo;
        case 'OnrampSession': return mockOnrampRepo;
        case 'PaymentIntent': return mockPaymentRepo;
        case 'Payout': return mockPayoutRepo;
        default: return {};
      }
    }),
  },
}));

import { KycService, KYC_THRESHOLD } from './kyc.service';
import { ErrorCode } from '../utils/errors';
import { notificationService } from './notification.service';

function makeQueryBuilder(total: number) {
  const qb: any = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ total: String(total) }),
  };
  return qb;
}

describe('KycService', () => {
  let service: KycService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new KycService();
  });

  // ── checkTransactionAllowed (Req 6.1, 6.2, 6.5) ─────────────────

  describe('checkTransactionAllowed', () => {
    it('allows transactions for verified users regardless of amount', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        kycStatus: 'verified',
      });

      const result = await service.checkTransactionAllowed('u1', 5000, 'deposit');

      expect(result.allowed).toBe(true);
      expect(result.kycStatus).toBe('verified');
      expect(result.requiresVerification).toBe(false);
    });

    it('allows deposit under threshold for unverified user', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        kycStatus: 'unverified',
      });
      mockOnrampRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(0));

      const result = await service.checkTransactionAllowed('u1', 500, 'deposit');

      expect(result.allowed).toBe(true);
      expect(result.remainingBeforeKyc).toBe(1000);
    });

    it('rejects deposit exceeding threshold for unverified user (Req 6.1, 6.5)', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        kycStatus: 'unverified',
      });
      mockOnrampRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(600));

      await expect(
        service.checkTransactionAllowed('u1', 500, 'deposit'),
      ).rejects.toMatchObject({
        code: ErrorCode.KYC_REQUIRED,
      });
    });

    it('rejects withdrawal exceeding threshold for unverified user (Req 6.2, 6.5)', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        kycStatus: 'unverified',
      });
      // Payment + payout totals in cents → dollars
      mockPaymentRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(80000)); // $800
      mockPayoutRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(0));

      await expect(
        service.checkTransactionAllowed('u1', 300, 'withdrawal'),
      ).rejects.toMatchObject({
        code: ErrorCode.KYC_REQUIRED,
      });
    });

    it('rejects transaction for rejected KYC user exceeding threshold', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        kycStatus: 'rejected',
      });
      mockOnrampRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(900));

      await expect(
        service.checkTransactionAllowed('u1', 200, 'deposit'),
      ).rejects.toMatchObject({
        code: ErrorCode.KYC_FAILED,
      });
    });

    it('throws when user not found', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(
        service.checkTransactionAllowed('missing', 100, 'deposit'),
      ).rejects.toMatchObject({
        code: ErrorCode.KYC_REQUIRED,
      });
    });
  });

  // ── getKycStatus (Req 6.4) ──────────────────────────────────────

  describe('getKycStatus', () => {
    it('returns status and daily totals', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        kycStatus: 'unverified',
        kycVerifiedAt: null,
      });
      mockOnrampRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(250));
      mockPaymentRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(10000)); // $100
      mockPayoutRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(5000));  // $50

      const result = await service.getKycStatus('u1');

      expect(result.status).toBe('unverified');
      expect(result.verifiedAt).toBeNull();
      expect(result.dailyDepositTotal).toBe(250);
      expect(result.dailyWithdrawalTotal).toBe(150); // 100 + 50
      expect(result.threshold).toBe(KYC_THRESHOLD);
    });

    it('throws for unknown user', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.getKycStatus('missing')).rejects.toMatchObject({
        code: ErrorCode.KYC_REQUIRED,
      });
    });
  });

  // ── createVerificationSession (Req 6.3) ─────────────────────────

  describe('createVerificationSession', () => {
    it('returns existing status for already-verified user', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'u1',
        kycStatus: 'verified',
        stripeIdentitySessionId: 'vs_existing',
      });

      const result = await service.createVerificationSession('u1');

      expect(result.status).toBe('verified');
      expect(result.sessionId).toBe('vs_existing');
    });

    it('creates a pending session for unverified user', async () => {
      const user = {
        id: 'u1',
        kycStatus: 'unverified',
        stripeIdentitySessionId: null,
      };
      mockUserRepo.findOne.mockResolvedValue(user);
      mockUserRepo.save.mockResolvedValue(user);

      const result = await service.createVerificationSession('u1');

      expect(result.status).toBe('pending');
      expect(result.sessionId).toMatch(/^vs_placeholder_/);
      expect(result.url).toContain('verify.stripe.com');
      expect(mockUserRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ kycStatus: 'pending' }),
      );
    });
  });

  // ── handleIdentityWebhook (Req 6.3, 6.4) ────────────────────────

  describe('handleIdentityWebhook', () => {
    it('sets status to verified on verification_session.verified', async () => {
      const user = { id: 'u1', kycStatus: 'pending', email: 'test@example.com' };
      mockUserRepo.findOne.mockResolvedValue(user);
      mockUserRepo.save.mockResolvedValue(user);

      await service.handleIdentityWebhook(
        'identity.verification_session.verified',
        { id: 'vs_1', status: 'verified', metadata: { userId: 'u1' } },
      );

      expect(mockUserRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ kycStatus: 'verified' }),
      );
      expect(notificationService.notifyTransactionFailure).toHaveBeenCalled();
    });

    it('sets status to pending on requires_input', async () => {
      const user = { id: 'u1', kycStatus: 'unverified' };
      mockUserRepo.findOne.mockResolvedValue(user);
      mockUserRepo.save.mockResolvedValue(user);

      await service.handleIdentityWebhook(
        'identity.verification_session.requires_input',
        { id: 'vs_1', status: 'requires_input', metadata: { userId: 'u1' } },
      );

      expect(mockUserRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ kycStatus: 'pending' }),
      );
    });

    it('sets status to unverified on canceled', async () => {
      const user = { id: 'u1', kycStatus: 'pending' };
      mockUserRepo.findOne.mockResolvedValue(user);
      mockUserRepo.save.mockResolvedValue(user);

      await service.handleIdentityWebhook(
        'identity.verification_session.canceled',
        { id: 'vs_1', status: 'canceled', metadata: { userId: 'u1' } },
      );

      expect(mockUserRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ kycStatus: 'unverified' }),
      );
    });

    it('skips processing when metadata has no userId', async () => {
      await service.handleIdentityWebhook(
        'identity.verification_session.verified',
        { id: 'vs_1', status: 'verified' },
      );

      expect(mockUserRepo.findOne).not.toHaveBeenCalled();
    });
  });

  // ── updateKycStatus (Req 6.4) ───────────────────────────────────

  describe('updateKycStatus', () => {
    it('updates status and sets verifiedAt for verified', async () => {
      const user = { id: 'u1', kycStatus: 'unverified' };
      mockUserRepo.findOne.mockResolvedValue(user);
      mockUserRepo.save.mockResolvedValue(user);

      await service.updateKycStatus('u1', 'verified');

      expect(mockUserRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          kycStatus: 'verified',
          kycVerifiedAt: expect.any(Date),
        }),
      );
    });

    it('throws for unknown user', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.updateKycStatus('missing', 'verified')).rejects.toMatchObject({
        code: ErrorCode.KYC_REQUIRED,
      });
    });
  });
});
