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

  // Events that ended 12h ago with no settlement yet
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()

  const { data: events } = await supabase
    .from('events')
    .select('id, tenant_id, name')
    .lt('ends_at', cutoff)
    .eq('status', 'published')

  let drafted = 0

  for (const event of (events ?? [])) {
    // Check if settlement already exists
    const { data: existing } = await supabase
      .from('settlement_statements')
      .select('id')
      .eq('event_id', event.id)
      .single()

    if (existing) continue

    // Get organiser from submission — take the most recently reviewed one if multiple exist
    const { data: submission } = await supabase
      .from('organiser_submissions')
      .select('organiser_id, comp_allowance')
      .eq('event_id', event.id)
      .eq('status', 'approved')
      .order('reviewed_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!submission) continue

    // Compute settlement
    const { data: settlement } = await supabase.rpc('compute_settlement', {
      p_event_id: event.id,
    })

    if (!settlement) continue

    const s = settlement as Record<string, number>

    // Get tenant splits
    const { data: tenant } = await supabase
      .from('tenants')
      .select('gate_split_club_bps, table_split_club_bps')
      .eq('id', event.tenant_id)
      .single()

    await supabase.from('settlement_statements').insert({
      tenant_id: event.tenant_id,
      event_id: event.id,
      organiser_id: submission.organiser_id,
      gate_gross_pesewas: s['gate_gross'],
      table_gross_pesewas: s['table_gross'],
      refunds_pesewas: s['refunds'],
      comps_pesewas: s['comps'],
      comp_allowance_pesewas: s['comp_allowance'],
      organiser_gate_pesewas: s['organiser_gate'],
      organiser_table_pesewas: s['organiser_table'],
      organiser_total_pesewas: s['organiser_total'],
      club_total_pesewas: s['club_total'],
      gate_split_club_bps: (tenant as { gate_split_club_bps: number }).gate_split_club_bps,
      table_split_club_bps: (tenant as { table_split_club_bps: number }).table_split_club_bps,
      status: 'draft',
    })

    drafted++
  }

  return new Response(JSON.stringify({ drafted }), { status: 200 })
})
