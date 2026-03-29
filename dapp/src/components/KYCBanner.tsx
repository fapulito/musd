import React from 'react';
import './KYCBanner.css';

export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface KYCBannerProps {
  /** Current KYC verification status */
  kycStatus: KycStatus;
  /** User's rolling 24h deposit total in USD */
  dailyDepositTotal?: number;
  /** User's rolling 24h withdrawal total in USD */
  dailyWithdrawalTotal?: number;
  /** Threshold that triggers KYC (default $1,000) */
  threshold?: number;
  /** Callback when user clicks "Verify Identity" */
  onStartVerification?: () => void;
  /** Whether a verification request is in progress */
  loading?: boolean;
}

const STATUS_CONFIG: Record<
  KycStatus,
  { icon: string; title: string; className: string }
> = {
  unverified: {
    icon: '⚠️',
    title: 'Identity Verification Required',
    className: 'kyc-banner--warning',
  },
  pending: {
    icon: '⏳',
    title: 'Verification In Progress',
    className: 'kyc-banner--pending',
  },
  verified: {
    icon: '✅',
    title: 'Identity Verified',
    className: 'kyc-banner--success',
  },
  rejected: {
    icon: '❌',
    title: 'Verification Unsuccessful',
    className: 'kyc-banner--error',
  },
};

/**
 * Banner component that displays KYC status and prompts verification
 * when the user approaches or exceeds the daily transaction limit.
 *
 * Requirements: 6.1, 6.2, 6.4, 6.5
 */
export const KYCBanner: React.FC<KYCBannerProps> = ({
  kycStatus,
  dailyDepositTotal = 0,
  dailyWithdrawalTotal = 0,
  threshold = 1000,
  onStartVerification,
  loading = false,
}) => {
  const cfg = STATUS_CONFIG[kycStatus];
  const highestDaily = Math.max(dailyDepositTotal, dailyWithdrawalTotal);
  const remaining = Math.max(threshold - highestDaily, 0);
  const approachingLimit = remaining > 0 && remaining <= threshold * 0.2; // within 20%

  // Don't render for verified users unless they want to see status
  if (kycStatus === 'verified' && !approachingLimit) {
    return (
      <div
        className="kyc-banner kyc-banner--success kyc-banner--compact"
        role="status"
        aria-label="KYC status"
        data-testid="kyc-banner"
      >
        <span className="kyc-banner__icon" aria-hidden="true">✅</span>
        <span className="kyc-banner__text">Identity verified — no transaction limits.</span>
      </div>
    );
  }

  return (
    <div
      className={`kyc-banner ${cfg.className}`}
      role="alert"
      aria-label="KYC status"
      data-testid="kyc-banner"
    >
      <div className="kyc-banner__header">
        <span className="kyc-banner__icon" aria-hidden="true">{cfg.icon}</span>
        <h3 className="kyc-banner__title">{cfg.title}</h3>
      </div>

      <div className="kyc-banner__body">
        {kycStatus === 'unverified' && (
          <>
            <p className="kyc-banner__message">
              Transactions are limited to ${threshold.toLocaleString()} per 24 hours
              for unverified accounts. Complete identity verification to remove this limit.
            </p>
            {highestDaily > 0 && (
              <p className="kyc-banner__limit-info">
                Daily usage: ${highestDaily.toFixed(2)} / ${threshold.toLocaleString()}
                {approachingLimit && (
                  <span className="kyc-banner__limit-warning"> — approaching limit</span>
                )}
              </p>
            )}
            {onStartVerification && (
              <button
                className="kyc-banner__btn"
                onClick={onStartVerification}
                disabled={loading}
                aria-busy={loading}
              >
                {loading ? 'Starting…' : 'Verify Identity'}
              </button>
            )}
          </>
        )}

        {kycStatus === 'pending' && (
          <p className="kyc-banner__message">
            Your identity verification is being processed. This usually takes a few minutes.
            You'll be notified once it's complete.
          </p>
        )}

        {kycStatus === 'rejected' && (
          <>
            <p className="kyc-banner__message">
              Your identity verification was unsuccessful. Transactions above
              ${threshold.toLocaleString()} per 24 hours are restricted.
              Please contact support or try verifying again.
            </p>
            {onStartVerification && (
              <button
                className="kyc-banner__btn kyc-banner__btn--retry"
                onClick={onStartVerification}
                disabled={loading}
                aria-busy={loading}
              >
                {loading ? 'Starting…' : 'Try Again'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
