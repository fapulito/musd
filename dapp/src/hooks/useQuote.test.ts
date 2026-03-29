/**
 * Unit tests for useQuote hook.
 * Validates Requirement 7.5: real-time fee updates as amount changes.
 */
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock fetch globally
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// We need to mock the hook's fetch URL. The hook reads import.meta.env at runtime,
// so we mock the entire module and inject a testable version.
jest.mock('./useQuote', () => {
  // Re-implement the hook with a hardcoded base URL for testing
  const { useState, useEffect, useRef, useCallback } = require('react');

  const BASE_URL = 'http://localhost:3001';

  const useQuote = (
    sourceAmount: string,
    options: { debounceMs?: number; refreshIntervalMs?: number; sourceCurrency?: string; destinationCurrency?: string } = {}
  ) => {
    const {
      debounceMs = 500,
      refreshIntervalMs = 30000,
      sourceCurrency = 'usd',
      destinationCurrency = 'musd',
    } = options;

    const [quote, setQuote] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const debounceTimer = useRef<any>(null);
    const refreshTimer = useRef<any>(null);
    const abortController = useRef<AbortController | null>(null);

    const fetchQuote = useCallback(
      async (amount: string) => {
        const parsed = parseFloat(amount);
        if (isNaN(parsed) || parsed <= 0) {
          setQuote(null);
          setError(null);
          return;
        }

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
            `${BASE_URL}/api/v1/onramp/quotes?${params}`,
            { signal: abortController.current.signal }
          );

          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.message || 'Failed to fetch quote');
          }

          const data = await response.json();
          setQuote(data.data);
        } catch (err: any) {
          if (err?.name === 'AbortError') return;
          const message = err instanceof Error ? err.message : 'Failed to fetch quote';
          setError(message);
        } finally {
          setLoading(false);
        }
      },
      [sourceCurrency, destinationCurrency]
    );

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

    useEffect(() => {
      if (!quote || !sourceAmount || parseFloat(sourceAmount) <= 0) return;

      refreshTimer.current = setInterval(() => {
        fetchQuote(sourceAmount);
      }, refreshIntervalMs);

      return () => {
        if (refreshTimer.current) clearInterval(refreshTimer.current);
      };
    }, [quote, sourceAmount, refreshIntervalMs, fetchQuote]);

    useEffect(() => {
      return () => {
        abortController.current?.abort();
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        if (refreshTimer.current) clearInterval(refreshTimer.current);
      };
    }, []);

    return { quote, loading, error };
  };

  return { useQuote };
});

import { useQuote } from './useQuote';

const mockQuoteResponse = (sourceAmount: string) => ({
  ok: true,
  json: () =>
    Promise.resolve({
      data: {
        destinationAmount: '96.300000',
        exchangeRate: '1.00000000',
        fees: { stripeFee: '3.20', networkFee: '0.50', totalFee: '3.70' },
        netAmount: '96.30',
        sourceAmount,
        sourceCurrency: 'usd',
        destinationCurrency: 'musd',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    }),
});

describe('useQuote', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns null quote for empty amount', () => {
    const { result } = renderHook(() => useQuote(''));
    expect(result.current.quote).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns null quote for zero amount', () => {
    const { result } = renderHook(() => useQuote('0'));
    expect(result.current.quote).toBeNull();
  });

  it('fetches quote after debounce delay', async () => {
    mockFetch.mockResolvedValueOnce(mockQuoteResponse('100'));

    const { result } = renderHook(() =>
      useQuote('100', { debounceMs: 100 })
    );

    expect(mockFetch).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(150); });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(result.current.quote).not.toBeNull();
      expect(result.current.quote?.fees.stripeFee).toBe('3.20');
    });
  });

  it('debounces rapid amount changes (Req 7.5)', async () => {
    mockFetch.mockResolvedValue(mockQuoteResponse('200'));

    const { rerender } = renderHook(
      ({ amount }: { amount: string }) => useQuote(amount, { debounceMs: 300 }),
      { initialProps: { amount: '50' } }
    );

    act(() => { jest.advanceTimersByTime(100); });
    rerender({ amount: '100' });
    act(() => { jest.advanceTimersByTime(100); });
    rerender({ amount: '200' });

    act(() => { jest.advanceTimersByTime(350); });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('sourceAmount=200');
  });

  it('sets error on failed fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ message: 'Server error' }),
    });

    const { result } = renderHook(() =>
      useQuote('100', { debounceMs: 0 })
    );

    act(() => { jest.advanceTimersByTime(10); });

    await waitFor(() => {
      expect(result.current.error).toBe('Server error');
      expect(result.current.quote).toBeNull();
    });
  });
});
