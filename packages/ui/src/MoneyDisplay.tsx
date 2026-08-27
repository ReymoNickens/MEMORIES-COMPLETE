import React from 'react'
import { formatAmount } from '@evolveit/shared/money'

export interface MoneyDisplayProps {
  pesewas: number
  className?: string
}

export function MoneyDisplay({ pesewas, className = '' }: MoneyDisplayProps) {
  return (
    <span
      className={`font-mono text-[14px] leading-[1.4] ${className}`}
      style={{ fontFamily: "'Courier New', Courier, monospace" }}
    >
      {formatAmount(pesewas)}
    </span>
  )
}
