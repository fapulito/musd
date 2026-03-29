import React from 'react';
import type { ProgressStep } from '../hooks/useTransactionPolling';
import './TransactionStatusBadge.css';

export interface TransactionStatusBadgeProps {
  /** Current transaction status string */
  status: string;
  /** Whether the transaction is still being polled */
  isPolling?: boolean;
  /** Optional progress step info for long-running transactions */
  progress?: ProgressStep | null;
  /** Show a progress bar when progress info is available */
  showProgressBar?: boolean;
}

/** Statuses that represent a successful terminal state */
const COMPLETED_STATUSES = new Set(['completed', 'succeeded', 'paid']);

/** Statuses that represent a failed/canceled terminal state */
const FAILED_STATUSES = new Set(['failed', 'canceled']);

function getStatusCategory(status: string): 'completed' | 'failed' | 'pending' {
  if (COMPLETED_STATUSES.has(status)) return 'completed';
  if (FAILED_STATUSES.has(status)) return 'failed';
  return 'pending';
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    initialized: 'Initialized',
    pending: 'Pending',
    processing: 'Processing',
    in_transit: 'In Transit',
    requires_payment_method: 'Awaiting Payment',
    requires_confirmation: 'Confirming',
    completed: 'Completed',
    succeeded: 'Succeeded',
    paid: 'Paid',
    failed: 'Failed',
    canceled: 'Canceled',
  };
  return labels[status] || status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Displays a transaction status badge with animated indicators for
 * pending/processing states and static indicators for terminal states.
 *
 * Requirements: 5.3 (display transaction status), 8.3 (handle long-running transactions)
 */
export const TransactionStatusBadge: React.FC<TransactionStatusBadgeProps> = ({
  status,
  isPolling = false,
  progress = null,
  showProgressBar = false,
}) => {
  const category = getStatusCategory(status);
  const label = getStatusLabel(status);

  const progressPercent =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div className="tx-status-badge" data-testid="tx-status-badge">
      <span className={`tx-status-badge__indicator tx-status-badge__indicator--${category}`}>
        {category === 'pending' && (
          <span className="tx-status-badge__pulse" aria-hidden="true" />
        )}
        <span className="tx-status-badge__label">{label}</span>
        {isPolling && category === 'pending' && (
          <span className="tx-status-badge__spinner" aria-label="Updating" />
        )}
      </span>

      {showProgressBar && progress && progress.current > 0 && (
        <div className="tx-status-badge__progress" data-testid="tx-progress-bar">
          <div
            className="tx-status-badge__progress-fill"
            style={{ width: `${progressPercent}%` }}
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={progress.label}
          />
          <span className="tx-status-badge__progress-text">
            {progress.label} ({progress.current}/{progress.total})
          </span>
        </div>
      )}
    </div>
  );
};
