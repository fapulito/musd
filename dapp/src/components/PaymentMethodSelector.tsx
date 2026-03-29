import React, { useMemo } from 'react';
import { useAccount } from 'wagmi';
import { usePaymentPreference, type PaymentMethod } from '../hooks/usePaymentPreference';
import './PaymentMethodSelector.css';

interface PaymentMethodSelectorProps {
  /** Called when the user selects a payment method */
  onSelect: (method: PaymentMethod) => void;
  /** Currently selected method */
  selectedMethod?: PaymentMethod | null;
  /** Transaction amount in USD (used for fee calculation and recommendation) */
  amount?: number;
  /** Whether the user has a connected wallet with MUSD balance */
  hasWalletBalance?: boolean;
  /** User's MUSD wallet balance (for display) */
  walletBalance?: number;
}

interface MethodOption {
  id: PaymentMethod;
  label: string;
  description: string;
  feeLabel: string;
  calculateFee: (amount: number) => number;
  available: boolean;
  unavailableReason?: string;
}

/**
 * Calculate deposit fee: 2.9% + $0.30 (Stripe processing)
 * Requirement 7.1
 */
const calcOnrampFee = (amount: number): number =>
  amount > 0 ? amount * 0.029 + 0.3 : 0;

/**
 * Calculate stablecoin payment processing fee: 1.5%
 * From design doc StripeCryptoFees.stablecoinPayments
 */
const calcStablecoinFee = (amount: number): number =>
  amount > 0 ? amount * 0.015 : 0;

/**
 * Direct wallet transfer — no platform fee, only gas
 */
const calcWalletFee = (_amount: number): number => 0;

/**
 * Recommend the best payment method based on amount and wallet status.
 * - If user has sufficient wallet balance, direct wallet is cheapest (no fees).
 * - For smaller amounts, stablecoin payment may be cheaper than onramp
 *   because onramp has a flat $0.30 component.
 * - For users without crypto, onramp is the only option.
 */
const getRecommended = (
  amount: number,
  hasWalletBalance: boolean,
): PaymentMethod => {
  if (hasWalletBalance) return 'wallet';
  // Stablecoin fee (1.5%) vs onramp fee (2.9% + $0.30)
  // Stablecoin is always cheaper when user already holds MUSD-equivalent stablecoins
  // But if they don't have wallet balance, onramp is the entry point
  if (amount > 0 && calcStablecoinFee(amount) < calcOnrampFee(amount)) {
    return 'stablecoin';
  }
  return 'onramp';
};

/**
 * Payment method selector with fee comparison.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * - 3.1: Displays available Payment_Method options
 * - 3.2: Shows estimated fees and net MUSD for Stripe
 * - 3.3: Verifies wallet connection for MUSD wallet option
 * - 3.4: Stores preferred method via usePaymentPreference
 * - 3.5: Allows switching before confirmation
 */
export const PaymentMethodSelector: React.FC<PaymentMethodSelectorProps> = ({
  onSelect,
  selectedMethod,
  amount = 0,
  hasWalletBalance = false,
  walletBalance = 0,
}) => {
  const { address } = useAccount();
  const { preferred, setPreferred } = usePaymentPreference();

  const isWalletConnected = Boolean(address);

  const recommended = useMemo(
    () => getRecommended(amount, hasWalletBalance),
    [amount, hasWalletBalance],
  );

  const methods: MethodOption[] = useMemo(() => {
    const walletAvailable = isWalletConnected && hasWalletBalance;
    const walletReason = !isWalletConnected
      ? 'Connect wallet first'
      : !hasWalletBalance
        ? 'Insufficient MUSD balance'
        : undefined;

    return [
      {
        id: 'onramp',
        label: 'Buy with Card (Stripe)',
        description: 'Purchase MUSD using credit card or bank transfer via Stripe',
        feeLabel: '2.9% + $0.30',
        calculateFee: calcOnrampFee,
        available: true,
      },
      {
        id: 'stablecoin',
        label: 'Stablecoin Payment',
        description: 'Pay with MUSD — settles as fiat for the merchant',
        feeLabel: '1.5%',
        calculateFee: calcStablecoinFee,
        available: isWalletConnected,
        unavailableReason: !isWalletConnected ? 'Connect wallet first' : undefined,
      },
      {
        id: 'wallet',
        label: 'Direct Wallet Transfer',
        description: 'Send MUSD directly from your wallet — gas only',
        feeLabel: 'Gas only',
        calculateFee: calcWalletFee,
        available: walletAvailable,
        unavailableReason: walletReason,
      },
    ];
  }, [isWalletConnected, hasWalletBalance]);

  const active = selectedMethod ?? preferred;

  const handleSelect = (method: PaymentMethod) => {
    setPreferred(method);
    onSelect(method);
  };

  return (
    <div className="pms" role="radiogroup" aria-label="Payment method">
      <h3 className="pms__title">Choose Payment Method</h3>

      {methods.map((m) => {
        const fee = m.calculateFee(amount);
        const net = amount > 0 ? amount - fee : 0;
        const isActive = active === m.id;
        const isRecommended = recommended === m.id;

        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={!m.available}
            className={[
              'pms__option',
              isActive && 'pms__option--active',
              !m.available && 'pms__option--disabled',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => handleSelect(m.id)}
          >
            <div className="pms__option-header">
              <span className="pms__radio">{isActive ? '●' : '○'}</span>
              <span className="pms__label">{m.label}</span>
              {isRecommended && m.available && (
                <span className="pms__badge">Recommended</span>
              )}
            </div>

            <p className="pms__desc">{m.description}</p>

            {/* Fee comparison row */}
            <div className="pms__fees">
              <span className="pms__fee-label">Fee: {m.feeLabel}</span>
              {amount > 0 && (
                <>
                  <span className="pms__fee-amount">
                    −${fee.toFixed(2)}
                  </span>
                  <span className="pms__fee-net">
                    Net: {net.toFixed(2)} MUSD
                  </span>
                </>
              )}
            </div>

            {/* Wallet balance hint for wallet method */}
            {m.id === 'wallet' && m.available && walletBalance > 0 && (
              <p className="pms__balance">
                Balance: {walletBalance.toFixed(2)} MUSD
              </p>
            )}

            {!m.available && m.unavailableReason && (
              <p className="pms__unavailable">{m.unavailableReason}</p>
            )}
          </button>
        );
      })}

      {preferred && (
        <p className="pms__pref-note">
          Your preferred method ({preferred}) is saved for future sessions.
        </p>
      )}
    </div>
  );
};
