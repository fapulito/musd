import { useState, useCallback } from "react"
import { useSendTransaction } from "@mezo-org/passport"
import { encodeFunctionData, parseUnits } from "viem"

const MUSD_TOKEN_ADDRESS = import.meta.env
  .VITE_MUSD_TOKEN_ADDRESS as `0x${string}`
const PAYMENT_SERVICE_URL = import.meta.env.VITE_PAYMENT_SERVICE_URL as string

const ERC20_ABI = [
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const

export type PaymentStatus =
  | "idle"
  | "creating"
  | "awaiting_approval"
  | "processing"
  | "succeeded"
  | "failed"

interface PaymentIntentResult {
  clientSecret: string
  paymentIntentId: string
  musdAmount: string
  destinationAddress: string
}

interface UseStablecoinPaymentReturn {
  status: PaymentStatus
  error: string | null
  paymentIntentId: string | null
  txHash: string | null
  musdAmount: string | null
  createAndPay: (params: {
    amount: number
    currency: string
    walletAddress: string
    metadata?: Record<string, any>
  }) => Promise<void>
  reset: () => void
}

/**
 * Hook for managing MUSD stablecoin payment flow
 * Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3
 *
 * Flow:
 * 1. Create payment intent via backend
 * 2. Encode ERC20 transfer to Stripe's settlement address
 * 3. Sign and submit transaction via Mezo Passport
 */
export const useStablecoinPayment = (): UseStablecoinPaymentReturn => {
  const { sendTransaction } = useSendTransaction()

  const [status, setStatus] = useState<PaymentStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [musdAmount, setMusdAmount] = useState<string | null>(null)

  const reset = useCallback(() => {
    setStatus("idle")
    setError(null)
    setPaymentIntentId(null)
    setTxHash(null)
    setMusdAmount(null)
  }, [])

  const createAndPay = useCallback(
    async (params: {
      amount: number
      currency: string
      walletAddress: string
      metadata?: Record<string, any>
    }) => {
      const { amount, currency, walletAddress, metadata } = params

      if (!MUSD_TOKEN_ADDRESS) {
        setError("MUSD token address not configured")
        setStatus("failed")
        return
      }

      try {
        // Step 1: Create payment intent via backend
        setStatus("creating")
        setError(null)

        const response = await fetch(
          `${PAYMENT_SERVICE_URL}/api/v1/payments/intents`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount, currency, walletAddress, metadata }),
          },
        )

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}))
          throw new Error(
            errData.message || "Failed to create payment intent",
          )
        }

        const { data } = (await response.json()) as {
          data: PaymentIntentResult
        }
        setPaymentIntentId(data.paymentIntentId)
        setMusdAmount(data.musdAmount)

        if (!data.destinationAddress) {
          throw new Error("No settlement address returned from Stripe")
        }

        // Step 2: Encode ERC20 transfer to Stripe's settlement address
        setStatus("awaiting_approval")

        const transferData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [
            data.destinationAddress as `0x${string}`,
            parseUnits(data.musdAmount, 18),
          ],
        })

        // Step 3: Sign and submit via Mezo Passport smart account
        const result = await sendTransaction(
          MUSD_TOKEN_ADDRESS,
          0n,
          transferData,
        )

        const txHashValue = result?.hash ?? null
        setTxHash(txHashValue)
        setStatus("processing")

        // Payment confirmation happens via webhook on the backend.
        // We optimistically show "processing" — the UI can poll
        // GET /api/v1/payments/intents/:id for final status.
        setStatus("succeeded")
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Payment failed"
        setError(message)
        setStatus("failed")
      }
    },
    [sendTransaction],
  )

  return {
    status,
    error,
    paymentIntentId,
    txHash,
    musdAmount,
    createAndPay,
    reset,
  }
}
