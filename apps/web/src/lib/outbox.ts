type ServiceClient = {
  from: (table: string) => {
    insert: (rows: unknown) => Promise<{ error: { message: string; code?: string } | null }>
  }
}

export type OutboxKind =
  | 'ticket_delivery'
  | 'installment_reminder'
  | 'installment_defaulted'
  | 'reservation_deposit'
  | 'reservation_cancelled'

/**
 * Queue a message instead of sending it inline.
 *
 * Sending from the webhook would put Meta's and Arkesel's availability on the
 * critical path of issuing a ticket: a slow send holds the webhook open, and a
 * failed one either loses the message or fails a webhook whose tickets are
 * already in the database. The row is written here and drained by
 * `/api/jobs/notifications`, so a message survives the process dying.
 *
 * `dedupeKey` makes re-enqueueing harmless — Paystack redelivers, and issuance
 * is idempotent, so this has to be too.
 */
export async function enqueue(
  supabase: ServiceClient,
  rows: Array<{
    tenant_id: string
    kind: OutboxKind
    to_phone: string
    payload: Record<string, unknown>
    dedupe_key: string
  }>,
): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase.from('notification_outbox').insert(rows)
  // 23505 is the dedupe key doing its job on a redelivery.
  if (error && error.code !== '23505') {
    console.error('outbox enqueue failed:', error.message)
  }
}

export function ticketDeepLink(ticketId: string, accessToken: string): string {
  const base = process.env['NEXT_PUBLIC_APP_URL'] ?? ''
  return `${base}/tickets/${ticketId}?access=${accessToken}`
}
