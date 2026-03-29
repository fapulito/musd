/**
 * Unit tests for TransactionStatusBadge component.
 * Validates Requirements 5.3 (transaction status display) and 8.3 (long-running transactions).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TransactionStatusBadge } from './TransactionStatusBadge';

describe('TransactionStatusBadge', () => {
  it('renders the status label for a pending status', () => {
    render(<TransactionStatusBadge status="pending" />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders the status label for a completed status', () => {
    render(<TransactionStatusBadge status="completed" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders the status label for a failed status', () => {
    render(<TransactionStatusBadge status="failed" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('applies completed class for succeeded status', () => {
    const { container } = render(<TransactionStatusBadge status="succeeded" />);
    const indicator = container.querySelector('.tx-status-badge__indicator');
    expect(indicator?.classList.contains('tx-status-badge__indicator--completed')).toBe(true);
  });

  it('applies pending class for processing status', () => {
    const { container } = render(<TransactionStatusBadge status="processing" />);
    const indicator = container.querySelector('.tx-status-badge__indicator');
    expect(indicator?.classList.contains('tx-status-badge__indicator--pending')).toBe(true);
  });

  it('applies failed class for canceled status', () => {
    const { container } = render(<TransactionStatusBadge status="canceled" />);
    const indicator = container.querySelector('.tx-status-badge__indicator');
    expect(indicator?.classList.contains('tx-status-badge__indicator--failed')).toBe(true);
  });

  it('shows pulse animation for pending states', () => {
    const { container } = render(<TransactionStatusBadge status="pending" />);
    expect(container.querySelector('.tx-status-badge__pulse')).toBeInTheDocument();
  });

  it('does not show pulse animation for terminal states', () => {
    const { container } = render(<TransactionStatusBadge status="completed" />);
    expect(container.querySelector('.tx-status-badge__pulse')).not.toBeInTheDocument();
  });

  it('shows spinner when isPolling is true and status is pending', () => {
    const { container } = render(
      <TransactionStatusBadge status="pending" isPolling={true} />,
    );
    expect(container.querySelector('.tx-status-badge__spinner')).toBeInTheDocument();
  });

  it('does not show spinner when isPolling is false', () => {
    const { container } = render(
      <TransactionStatusBadge status="pending" isPolling={false} />,
    );
    expect(container.querySelector('.tx-status-badge__spinner')).not.toBeInTheDocument();
  });

  it('does not show spinner for terminal states even when isPolling is true', () => {
    const { container } = render(
      <TransactionStatusBadge status="completed" isPolling={true} />,
    );
    expect(container.querySelector('.tx-status-badge__spinner')).not.toBeInTheDocument();
  });

  it('shows progress bar when showProgressBar is true and progress is provided', () => {
    render(
      <TransactionStatusBadge
        status="pending"
        showProgressBar={true}
        progress={{ current: 2, total: 4, label: 'Processing payment' }}
      />,
    );
    expect(screen.getByTestId('tx-progress-bar')).toBeInTheDocument();
    expect(screen.getByText('Processing payment (2/4)')).toBeInTheDocument();
  });

  it('does not show progress bar when showProgressBar is false', () => {
    render(
      <TransactionStatusBadge
        status="pending"
        showProgressBar={false}
        progress={{ current: 2, total: 4, label: 'Processing payment' }}
      />,
    );
    expect(screen.queryByTestId('tx-progress-bar')).not.toBeInTheDocument();
  });

  it('does not show progress bar when progress is null', () => {
    render(
      <TransactionStatusBadge
        status="pending"
        showProgressBar={true}
        progress={null}
      />,
    );
    expect(screen.queryByTestId('tx-progress-bar')).not.toBeInTheDocument();
  });

  it('renders correct progress bar width', () => {
    const { container } = render(
      <TransactionStatusBadge
        status="in_transit"
        showProgressBar={true}
        progress={{ current: 2, total: 3, label: 'In transit' }}
      />,
    );
    const fill = container.querySelector('.tx-status-badge__progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('67%');
  });

  it('renders human-readable label for in_transit status', () => {
    render(<TransactionStatusBadge status="in_transit" />);
    expect(screen.getByText('In Transit')).toBeInTheDocument();
  });

  it('capitalizes unknown status strings', () => {
    render(<TransactionStatusBadge status="custom_status" />);
    expect(screen.getByText('Custom_status')).toBeInTheDocument();
  });
});
