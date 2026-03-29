import { useState, useEffect, useRef, useCallback } from 'react';

const PAYMENT_SERVICE_URL = import.meta.env.VITE_PAYMENT_SERVICE_URL as string;

export type TransactionType = 'onramp' | 'payment' | 'payout';

/**
 * Terminal statuses per transaction type — polling stops when one of these is reached.
 */
const TERMINAL_STATUSES: Record<TransactionType, Set<string>> = {
  onramp: new Set(['completed', 'failed']),
  payment: new Set(['succeeded', 'canceled', 'failed']),
  payout: new Set(['paid', 'failed', 'canceled']),
};

/**
 * Polling intervals (ms) based on current status.
 * Pending/active states poll faster; in-transit states poll slower.
 */
const POLL_INTERVALS: Record<string, number> = {
  // Fast polling (5s)
  initialized: 5_000,
  pending: 5_000,
  requires_payment_method: 5_000,
  requires_confirmation: 5_000,
  processing: 5_000,
  // Slower polling (15s) for long-running states
  in_transit: 15_000,
};

const DEFAULT_POLL_INTERVAL = 5_000;

/**
 * Progress step mapping for multi-step transaction flows.
 * Returns a { current, total, label } object for UI progress indicators.
 */
export interface ProgressStep {
  current: number;
  total: number;
  label: string;
}

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

/** Endpoint path per transaction type */
const ENDPOINT_MAP: Record<TransactionType, string> = {
  onramp: '/api/v1/onramp/sessions',
  payment: '/api/v1/payments/intents',
  payout: '/api/v1/payouts',
};

export interface UseTransactionPollingReturn {
  /** Current transaction status string from the backend */
  status: string | null;
  /** Whether a fetch is currently in-flight */
  loading: boolean;
  /** Whether polling is actively running */
  isPolling: boolean;
  /** Error message if the last poll failed */
  error: string | null;
  /** Progress step info for UI indicators */
  progress: ProgressStep | null;
  /** Manually trigger a single poll */
  refetch: () => void;
  /** Stop polling early */
  stopPolling: () => void;
}

/**
 * Hook that polls a transaction's status endpoint at adaptive intervals.
 *
 * Requirements: 5.3 (display transaction status), 8.3 (handle long-running transactions)
 *
 * @param transactionId - The ID of the transaction to poll
 * @param type - The transaction type (onramp, payment, payout)
 * @param options.enabled - Whether polling should start (default: true when id is provided)
 */
export function useTransactionPolling(
  transactionId: string | null | undefined,
  type: TransactionType,
  options: { enabled?: boolean } = {},
): UseTransactionPollingReturn {
  const { enabled = true } = options;

  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
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
        `${PAYMENT_SERVICE_URL}${endpoint}/${transactionId}`,
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
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
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

  // Main polling loop
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

      // Schedule next poll with adaptive interval
      const interval = getInterval(newStatus ?? null);
      timerRef.current = setTimeout(poll, interval);
    };

    // Initial fetch immediately
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
