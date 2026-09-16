import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { requireSettingsAdmin, requireContentAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

// Content admins (event_manager included) can read settings — they need the
// default pricing to prefill a new event's ticket types — but only
// owner/manager can change them, per the brief's role split.
export async function GET() {
  const gate = await requireContentAdmin()
  if ('error' in gate) return gate.error

  const supabase = createSupabaseServiceRole()
  const { data, error } = await supabase.from('venue_settings')
    .select('*').eq('tenant_id', gate.staff.tenant_id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    settings: data ?? {
      tenant_id: gate.staff.tenant_id,
      default_gate_price_pesewas: 5000,
      default_table_price_pesewas: 200000,
      contact_whatsapp: null,
      contact_email: null,
      contact_address: null,
      tagline: null,
      social_links: {},
    },
  })
}

export async function PATCH(req: NextRequest) {
  const gate = await requireSettingsAdmin()
  if ('error' in gate) return gate.error

  const body = await req.json().catch(() => null) as {
    default_gate_price_pesewas?: number
    default_table_price_pesewas?: number
    contact_whatsapp?: string | null
    contact_email?: string | null
    contact_address?: string | null
    tagline?: string | null
    social_links?: Record<string, string>
  } | null
  if (!body) return NextResponse.json({ error: 'bad body' }, { status: 400 })

  if (body.default_gate_price_pesewas != null && body.default_gate_price_pesewas < 0) {
    return NextResponse.json({ error: 'default_gate_price_pesewas must be >= 0' }, { status: 400 })
  }
  if (body.default_table_price_pesewas != null && body.default_table_price_pesewas < 0) {
    return NextResponse.json({ error: 'default_table_price_pesewas must be >= 0' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()
  const { error } = await supabase.from('venue_settings').upsert({
    tenant_id: gate.staff.tenant_id,
    ...body,
    updated_by: gate.staff.user_id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
