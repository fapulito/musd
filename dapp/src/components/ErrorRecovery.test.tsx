/**
 * Unit tests for ErrorRecovery component.
 * Validates Requirements 8.2 (retry/refund), 8.3 (status messages), 8.5 (support contact).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ErrorRecovery } from './ErrorRecovery';
import type { Transaction } from '../hooks/useTransactionHistory';

// Mock fetch globally
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

const failedTransaction: Transaction = {
  id: 'tx-fail-001',
  userId: 'user-001',
  type: 'onramp',
  status: 'failed',
  fiatAmount: 100,
  fiatCurrency: 'usd',
  musdAmount: 97,
  fees: 3,
  stripePaymentId: 'pi_abc',
  stripePayoutId: null,
  txHash: null,
  blockNumber: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  completedAt: null,
  errorMessage: 'MUSD minting failed after retries',
};

describe('ErrorRecovery', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('renders the failure header and error message', () => {
    render(<ErrorRecovery transaction={failedTransaction} />);

    expect(screen.getByText('Transaction Failed')).toBeInTheDocument();
    expect(screen.getByText('MUSD minting failed after retries')).toBeInTheDocument();
  });

  it('shows default message when transaction has no errorMessage', () => {
    const tx = { ...failedTransaction, errorMessage: null };
    render(<ErrorRecovery transaction={tx} />);

    expect(
      screen.getByText('This transaction could not be completed. You can retry or request a refund below.'),
    ).toBeInTheDocument();
  });

  it('renders Retry and Request Refund buttons when retryable (Req 8.2)', () => {
    render(<ErrorRecovery transaction={failedTransaction} retryable={true} />);

    expect(screen.getByText('Retry Transaction')).toBeInTheDocument();
    expect(screen.getByText('Request Refund')).toBeInTheDocument();
  });

  it('hides Retry button when not retryable', () => {
    render(<ErrorRecovery transaction={failedTransaction} retryable={false} />);

    expect(screen.queryByText('Retry Transaction')).not.toBeInTheDocument();
    expect(screen.getByText('Request Refund')).toBeInTheDocument();
  });

  it('displays customer support contact info (Req 8.5)', () => {
    render(<ErrorRecovery transaction={failedTransaction} />);

    expect(screen.getByText('support@mezo.org')).toBeInTheDocument();
    expect(screen.getByText('https://mezo.org/support')).toBeInTheDocument();
  });

  it('shows admin dashboard stub', () => {
    render(<ErrorRecovery transaction={failedTransaction} />);

    expect(
      screen.getByText('Admin error investigation dashboard — coming soon'),
    ).toBeInTheDocument();
  });

  it('shows completed status when retry succeeds (Req 8.3)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { message: 'Transaction retried successfully.', status: 'completed', attempts: 1 },
      }),
    });

    render(<ErrorRecovery transaction={failedTransaction} />);
    fireEvent.click(screen.getByText('Retry Transaction'));

    await waitFor(() => {
      expect(screen.getByText('Transaction retried successfully.')).toBeInTheDocument();
    });
  });

  it('shows failure status when retry fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        success: false,
        message: 'Retry failed after maximum attempts.',
      }),
    });

    render(<ErrorRecovery transaction={failedTransaction} />);
    fireEvent.click(screen.getByText('Retry Transaction'));

    await waitFor(() => {
      expect(screen.getByText('Retry failed after maximum attempts.')).toBeInTheDocument();
    });
  });

  it('shows pending status when refund is requested', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { message: 'Refund request submitted.', status: 'pending' },
      }),
    });

    render(<ErrorRecovery transaction={failedTransaction} />);
    fireEvent.click(screen.getByText('Request Refund'));

    await waitFor(() => {
      expect(screen.getByText('Refund request submitted.')).toBeInTheDocument();
    });
  });

  it('handles network errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    render(<ErrorRecovery transaction={failedTransaction} />);
    fireEvent.click(screen.getByText('Retry Transaction'));

    await waitFor(() => {
      expect(
        screen.getByText('Unable to reach the server. Please try again later.'),
      ).toBeInTheDocument();
    });
  });

  it('calls onRecoveryComplete callback on successful retry', async () => {
    const onComplete = jest.fn();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: { message: 'Done', status: 'completed' } }),
    });

    render(
      <ErrorRecovery
        transaction={failedTransaction}
        onRecoveryComplete={onComplete}
      />,
    );
    fireEvent.click(screen.getByText('Retry Transaction'));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  it('has role="alert" for accessibility', () => {
    const { container } = render(<ErrorRecovery transaction={failedTransaction} />);
    expect(container.querySelector('[role="alert"]')).toBeInTheDocument();
  });
});
