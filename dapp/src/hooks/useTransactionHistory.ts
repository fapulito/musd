import { useState, useCallback, useEffect } from 'react';

const PAYMENT_SERVICE_URL = import.meta.env.VITE_PAYMENT_SERVICE_URL as string;

export interface Transaction {
  id: string;
  userId: string;
  type: 'onramp' | 'payment' | 'payout';
  status: string;
  fiatAmount: number;
  fiatCurrency: string;
  musdAmount: number;
  fees: number;
  stripePaymentId: string | null;
  stripePayoutId: string | null;
  txHash: string | null;
  blockNumber: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface TransactionFilters {
  type?: 'onramp' | 'payment' | 'payout';
  status?: string;
  startDate?: string;
  endDate?: string;
}

interface TransactionHistoryState {
  transactions: Transaction[];
  total: number;
  hasMore: boolean;
  page: number;
  loading: boolean;
  error: string | null;
}

export function useTransactionHistory(walletAddress: string | undefined) {
  const [state, setState] = useState<TransactionHistoryState>({
    transactions: [],
    total: 0,
    hasMore: false,
    page: 1,
    loading: false,
    error: null,
  });
  const [filters, setFilters] = useState<TransactionFilters>({});
  const limit = 10;

  const fetchTransactions = useCallback(
    async (page: number, currentFilters: TransactionFilters) => {
      if (!walletAddress) return;

      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const params = new URLSearchParams({
          walletAddress,
          page: String(page),
          limit: String(limit),
        });

        if (currentFilters.type) params.set('type', currentFilters.type);
        if (currentFilters.status) params.set('status', currentFilters.status);
        if (currentFilters.startDate) params.set('startDate', currentFilters.startDate);
        if (currentFilters.endDate) params.set('endDate', currentFilters.endDate);

        const response = await fetch(
          `${PAYMENT_SERVICE_URL}/api/v1/transactions?${params.toString()}`,
        );

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.message || 'Failed to fetch transactions');
        }

        const { data } = await response.json();

        setState({
          transactions: data.transactions,
          total: data.total,
          hasMore: data.hasMore,
          page,
          loading: false,
          error: null,
        });
      } catch (err) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
    },
    [walletAddress],
  );

  // Refetch when wallet or filters change
  useEffect(() => {
    if (walletAddress) {
      fetchTransactions(1, filters);
    }
  }, [walletAddress, filters, fetchTransactions]);

  const goToPage = useCallback(
    (page: number) => {
      fetchTransactions(page, filters);
    },
    [fetchTransactions, filters],
  );

  const applyFilters = useCallback((newFilters: TransactionFilters) => {
    setFilters(newFilters);
  }, []);

  const exportCSV = useCallback(async () => {
    if (!walletAddress) return;

    const params = new URLSearchParams({ walletAddress });
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);

    const response = await fetch(
      `${PAYMENT_SERVICE_URL}/api/v1/transactions/export?${params.toString()}`,
    );

    if (!response.ok) {
      throw new Error('Failed to export transactions');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions_${walletAddress.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [walletAddress, filters]);

  return {
    ...state,
    filters,
    applyFilters,
    goToPage,
    exportCSV,
    refresh: () => fetchTransactions(state.page, filters),
  };
}
