import { useState, useEffect, useRef, useCallback } from 'react';

export type FeeTransactionType = 'deposit' | 'withdrawal' | 'stablecoin_payment';

export interface FeeEstimate {
  amount: number;
  currency: string;
  transactionType: FeeTransactionType;
  stripeFee: number;
  platformFee: number;
  totalFee: number;
  netAmount: number;
}

export interface FeeComparison {
  method: string;
  label: string;
  stripeFee: number;
  platformFee: number;
  totalFee: number;
  netAmount: number;
}

interface UseFeeEstimateOptions {
  /** Debounce delay in ms (default: 400) */
  debounceMs?: number;
  /** Currency code (default: 'usd') */
  currency?: string;
  /** Also fetch fee comparison across methods */
  includeComparison?: boolean;
}

/**
 * Hook that calls the fee estimation API and updates in real-time as
 * the amount changes, with debouncing to avoid excessive requests.
 *
 * Validates: Requirement 7.5 — real-time fee updates as amount changes
 */
export const useFeeEstimate = (
  amount: string,
  transactionType: FeeTransactionType,
  options: UseFeeEstimateOptions = {},
) => {
  const {
    debounceMs = 400,
    currency = 'usd',
    includeComparison = false,
  } = options;

  const [estimate, setEstimate] = useState<FeeEstimate | null>(null);
  const [comparison, setComparison] = useState<FeeComparison[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortController = useRef<AbortController | null>(null);

  const baseUrl = import.meta.env.VITE_PAYMENT_SERVICE_URL || '';

  const fetchEstimate = useCallback(
    async (amt: string) => {
      const parsed = parseFloat(amt);
      if (isNaN(parsed) || parsed <= 0) {
        setEstimate(null);
        setComparison(null);
        setError(null);
        return;
      }

      // Cancel any in-flight request
      abortController.current?.abort();
      abortController.current = new AbortController();
      const signal = abortController.current.signal;

      try {
        setLoading(true);
        setError(null);

        // Fetch fee estimate
        const params = new URLSearchParams({
          amount: amt,
          currency,
          transactionType,
        });

        const res = await fetch(
          `${baseUrl}/api/v1/fees/estimate?${params}`,
          { signal },
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || 'Failed to fetch fee estimate');
        }

        const { data } = await res.json();
        setEstimate(data);

        // Optionally fetch comparison
        if (includeComparison) {
          const compParams = new URLSearchParams({ amount: amt, currency });
          const compRes = await fetch(
            `${baseUrl}/api/v1/fees/compare?${compParams}`,
            { signal },
          );

          if (compRes.ok) {
            const compBody = await compRes.json();
            setComparison(compBody.data);
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message =
          err instanceof Error ? err.message : 'Failed to fetch fee estimate';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, currency, transactionType, includeComparison],
  );

  // Debounced fetch when amount or transactionType changes (Req 7.5)
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (!amount || parseFloat(amount) <= 0) {
      setEstimate(null);
      setComparison(null);
      setError(null);
      setLoading(false);
      return;
    }

    debounceTimer.current = setTimeout(() => {
      fetchEstimate(amount);
    }, debounceMs);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [amount, debounceMs, fetchEstimate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortController.current?.abort();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  return { estimate, comparison, loading, error };
};
