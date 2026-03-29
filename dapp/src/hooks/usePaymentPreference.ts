import { useState, useCallback, useEffect } from 'react';

export type PaymentMethod = 'onramp' | 'stablecoin' | 'wallet';

const STORAGE_KEY = 'musd_preferred_payment_method';

/**
 * Hook for storing and retrieving user's preferred payment method.
 * Uses localStorage for persistence across sessions.
 * Validates stored values against allowed methods.
 *
 * Validates: Requirements 3.4, 3.5
 */
export const usePaymentPreference = () => {
  const [preferred, setPreferredState] = useState<PaymentMethod | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'onramp' || stored === 'stablecoin' || stored === 'wallet') {
        return stored;
      }
    } catch {
      // localStorage unavailable (SSR, private browsing, etc.)
    }
    return null;
  });

  // Keep localStorage in sync whenever preferred changes
  useEffect(() => {
    try {
      if (preferred) {
        localStorage.setItem(STORAGE_KEY, preferred);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Silently ignore storage errors
    }
  }, [preferred]);

  const setPreferred = useCallback((method: PaymentMethod | null) => {
    setPreferredState(method);
  }, []);

  const clear = useCallback(() => {
    setPreferredState(null);
  }, []);

  return { preferred, setPreferred, clear };
};
