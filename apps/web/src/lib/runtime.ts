export function paystackLive(): boolean {
  return (process.env['PAYSTACK_SECRET_KEY'] ?? '').startsWith('sk_live')
}

export function demoPaymentsAllowed(): boolean {
  if (paystackLive()) return false
  return process.env['EVOLVEIT_DEMO'] === '1'
}

export function paymentsConfigured(): boolean {
  const key = process.env['PAYSTACK_SECRET_KEY'] ?? ''
  return demoPaymentsAllowed() || key.startsWith('sk_test') || key.startsWith('sk_live')
}

export function webhookEventId(payload: { event?: string; data?: Record<string, unknown>; id?: unknown }): string {
  const dataId = payload.data?.id
  if (payload.event && dataId !== undefined && dataId !== null) {
    return `${payload.event}:${String(dataId)}`
  }
  if (typeof payload.id === 'string' || typeof payload.id === 'number') {
    return String(payload.id)
  }
  throw new Error('webhook_missing_id')
}
