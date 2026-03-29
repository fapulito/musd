/**
 * Unit tests for usePaymentPreference hook.
 * Validates: Requirements 3.4 (store preferred method), 3.5 (allow switching)
 */
import { renderHook, act } from '@testing-library/react';
import { usePaymentPreference } from './usePaymentPreference';

const STORAGE_KEY = 'musd_preferred_payment_method';

describe('usePaymentPreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no preference is stored', () => {
    const { result } = renderHook(() => usePaymentPreference());
    expect(result.current.preferred).toBeNull();
  });

  it('reads a valid stored preference on mount', () => {
    localStorage.setItem(STORAGE_KEY, 'wallet');
    const { result } = renderHook(() => usePaymentPreference());
    expect(result.current.preferred).toBe('wallet');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem(STORAGE_KEY, 'paypal');
    const { result } = renderHook(() => usePaymentPreference());
    expect(result.current.preferred).toBeNull();
  });

  it('persists preference to localStorage when set (Req 3.4)', () => {
    const { result } = renderHook(() => usePaymentPreference());

    act(() => {
      result.current.setPreferred('onramp');
    });

    expect(result.current.preferred).toBe('onramp');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('onramp');
  });

  it('allows switching preference (Req 3.5)', () => {
    const { result } = renderHook(() => usePaymentPreference());

    act(() => { result.current.setPreferred('onramp'); });
    expect(result.current.preferred).toBe('onramp');

    act(() => { result.current.setPreferred('stablecoin'); });
    expect(result.current.preferred).toBe('stablecoin');

    act(() => { result.current.setPreferred('wallet'); });
    expect(result.current.preferred).toBe('wallet');

    expect(localStorage.getItem(STORAGE_KEY)).toBe('wallet');
  });

  it('clears preference from state and storage', () => {
    localStorage.setItem(STORAGE_KEY, 'onramp');
    const { result } = renderHook(() => usePaymentPreference());

    act(() => { result.current.clear(); });

    expect(result.current.preferred).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
