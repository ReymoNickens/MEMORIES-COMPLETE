import { NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Public read of the venue's standing info — contact, socials, tagline, and
// the default gate/table price shown before any event-specific override
// exists. This is what public pages should read instead of hardcoding these
// values, per the brief.
export async function GET() {
  const supabase = createSupabaseServiceRole()
  const { data, error } = await supabase.from('venue_settings')
    .select('default_gate_price_pesewas, default_table_price_pesewas, contact_whatsapp, contact_email, contact_address, tagline, social_links')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    settings: data ?? {
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
