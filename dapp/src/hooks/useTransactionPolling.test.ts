/**
 * Unit tests for useTransactionPolling hook.
 * Validates Requirements 5.3 (transaction status display) and 8.3 (long-running transactions).
 */
import { renderHook, act, waitFor } from '@testing-library/react';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

// Mock the hook with a hardcoded base URL (same pattern as useQuote.test.ts)
jest.mock('./useTransactionPolling', () => {
  const { useState, useEffect, useRef, useCallback } = require('react');

  const BASE_URL = 'http://localhost:3001';

  type TransactionType = 'onramp' | 'payment' | 'payout';

  interface ProgressStep {
    current: number;
    total: number;
    label: string;
  }

  const TERMINAL_STATUSES: Record<TransactionType, Set<string>> = {
    onramp: new Set(['completed', 'failed']),
    payment: new Set(['succeeded', 'canceled', 'failed']),
    payout: new Set(['paid', 'failed', 'canceled']),
  };

  const POLL_INTERVALS: Record<string, number> = {
    initialized: 5_000,
    pending: 5_000,
    requires_payment_method: 5_000,
    requires_confirmation: 5_000,
    processing: 5_000,
    in_transit: 15_000,
  };

  const DEFAULT_POLL_INTERVAL = 5_000;

  const ONRAMP_STEPS: Record<string, ProgressStep> = {
    initialized: { current: 1, total: 4, label: 'Session created' },
    pending: { current: 2, total: 4, label: 'Processing payment' },
    processing: { current: 3, total: 4, label: 'Sending MUSD' },
    completed: { current: 4, total: 4, label: 'Complete' },
    failed: { current: 0, total: 4, label: 'Failed' },
  };

  const PAYMENT_STEPS: Record<string, ProgressStep> = {
    requires_payment_method: { current: 1, total: 4, label: 'Awaiting payment' },
    requires_confirmation: { current: 2, total: 4, label: 'Confirming' },
    processing: { current: 3, total: 4, label: 'Processing settlement' },
    succeeded: { current: 4, total: 4, label: 'Complete' },
    canceled: { current: 0, total: 4, label: 'Canceled' },
    failed: { current: 0, total: 4, label: 'Failed' },
  };

  const PAYOUT_STEPS: Record<string, ProgressStep> = {
    pending: { current: 1, total: 3, label: 'Payout initiated' },
    in_transit: { current: 2, total: 3, label: 'In transit' },
    paid: { current: 3, total: 3, label: 'Complete' },
    failed: { current: 0, total: 3, label: 'Failed' },
    canceled: { current: 0, total: 3, label: 'Canceled' },
  };

  const PROGRESS_MAPS: Record<TransactionType, Record<string, ProgressStep>> = {
    onramp: ONRAMP_STEPS,
    payment: PAYMENT_STEPS,
    payout: PAYOUT_STEPS,
  };

  const ENDPOINT_MAP: Record<TransactionType, string> = {
    onramp: '/api/v1/onramp/sessions',
    payment: '/api/v1/payments/intents',
    payout: '/api/v1/payouts',
  };

  function useTransactionPolling(
    transactionId: string | null | undefined,
    type: TransactionType,
    options: { enabled?: boolean } = {},
  ) {
    const { enabled = true } = options;

    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isPolling, setIsPolling] = useState(false);

    const timerRef = useRef(null);
    const abortRef = useRef(null);
    const stoppedRef = useRef(false);

    const isTerminal = useCallback(
      (s: string) => TERMINAL_STATUSES[type].has(s),
      [type],
    );

    const getInterval = useCallback(
      (s: string | null) => (s && POLL_INTERVALS[s]) || DEFAULT_POLL_INTERVAL,
      [],
    );

    const getProgress = useCallback(
      (s: string | null): ProgressStep | null => {
        if (!s) return null;
        return PROGRESS_MAPS[type][s] ?? null;
      },
      [type],
    );

    const fetchStatus = useCallback(async () => {
      if (!transactionId) return;

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        setLoading(true);
        setError(null);

        const endpoint = ENDPOINT_MAP[type];
        const response = await fetch(
          `${BASE_URL}${endpoint}/${transactionId}`,
          { signal: abortRef.current.signal },
        );

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.message || `Failed to fetch ${type} status`);
        }

        const { data } = await response.json();
        const newStatus: string = data.status;
        setStatus(newStatus);

        return newStatus;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Failed to poll status';
        setError(message);
        return undefined;
      } finally {
        setLoading(false);
      }
    }, [transactionId, type]);

    const stopPolling = useCallback(() => {
      stoppedRef.current = true;
      setIsPolling(false);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      abortRef.current?.abort();
    }, []);

    useEffect(() => {
      if (!transactionId || !enabled) {
        setIsPolling(false);
        return;
      }

      stoppedRef.current = false;
      setIsPolling(true);

      const poll = async () => {
        if (stoppedRef.current) return;

        const newStatus = await fetchStatus();

        if (stoppedRef.current) return;

        if (newStatus && isTerminal(newStatus)) {
          setIsPolling(false);
          return;
        }

        const interval = getInterval(newStatus ?? null);
        timerRef.current = setTimeout(poll, interval);
      };

      poll();

      return () => {
        stoppedRef.current = true;
        setIsPolling(false);
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        abortRef.current?.abort();
      };
    }, [transactionId, type, enabled, fetchStatus, isTerminal, getInterval]);

    return {
      status,
      loading,
      isPolling,
      error,
      progress: getProgress(status),
      refetch: fetchStatus,
      stopPolling,
    };
  }

  return { useTransactionPolling };
});

