import React, { useState, useCallback } from 'react';
import type { Transaction } from '../hooks/useTransactionHistory';
import './ErrorRecovery.css';

const PAYMENT_SERVICE_URL = import.meta.env.VITE_PAYMENT_SERVICE_URL as string;
const SUPPORT_EMAIL = 'support@mezo.org';
const SUPPORT_URL = 'https://mezo.org/support';

export type RecoveryStatus = 'idle' | 'processing' | 'completed' | 'failed' | 'pending';

export interface ErrorRecoveryProps {
  /** The failed transaction to recover */
  transaction: Transaction;
  /** Whether the transaction is eligible for retry (retryable error) */
  retryable?: boolean;
  /** Callback after a successful recovery action */
  onRecoveryComplete?: () => void;
}

/**
 * Error recovery UI shown when a transaction has failed.
 * Provides retry, refund request, and customer support contact.
 *
 * Requirements:
 *  8.2 — Restore MUSD balance / refund on failure
 *  8.3 — Notify users of failed transactions
 *  8.5 — Provide customer support contact for unresolved issues
 */
export const ErrorRecovery: React.FC<ErrorRecoveryProps> = ({
  transaction,
  retryable = true,
  onRecoveryComplete,
}) => {
  const [status, setStatus] = useState<RecoveryStatus>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');

  const handleRetry = useCallback(async () => {
    setStatus('processing');
    setStatusMessage('Retrying transaction…');

    try {
      const response = await fetch(
        `${PAYMENT_SERVICE_URL}/api/v1/recovery/retry/${transaction.id}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );

      const body = await response.json();

      if (response.ok && body.success) {
        setStatus('completed');
        setStatusMessage(body.data?.message ?? 'Transaction retried successfully.');
        onRecoveryComplete?.();
      } else {
        setStatus('failed');
        setStatusMessage(body.message ?? 'Retry failed. Please request a refund or contact support.');
      }
    } catch {
      setStatus('failed');
      setStatusMessage('Unable to reach the server. Please try again later.');
    }
  }, [transaction.id, onRecoveryComplete]);

  const handleRefundRequest = useCallback(async () => {
    setStatus('processing');
    setStatusMessage('Submitting refund request…');

    try {
      const response = await fetch(
        `${PAYMENT_SERVICE_URL}/api/v1/recovery/refund/${transaction.id}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'User-initiated refund request for failed transaction' }),
        },
      );

      const body = await response.json();

      if (response.ok && body.success) {
        setStatus('pending');
        setStatusMessage(body.data?.message ?? 'Refund request submitted. We will process it within 5-10 business days.');
        onRecoveryComplete?.();
      } else {
        setStatus('failed');
        setStatusMessage(body.message ?? 'Refund request failed. Please contact support.');
      }
    } catch {
      setStatus('failed');
      setStatusMessage('Unable to reach the server. Please try again later.');
    }
  }, [transaction.id, onRecoveryComplete]);

  const isBusy = status === 'processing';
  const isTerminal = status === 'completed';

  return (
    <div className="error-recovery" role="alert">
      <div className="error-recovery__header">
        <span className="error-recovery__icon" aria-hidden="true">⚠️</span>
        <h3 className="error-recovery__title">Transaction Failed</h3>
      </div>

      <p className="error-recovery__message">
        {transaction.errorMessage
          ? transaction.errorMessage
          : 'This transaction could not be completed. You can retry or request a refund below.'}
      </p>

      {/* Recovery status banner */}
      {status !== 'idle' && (
        <div
          className={`error-recovery__status error-recovery__status--${status}`}
          aria-live="polite"
        >
          {statusMessage}
        </div>
      )}

      {/* Action buttons */}
      {!isTerminal && (
        <div className="error-recovery__actions">
          {retryable && (
            <button
              className="error-recovery__btn error-recovery__btn--retry"
              onClick={handleRetry}
              disabled={isBusy}
            >
              {isBusy ? 'Retrying…' : 'Retry Transaction'}
            </button>
          )}
          <button
            className="error-recovery__btn error-recovery__btn--refund"
            onClick={handleRefundRequest}
            disabled={isBusy}
          >
            {isBusy ? 'Submitting…' : 'Request Refund'}
          </button>
        </div>
      )}

      {/* Customer support contact — Req 8.5 */}
      <div className="error-recovery__support">
        <p>Need help? Contact our support team:</p>
        <p>
          Email:{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
        </p>
        <p>
          Support portal:{' '}
          <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
            {SUPPORT_URL}
          </a>
        </p>
      </div>

      {/* Admin dashboard stub — placeholder for future implementation */}
      <div className="error-recovery__admin-stub">
        Admin error investigation dashboard — coming soon
      </div>
    </div>
  );
};
