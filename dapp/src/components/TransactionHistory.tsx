import React, { useState } from 'react';
import { useAccount } from 'wagmi';
import {
  useTransactionHistory,
  type Transaction,
  type TransactionFilters,
} from '../hooks/useTransactionHistory';
import './TransactionHistory.css';

const TYPE_LABELS: Record<string, string> = {
  onramp: 'Buy MUSD',
  payment: 'Payment',
  payout: 'Payout',
};

const STATUS_CLASSES: Record<string, string> = {
  completed: 'status--completed',
  succeeded: 'status--completed',
  paid: 'status--completed',
  pending: 'status--pending',
  initialized: 'status--pending',
  processing: 'status--pending',
  in_transit: 'status--pending',
  requires_payment_method: 'status--pending',
  requires_confirmation: 'status--pending',
  failed: 'status--failed',
  canceled: 'status--failed',
};

export const TransactionHistory: React.FC = () => {
  const { address } = useAccount();
  const {
    transactions,
    total,
    hasMore,
    page,
    loading,
    error,
    filters,
    applyFilters,
    goToPage,
    exportCSV,
    refresh,
  } = useTransactionHistory(address);

  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [exporting, setExporting] = useState(false);

  const handleFilterChange = (key: keyof TransactionFilters, value: string) => {
    applyFilters({ ...filters, [key]: value || undefined });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportCSV();
    } catch {
      // error handled silently — user sees no download
    } finally {
      setExporting(false);
    }
  };

  if (!address) {
    return (
      <div className="tx-history">
        <p>Connect your wallet to view transaction history.</p>
      </div>
    );
  }

  return (
    <div className="tx-history">
      <div className="tx-history__header">
        <h2>Transaction History</h2>
        <div className="tx-history__actions">
          <button onClick={refresh} disabled={loading} className="tx-btn tx-btn--secondary">
            Refresh
          </button>
          <button onClick={handleExport} disabled={exporting || loading} className="tx-btn tx-btn--primary">
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="tx-history__filters">
        <select
          value={filters.type || ''}
          onChange={(e) => handleFilterChange('type', e.target.value)}
          aria-label="Filter by type"
        >
          <option value="">All Types</option>
          <option value="onramp">Buy MUSD</option>
          <option value="payment">Payment</option>
          <option value="payout">Payout</option>
        </select>

        <select
          value={filters.status || ''}
          onChange={(e) => handleFilterChange('status', e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="canceled">Canceled</option>
        </select>

        <input
          type="date"
          value={filters.startDate || ''}
          onChange={(e) => handleFilterChange('startDate', e.target.value)}
          aria-label="Start date"
          placeholder="Start date"
        />
        <input
          type="date"
          value={filters.endDate || ''}
          onChange={(e) => handleFilterChange('endDate', e.target.value)}
          aria-label="End date"
          placeholder="End date"
        />
      </div>

      {/* Error */}
      {error && <div className="tx-history__error">{error}</div>}

      {/* Loading */}
      {loading && <div className="tx-history__loading">Loading transactions…</div>}

      {/* Transaction list */}
      {!loading && transactions.length === 0 && (
        <div className="tx-history__empty">No transactions found.</div>
      )}

      {!loading && transactions.length > 0 && (
        <table className="tx-history__table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Status</th>
              <th>Fiat</th>
              <th>MUSD</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id} className="tx-history__row">
                <td className="tx-type">{TYPE_LABELS[tx.type] || tx.type}</td>
                <td>
                  <span className={`tx-status ${STATUS_CLASSES[tx.status] || ''}`}>
                    {tx.status}
                  </span>
                </td>
                <td>${tx.fiatAmount.toFixed(2)} {tx.fiatCurrency.toUpperCase()}</td>
                <td>{tx.musdAmount.toFixed(2)} MUSD</td>
                <td>{new Date(tx.createdAt).toLocaleDateString()}</td>
                <td>
                  <button
                    className="tx-btn tx-btn--link"
                    onClick={() => setSelectedTx(tx)}
                  >
                    Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="tx-history__pagination">
          <button
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            className="tx-btn tx-btn--secondary"
          >
            Previous
          </button>
          <span className="tx-history__page-info">
            Page {page} of {Math.ceil(total / 10)} ({total} total)
          </span>
          <button
            disabled={!hasMore}
            onClick={() => goToPage(page + 1)}
            className="tx-btn tx-btn--secondary"
          >
            Next
          </button>
        </div>
      )}

      {/* Detail modal */}
      {selectedTx && (
        <TransactionDetail
          transaction={selectedTx}
          onClose={() => setSelectedTx(null)}
        />
      )}
    </div>
  );
};

/* ── Transaction Detail View ─────────────────────────────────── */

interface TransactionDetailProps {
  transaction: Transaction;
  onClose: () => void;
}

const TransactionDetail: React.FC<TransactionDetailProps> = ({ transaction: tx, onClose }) => {
  return (
    <div className="tx-detail-overlay" onClick={onClose}>
      <div className="tx-detail" onClick={(e) => e.stopPropagation()}>
        <button className="tx-detail__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h3>Transaction Details</h3>

        <dl className="tx-detail__grid">
          <dt>ID</dt>
          <dd className="mono">{tx.id}</dd>

          <dt>Type</dt>
          <dd>{TYPE_LABELS[tx.type] || tx.type}</dd>

          <dt>Status</dt>
          <dd>
            <span className={`tx-status ${STATUS_CLASSES[tx.status] || ''}`}>
              {tx.status}
            </span>
          </dd>

          <dt>Fiat Amount</dt>
          <dd>${tx.fiatAmount.toFixed(2)} {tx.fiatCurrency.toUpperCase()}</dd>

          <dt>MUSD Amount</dt>
          <dd>{tx.musdAmount.toFixed(6)} MUSD</dd>

          {tx.fees > 0 && (
            <>
              <dt>Fees</dt>
              <dd>${tx.fees.toFixed(2)}</dd>
            </>
          )}

          {tx.stripePaymentId && (
            <>
              <dt>Stripe Payment ID</dt>
              <dd className="mono">{tx.stripePaymentId}</dd>
            </>
          )}

          {tx.stripePayoutId && (
            <>
              <dt>Stripe Payout ID</dt>
              <dd className="mono">{tx.stripePayoutId}</dd>
            </>
          )}

          {tx.txHash && (
            <>
              <dt>Tx Hash</dt>
              <dd className="mono">{tx.txHash}</dd>
            </>
          )}

          {tx.blockNumber != null && (
            <>
              <dt>Block Number</dt>
              <dd>{tx.blockNumber}</dd>
            </>
          )}

          <dt>Created</dt>
          <dd>{new Date(tx.createdAt).toLocaleString()}</dd>

          {tx.completedAt && (
            <>
              <dt>Completed</dt>
              <dd>{new Date(tx.completedAt).toLocaleString()}</dd>
            </>
          )}

          {tx.errorMessage && (
            <>
              <dt>Error</dt>
              <dd className="tx-detail__error">{tx.errorMessage}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
};
