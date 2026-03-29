import React from 'react';
import type { FeeEstimate } from '../hooks/useFeeEstimate';
import './FeeDisplay.css';

interface FeeDisplayProps {
  /** Fee estimate data (null while loading or before first fetch) */
  estimate: FeeEstimate | null;
  /** Whether a fetch is in progress */
  loading: boolean;
  /** Error message, if any */
  error: string | null;
  /** Optional: comparison data across payment methods */
  comparison?: MethodComparison[] | null;
}

export interface MethodComparison {
  method: string;
  label: string;
  stripeFee: number;
  platformFee: number;
  totalFee: number;
  netAmount: number;
}

/**
 * Displays a fee breakdown for a transaction.
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 *
 * - 7.1: Shows Stripe processing fee (2.9% + $0.30) for deposits
 * - 7.2: Shows withdrawal fee (1%, min $1) for withdrawals
 * - 7.3: Displays estimated MUSD / fiat amount after fees
 * - 7.4: Shows fee breakdown (Stripe fee, platform fee, net amount)
 */
export const FeeDisplay: React.FC<FeeDisplayProps> = ({
  estimate,
  loading,
  error,
  comparison,
}) => {
  if (error) {
    return (
      <div className="fee-display fee-display--error" role="alert">
        <p>Unable to calculate fees: {error}</p>
      </div>
    );
  }

  if (loading && !estimate) {
    return (
      <div className="fee-display fee-display--loading" aria-busy="true">
        <div className="fee-display__spinner" />
        <p>Calculating fees…</p>
      </div>
    );
  }

  if (!estimate) return null;

  const isDeposit = estimate.transactionType === 'deposit';
  const netLabel = isDeposit ? "You'll Receive" : 'You'll Get';
  const netUnit = isDeposit ? 'MUSD' : estimate.currency.toUpperCase();

  return (
    <div className="fee-display" aria-live="polite">
      {loading && <div className="fee-display__refreshing">Updating…</div>}

      <h4 className="fee-display__title">Fee Breakdown</h4>

      <dl className="fee-display__rows">
        <div className="fee-display__row">
          <dt>Amount</dt>
          <dd>
            ${estimate.amount.toFixed(2)} {estimate.currency.toUpperCase()}
          </dd>
        </div>

        {estimate.stripeFee > 0 && (
          <div className="fee-display__row">
            <dt>Stripe Fee</dt>
            <dd className="fee-display__deduction">
              −${estimate.stripeFee.toFixed(2)}
            </dd>
          </div>
        )}

        {estimate.platformFee > 0 && (
          <div className="fee-display__row">
            <dt>Platform Fee</dt>
            <dd className="fee-display__deduction">
              −${estimate.platformFee.toFixed(2)}
            </dd>
          </div>
        )}

        <div className="fee-display__row fee-display__row--total">
          <dt>Total Fees</dt>
          <dd className="fee-display__deduction">
            −${estimate.totalFee.toFixed(2)}
          </dd>
        </div>

        <div className="fee-display__row fee-display__row--highlight">
          <dt>{netLabel}</dt>
          <dd>
            {estimate.netAmount.toFixed(2)} {netUnit}
          </dd>
        </div>
      </dl>

      {/* Fee comparison table (Req 7.4) */}
      {comparison && comparison.length > 0 && (
        <div className="fee-display__comparison">
          <h5 className="fee-display__comparison-title">Compare Methods</h5>
          <table className="fee-display__table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Fee</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((m) => (
                <tr key={m.method}>
                  <td>{m.label}</td>
                  <td className="fee-display__deduction">
                    −${m.totalFee.toFixed(2)}
                  </td>
                  <td className="fee-display__net">
                    ${m.netAmount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
