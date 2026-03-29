import React from 'react';
import type { QuoteData } from '../hooks/useQuote';

interface QuoteDisplayProps {
  quote: QuoteData | null;
  loading: boolean;
  error: string | null;
}

/**
 * Displays onramp quote with fee breakdown.
 * Implements Requirements 7.1-7.4:
 *  - 7.1: Stripe processing fee (2.9% + $0.30)
 *  - 7.3: Estimated MUSD amount after fees
 *  - 7.4: Fee breakdown (Stripe fee, network fee, net amount)
 */
export const QuoteDisplay: React.FC<QuoteDisplayProps> = ({
  quote,
  loading,
  error,
}) => {
  if (error) {
    return (
      <div className="quote-display quote-display--error" role="alert">
        <p>Unable to fetch quote: {error}</p>
      </div>
    );
  }

  if (loading && !quote) {
    return (
      <div className="quote-display quote-display--loading" aria-busy="true">
        <div className="quote-display__spinner" />
        <p>Fetching quote…</p>
      </div>
    );
  }

  if (!quote) return null;

  return (
    <div className="quote-display" aria-live="polite">
      {loading && <div className="quote-display__refreshing">Updating…</div>}

      <h4 className="quote-display__title">Fee Breakdown</h4>

      <dl className="quote-display__rows">
        <div className="quote-display__row">
          <dt>Amount</dt>
          <dd>${quote.sourceAmount} {quote.sourceCurrency.toUpperCase()}</dd>
        </div>

        <div className="quote-display__row">
          <dt>Stripe Fee (2.9% + $0.30)</dt>
          <dd>−${quote.fees.stripeFee}</dd>
        </div>

        <div className="quote-display__row">
          <dt>Network Fee</dt>
          <dd>−${quote.fees.networkFee}</dd>
        </div>

        <div className="quote-display__row quote-display__row--total">
          <dt>Total Fees</dt>
          <dd>−${quote.fees.totalFee}</dd>
        </div>

        <div className="quote-display__row quote-display__row--highlight">
          <dt>You'll Receive</dt>
          <dd>
            {parseFloat(quote.destinationAmount).toFixed(2)}{' '}
            {quote.destinationCurrency.toUpperCase()}
          </dd>
        </div>
      </dl>

      <p className="quote-display__rate">
        Rate: 1 {quote.sourceCurrency.toUpperCase()} ={' '}
        {parseFloat(quote.exchangeRate).toFixed(4)}{' '}
        {quote.destinationCurrency.toUpperCase()}
      </p>
    </div>
  );
};