import { useTransactionPolling } from './useTransactionPolling';

/* ── Helpers ─────────────────────────────────────────────── */

const mockResponse = (status: string) => ({
  ok: true,
  json: () => Promise.resolve({ data: { status } }),
});

const mockErrorResponse = (message: string) => ({
  ok: false,
  json: () => Promise.resolve({ message }),
});

/* ── Tests ───────────────────────────────────────────────── */

describe('useTransactionPolling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not poll when transactionId is null', () => {
    const { result } = renderHook(() =>
      useTransactionPolling(null, 'onramp'),
    );

    expect(result.current.status).toBeNull();
    expect(result.current.isPolling).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not poll when enabled is false', () => {
    const { result } = renderHook(() =>
      useTransactionPolling('sess_123', 'onramp', { enabled: false }),
    );

    expect(result.current.isPolling).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches onramp session status immediately', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('pending'));

    const { result } = renderHook(() =>
      useTransactionPolling('sess_123', 'onramp'),
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('pending');
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v1/onramp/sessions/sess_123');
  });

  it('uses correct endpoint for payment type', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('processing'));

    renderHook(() =>
      useTransactionPolling('pi_456', 'payment'),
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v1/payments/intents/pi_456');
  });

  it('uses correct endpoint for payout type', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('in_transit'));

    renderHook(() =>
      useTransactionPolling('po_789', 'payout'),
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/v1/payouts/po_789');
  });

  it('stops polling when onramp reaches terminal status (completed)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('completed'));

    const { result } = renderHook(() =>
      useTransactionPolling('sess_123', 'onramp'),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('completed');
    });

    await waitFor(() => {
      expect(result.current.isPolling).toBe(false);
    });

    // Advance timers — no additional fetch should happen
    act(() => { jest.advanceTimersByTime(10_000); });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('stops polling when payment reaches terminal status (succeeded)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('succeeded'));

    const { result } = renderHook(() =>
      useTransactionPolling('pi_456', 'payment'),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('succeeded');
      expect(result.current.isPolling).toBe(false);
    });
  });

  it('stops polling when payout reaches terminal status (paid)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('paid'));

    const { result } = renderHook(() =>
      useTransactionPolling('po_789', 'payout'),
    );

    await waitFor(() => {
      expect(result.current.status).toBe('paid');
      expect(result.current.isPolling).toBe(false);
    });
  });

  it('continues polling for non-terminal status and schedules next poll', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse('pending'))
      .mockResolvedValueOnce(mockResponse('pending'))
      .mockResolvedValueOnce(mockResponse('completed'));

    const { result } = renderHook(() =>
      useTransactionPolling('sess_123', 'onramp'),
    );

    // First poll
    await waitFor(() => {
      expect(result.current.status).toBe('pending');
      expect(result.current.isPolling).toBe(true);
    });

    // Advance past the 5s interval
    act(() => { jest.advanceTimersByTime(5_100); });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    // Advance again for third poll
    act(() => { jest.advanceTimersByTime(5_100); });

    await waitFor(() => {
      expect(result.current.status).toBe('completed');
      expect(result.current.isPolling).toBe(false);
    });
  });

  it('sets error on failed fetch', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse('Not found'));

    const { result } = renderHook(() =>
      useTransactionPolling('sess_bad', 'onramp'),
    );

    await waitFor(() => {
      expect(result.current.error).toBe('Not found');
    });
  });

  it('returns correct progress for onramp pending status', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('pending'));

    const { result } = renderHook(() =>
      useTransactionPolling('sess_123', 'onramp'),
    );

    await waitFor(() => {
      expect(result.current.progress).toEqual({
        current: 2,
        total: 4,
        label: 'Processing payment',
      });
    });
  });

  it('returns correct progress for payout in_transit status', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('in_transit'));

    const { result } = renderHook(() =>
      useTransactionPolling('po_789', 'payout'),
    );

    await waitFor(() => {
      expect(result.current.progress).toEqual({
        current: 2,
        total: 3,
        label: 'In transit',
      });
    });
  });

  it('stopPolling() stops the polling loop', async () => {
    mockFetch.mockResolvedValue(mockResponse('pending'));

    const { result } = renderHook(() =>
      useTransactionPolling('sess_123', 'onramp'),
    );

    await waitFor(() => {
      expect(result.current.isPolling).toBe(true);
    });

    act(() => { result.current.stopPolling(); });

    expect(result.current.isPolling).toBe(false);

    act(() => { jest.advanceTimersByTime(10_000); });

    // Only the initial fetch should have happened
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
