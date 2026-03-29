import React, { useState } from "react"

import { OnrampWidget } from "./OnrampWidget"
import { QuoteDisplay } from "./QuoteDisplay"
import { useQuote } from "../hooks/useQuote"
import { useWalletInfo } from "../hooks/useWalletInfo"

interface BuyMUSDButtonProps {
  defaultAmount?: string
  onSuccess?: () => void
}

/**
 * Buy MUSD button with inline amount input and real-time quote display.
 * Implements Requirement 7.5: fee calculations update in real-time as amount changes.
 */
export const BuyMUSDButton: React.FC<BuyMUSDButtonProps> = ({
  defaultAmount = "100",
  onSuccess,
}) => {
  const [showWidget, setShowWidget] = useState(false)
  const [amount, setAmount] = useState(defaultAmount)
  const { isConnected } = useWalletInfo()

  // Real-time quote updates as user changes amount (Req 7.5)
  const { quote, loading, error } = useQuote(amount)

  const handleSuccess = (session: any) => {
    console.log("Onramp completed:", session)
    setShowWidget(false)
    onSuccess?.()
  }

  const handleError = (err: Error) => {
    console.error("Onramp error:", err)
  }

  if (showWidget) {
    return (
      <div className="onramp-modal">
        <div className="onramp-modal-content">
          <button
            className="onramp-modal-close"
            onClick={() => setShowWidget(false)}
            aria-label="Close"
          >
            ×
          </button>

          <h3 style={{ margin: "0 0 16px" }}>Buy MUSD</h3>

          <label className="amount-input-label" htmlFor="buy-amount">
            Amount (USD)
          </label>
          <input
            id="buy-amount"
            className="amount-input"
            type="number"
            min="1"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Enter amount"
          />

          <QuoteDisplay quote={quote} loading={loading} error={error} />

          <OnrampWidget
            sourceAmount={amount}
            sourceCurrency="usd"
            onSuccess={handleSuccess}
            onError={handleError}
          />
        </div>
      </div>
    )
  }

  return (
    <button
      className="buy-musd-button"
      onClick={() => setShowWidget(true)}
      disabled={!isConnected}
    >
      {isConnected ? "Buy MUSD with Card" : "Connect Wallet First"}
    </button>
  )
}
