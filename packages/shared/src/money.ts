// All amounts in integer pesewas. Never use floats.
export function toGHS(pesewas: number): string {
  return `GHS ${(pesewas / 100).toFixed(2)}`
}

export function toPesewas(ghs: number): number {
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
