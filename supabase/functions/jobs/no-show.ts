import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Reservations where status=confirmed AND reserved_for + 60min < now
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { data: noShows } = await supabase
    .from('table_reservations')
    .select('id, tenant_id, deposit_pesewas, guest_name, guest_phone')
    .eq('status', 'confirmed')
    .lt('reserved_for', cutoff)

  let processed = 0

  for (const reservation of (noShows ?? [])) {
    await supabase
      .from('table_reservations')
      .update({ status: 'no_show' })
      .eq('id', reservation.id)

    if ((reservation.deposit_pesewas as number) > 0) {
      // Both legs. Forfeiting a deposit releases a liability the club was
      // holding and recognises it as income; posting only the credit left the
      // book unbalanced, and the ledger balance trigger now rejects it.
      await supabase.from('ledger_entries').insert([
        {
          tenant_id: reservation.tenant_id,
          account: 'deposit_liability',
          direction: 'DR',
          amount_pesewas: reservation.deposit_pesewas,
          ref_type: 'settlement',
          ref_id: reservation.id,
          memo: `No-show deposit released: ${reservation.guest_name}`,
        },
        {
          tenant_id: reservation.tenant_id,
          account: 'forfeiture_income',
          direction: 'CR',
          amount_pesewas: reservation.deposit_pesewas,
          ref_type: 'settlement',
          ref_id: reservation.id,
          memo: `No-show deposit forfeiture: ${reservation.guest_name}`,
        },
      ])
    }

    processed++
  }

  return new Response(JSON.stringify({ processed }), { status: 200 })
})
