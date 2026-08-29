import React, { useState } from 'react'
import { normalisePhone } from '@evolveit/shared/phone'

export interface PhoneInputProps {
  value: string
  onChange: (e164: string | null) => void
  error?: string | undefined
  placeholder?: string
  disabled?: boolean
}

export function PhoneInput({ value, onChange, error, placeholder = '024 412 3456', disabled }: PhoneInputProps) {
  const [raw, setRaw] = useState(value)

  function handleBlur() {
    const norm = normalisePhone(raw)
    onChange(norm)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setRaw(e.target.value)
    // Emit E.164 on every change if parseable
    const norm = normalisePhone(e.target.value)
    if (norm) onChange(norm)
  }

  return (
    <div>
      <div className={[
        'flex items-center border rounded-lg overflow-hidden transition-colors',
        error ? 'border-[#B8122A]' : 'border-[#D8DCE2] focus-within:border-[#B8122A]',
      ].join(' ')}>
        <span className="px-3 text-sm text-[#6B7380] bg-gray-50 h-12 flex items-center border-r border-[#D8DCE2] select-none">
          🇬🇭 +233
        </span>
        <input
          type="tel"
          inputMode="tel"
          value={raw}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 h-12 px-3 text-base text-[#111111] focus:outline-none disabled:bg-gray-50"
        />
      </div>
      {error && <p className="mt-1 text-xs text-[#B8122A]">{error}</p>}
    </div>
  )
}
