// All amounts in integer pesewas. Never use floats for money.

export function toGHS(pesewas: number): string {
  return `GHS ${(pesewas / 100).toFixed(2)}`
}

export function toPesewas(ghs: number): number {
  if (!Number.isFinite(ghs)) throw new TypeError('ghs must be finite')
  return Math.round(ghs * 100)
}

export function formatAmount(pesewas: number): string {
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    minimumFractionDigits: 2,
  }).format(pesewas / 100)
}

export function assertPesewas(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`Expected non-negative integer pesewas, got: ${JSON.stringify(value)}`)
  }
}

/** Split a total so every pesewa is assigned. Remainder lands on the last part. */
export function splitPesewas(total: number, parts: number): number[] {
  assertPesewas(total)
  if (!Number.isInteger(parts) || parts < 1) {
    throw new TypeError('parts must be a positive integer')
  }
  const base = Math.floor(total / parts)
  const rem = total - base * parts
  const out = Array.from({ length: parts }, () => base)
  out[parts - 1] += rem
  return out
}
