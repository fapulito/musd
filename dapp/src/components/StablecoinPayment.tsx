import { useState } from "react"
import { useAccount } from "wagmi"
import {
  useStablecoinPayment,
  type PaymentStatus,
} from "../hooks/useStablecoinPayment"

interface StablecoinPaymentProps {
  onSuccess?: (paymentIntentId: string, txHash: string | null) => void
  onError?: (error: string) => void
}

const PROCESSING_FEE_RATE = 0.015 // 1.5%

const STATUS_LABELS: Record<PaymentStatus, string> = {
  idle: "",
  creating: "Creating payment intent…",
  awaiting_approval: "Please approve the MUSD transfer in your wallet",
  processing: "Transaction submitted, confirming…",
  succeeded: "Payment succeeded!",
  failed: "Payment failed",
}

export const StablecoinPayment: React.FC<StablecoinPaymentProps> = ({
  onSuccess,
  onError,
}) => {
  const { address: matsnetAddress } = useAccount()
  const {
    status,
    error,
    paymentIntentId,
    txHash,
    musdAmount: paidMusdAmount,
    createAndPay,
    reset,
  } = useStablecoinPayment()

  const [amountUsd, setAmountUsd] = useState("")
  const [currency] = useState("usd")

  const parsedAmount = parseFloat(amountUsd) || 0
  const fee = parsedAmount * PROCESSING_FEE_RATE
  const musdTotal = parsedAmount + fee
  const amountCents = Math.round(parsedAmount * 100)

  const isLoading =
    status === "creating" ||
    status === "awaiting_approval" ||
    status === "processing"

  const handlePay = async () => {
    if (!matsnetAddress) return

    await createAndPay({
      amount: amountCents,
      currency,
      walletAddress: matsnetAddress,
    })

    if (status === "succeeded" && paymentIntentId) {
      onSuccess?.(paymentIntentId, txHash)
    }
  }

  // Notify parent on error
  if (status === "failed" && error) {
    onError?.(error)
  }

  if (!matsnetAddress) {
    return (
      <div className="stablecoin-payment">
        <p>Please connect your wallet to pay with MUSD</p>
      </div>
    )
  }

  return (
    <div className="stablecoin-payment">
      <h3>Pay with MUSD</h3>

      {status === "succeeded" ? (
        <div className="payment-success">
          <p>✅ {STATUS_LABELS.succeeded}</p>
          {paidMusdAmount && <p>MUSD sent: {paidMusdAmount}</p>}
          {txHash && (
            <p className="tx-hash">
              Tx: {txHash.slice(0, 10)}…{txHash.slice(-8)}
            </p>
          )}
          <button onClick={reset}>Make another payment</button>
        </div>
      ) : (
        <>
          {/* Amount input */}
          <div className="payment-input">
            <label htmlFor="payment-amount">Amount (USD)</label>
            <input
              id="payment-amount"
              type="number"
              min="0.50"
              step="0.01"
              placeholder="0.00"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              disabled={isLoading}
            />
          </div>

          {/* Fee breakdown */}
          {parsedAmount > 0 && (
            <div className="fee-breakdown">
              <div className="fee-row">
                <span>Amount</span>
                <span>${parsedAmount.toFixed(2)}</span>
              </div>
              <div className="fee-row">
                <span>Processing fee (1.5%)</span>
                <span>${fee.toFixed(2)}</span>
              </div>
              <div className="fee-row total">
                <span>Total MUSD</span>
                <span>{musdTotal.toFixed(6)} MUSD</span>
              </div>
            </div>
          )}

          {/* Status message */}
          {status !== "idle" && (
            <div
              className={`payment-status ${status === "failed" ? "error" : ""}`}
            >
              <p>{STATUS_LABELS[status]}</p>
              {error && <p className="error-message">{error}</p>}
            </div>
          )}

          {/* Pay button */}
          <button
            onClick={handlePay}
            disabled={isLoading || parsedAmount <= 0}
            className="pay-button"
          >
            {isLoading
              ? STATUS_LABELS[status]
              : `Pay ${parsedAmount > 0 ? `$${parsedAmount.toFixed(2)}` : ""} with MUSD`}
          </button>

          {status === "failed" && (
            <button onClick={reset} className="retry-button">
              Try again
            </button>
          )}
        </>
      )}
    </div>
  )
}
