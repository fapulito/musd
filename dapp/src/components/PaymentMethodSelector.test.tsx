/**
 * Unit tests for PaymentMethodSelector component.
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentMethodSelector } from './PaymentMethodSelector';

// Mock wagmi useAccount
jest.mock('wagmi', () => ({
  useAccount: jest.fn(() => ({ address: '0xABCDEF1234567890' })),
}));

import { useAccount } from 'wagmi';
const mockUseAccount = useAccount as jest.Mock;

describe('PaymentMethodSelector', () => {
  const onSelect = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockUseAccount.mockReturnValue({ address: '0xABCDEF1234567890' });
  });

  it('renders all three payment method options (Req 3.1)', () => {
    render(<PaymentMethodSelector onSelect={onSelect} hasWalletBalance />);

    expect(screen.getByText('Buy with Card (Stripe)')).toBeInTheDocument();
    expect(screen.getByText('Stablecoin Payment')).toBeInTheDocument();
    expect(screen.getByText('Direct Wallet Transfer')).toBeInTheDocument();
  });

  it('displays fee estimates when amount is provided (Req 3.2)', () => {
    render(
      <PaymentMethodSelector
        onSelect={onSelect}
        amount={100}
        hasWalletBalance
      />,
    );

    // Onramp fee: 100 * 0.029 + 0.30 = $3.20
    expect(screen.getByText('−$3.20')).toBeInTheDocument();
    // Net for onramp: 100 - 3.20 = 96.80
    expect(screen.getByText('Net: 96.80 MUSD')).toBeInTheDocument();

    // Stablecoin fee: 100 * 0.015 = $1.50
    expect(screen.getByText('−$1.50')).toBeInTheDocument();

    // Wallet fee: $0.00
    expect(screen.getByText('−$0.00')).toBeInTheDocument();
  });

  it('disables wallet option when wallet is not connected (Req 3.3)', () => {
    mockUseAccount.mockReturnValue({ address: undefined });

    render(<PaymentMethodSelector onSelect={onSelect} />);

    const walletOption = screen.getByText('Direct Wallet Transfer').closest('button');
    expect(walletOption).toBeDisabled();
    // Both stablecoin and wallet show this message when disconnected
    const messages = screen.getAllByText('Connect wallet first');
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it('disables wallet option when balance is insufficient (Req 3.3)', () => {
    render(
      <PaymentMethodSelector
        onSelect={onSelect}
        hasWalletBalance={false}
      />,
    );

    const walletOption = screen.getByText('Direct Wallet Transfer').closest('button');
    expect(walletOption).toBeDisabled();
    expect(screen.getByText('Insufficient MUSD balance')).toBeInTheDocument();
  });

  it('calls onSelect and saves preference when a method is clicked (Req 3.4)', () => {
    render(<PaymentMethodSelector onSelect={onSelect} hasWalletBalance />);

    fireEvent.click(screen.getByText('Stablecoin Payment').closest('button')!);

    expect(onSelect).toHaveBeenCalledWith('stablecoin');
    expect(localStorage.getItem('musd_preferred_payment_method')).toBe('stablecoin');
  });

  it('allows switching between methods before confirmation (Req 3.5)', () => {
    render(<PaymentMethodSelector onSelect={onSelect} hasWalletBalance />);

    fireEvent.click(screen.getByText('Buy with Card (Stripe)').closest('button')!);
    expect(onSelect).toHaveBeenLastCalledWith('onramp');

    fireEvent.click(screen.getByText('Direct Wallet Transfer').closest('button')!);
    expect(onSelect).toHaveBeenLastCalledWith('wallet');

    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('shows "Recommended" badge on the best method', () => {
    // With wallet balance, wallet should be recommended
    render(
      <PaymentMethodSelector
        onSelect={onSelect}
        amount={100}
        hasWalletBalance
      />,
    );

    expect(screen.getByText('Recommended')).toBeInTheDocument();
    // The badge should be inside the wallet option
    const walletOption = screen.getByText('Direct Wallet Transfer').closest('button');
    expect(walletOption?.querySelector('.pms__badge')).not.toBeNull();
  });

  it('shows wallet balance when available', () => {
    render(
      <PaymentMethodSelector
        onSelect={onSelect}
        hasWalletBalance
        walletBalance={250.5}
      />,
    );

    expect(screen.getByText('Balance: 250.50 MUSD')).toBeInTheDocument();
  });

  it('highlights the selected method', () => {
    render(
      <PaymentMethodSelector
        onSelect={onSelect}
        selectedMethod="stablecoin"
        hasWalletBalance
      />,
    );

    const stablecoinOption = screen.getByText('Stablecoin Payment').closest('button');
    expect(stablecoinOption?.classList.contains('pms__option--active')).toBe(true);
  });
});
