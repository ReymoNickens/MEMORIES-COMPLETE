import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

/**
 * Release tables that never turned up, and forfeit the deposit.
 *
 * This used to write the status flip and a lone credit to forfeiture_income
 * with no matching debit — income appearing from nowhere while the liability
 * the club was carrying stayed on the book forever. The 017 ledger balance
 * trigger now rejects that outright, so both legs go through
 * forfeit_reservation_deposit, which is also what the floor screen calls when
 * a manager marks a no-show by hand.
 */
Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 })
  }

  // An hour past the booking is the grace the floor gives before the table
  // goes back on sale.
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { data: noShows, error } = await supabase
    .from('table_reservations')
    .select('id, guest_name, deposit_pesewas')
    .eq('status', 'confirmed')
    .lt('reserved_for', cutoff)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  let processed = 0
  let forfeited = 0
  const failures: string[] = []

  for (const reservation of (noShows ?? [])) {
    const { data, error: rpcError } = await supabase.rpc('forfeit_reservation_deposit', {
      p_reservation_id: reservation.id,
    })
    if (rpcError) {
      failures.push(`${reservation.id}: ${rpcError.message}`)
      continue
    }
    processed++
    forfeited += Number((data as Record<string, unknown> | null)?.['forfeited_pesewas'] ?? 0)
  }

  if (failures.length > 0) console.error('no-show failures:', failures.join('; '))

  return new Response(
    JSON.stringify({ processed, forfeited_pesewas: forfeited, failures: failures.length }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
