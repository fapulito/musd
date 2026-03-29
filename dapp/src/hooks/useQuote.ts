import { useState, useEffect, useRef, useCallback } from 'react';

export interface QuoteData {
  destinationAmount: string;
  exchangeRate: string;
  fees: {
    stripeFee: string;
    networkFee: string;
    totalFee: string;
  };
  netAmount: string;
  sourceAmount: string;
  sourceCurrency: string;
  destinationCurrency: string;
  expiresAt: string;
}

interface UseQuoteOptions {
  /** Debounce delay in ms before fetching a new quote (default: 500) */
  debounceMs?: number;
  /** Auto-refresh interval in ms (default: 30000 = 30s) */
  refreshIntervalMs?: number;
  sourceCurrency?: string;
  destinationCurrency?: string;
}

/**
 * Hook for fetching onramp quotes with debounce and auto-refresh.
 * Implements Requirement 7.5: real-time fee updates as amount changes.
 */
export const useQuote = (
  sourceAmount: string,
  options: UseQuoteOptions = {}
) => {
  const {
    debounceMs = 500,
    refreshIntervalMs = 30000,
    sourceCurrency = 'usd',
    destinationCurrency = 'musd',
  } = options;

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortController = useRef<AbortController | null>(null);

  const fetchQuote = useCallback(
    async (amount: string) => {
      const parsed = parseFloat(amount);
      if (isNaN(parsed) || parsed <= 0) {
        setQuote(null);
        setError(null);
        return;
      }

      // Cancel any in-flight request
      abortController.current?.abort();
      abortController.current = new AbortController();

      try {
        setLoading(true);
        setError(null);

        const params = new URLSearchParams({
          sourceAmount: amount,
          sourceCurrency,
          destinationCurrency,
        });

        const response = await fetch(
          `${import.meta.env.VITE_PAYMENT_SERVICE_URL}/api/v1/onramp/quotes?${params}`,
          { signal: abortController.current.signal }
        );

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.message || 'Failed to fetch quote');
        }

        const data = await response.json();
        setQuote(data.data);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Failed to fetch quote';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [sourceCurrency, destinationCurrency]
  );

  // Debounced fetch when sourceAmount changes (Req 7.5: real-time updates)
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (refreshTimer.current) clearTimeout(refreshTimer.current);

    if (!sourceAmount || parseFloat(sourceAmount) <= 0) {
      setQuote(null);
      setError(null);
      setLoading(false);
      return;
    }

    debounceTimer.current = setTimeout(() => {
      fetchQuote(sourceAmount);
    }, debounceMs);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [sourceAmount, debounceMs, fetchQuote]);

  // Auto-refresh while a valid quote exists
  useEffect(() => {
    if (!quote || !sourceAmount || parseFloat(sourceAmount) <= 0) return;

    refreshTimer.current = setInterval(() => {
      fetchQuote(sourceAmount);
    }, refreshIntervalMs);

    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [quote, sourceAmount, refreshIntervalMs, fetchQuote]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortController.current?.abort();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, []);

  return { quote, loading, error };
};
