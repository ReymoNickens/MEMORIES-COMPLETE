import React, { useState } from 'react'

export interface CurrencyInputProps {
  valuePesewas: number
  onChange: (pesewas: number) => void
  currency?: string
  disabled?: boolean
  error?: string
}

export function CurrencyInput({ valuePesewas, onChange, currency = 'GHS', disabled, error }: CurrencyInputProps) {
  const [displayValue, setDisplayValue] = useState(valuePesewas > 0 ? (valuePesewas / 100).toFixed(2) : '')

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    setDisplayValue(raw)
    const parsed = parseFloat(raw)
    if (!isNaN(parsed) && parsed >= 0) {
      onChange(Math.round(parsed * 100))
    }
  }

  function handleBlur() {
    const parsed = parseFloat(displayValue)
    if (!isNaN(parsed)) {
      setDisplayValue(parsed.toFixed(2))
      onChange(Math.round(parsed * 100))
    }
  }

  return (
    <div>
      <div className={[
        'flex items-center border rounded-lg overflow-hidden',
        error ? 'border-[#B8122A]' : 'border-[#D8DCE2] focus-within:border-[#B8122A]',
      ].join(' ')}>
        <span className="px-3 text-sm text-[#6B7380] bg-gray-50 h-12 flex items-center border-r border-[#D8DCE2]">
          {currency}
        </span>
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={displayValue}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder="0.00"
          className="flex-1 h-12 px-3 text-base font-mono text-[#111111] focus:outline-none disabled:bg-gray-50"
        />
      </div>
      {error && <p className="mt-1 text-xs text-[#B8122A]">{error}</p>}
    </div>
  )
}
