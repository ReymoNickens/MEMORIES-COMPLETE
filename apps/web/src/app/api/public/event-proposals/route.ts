import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { normalisePhone } from '@evolveit/shared/phone'

// The public "Host Your Event" pitch — no login required, matching the
// legacy marketing site's behaviour. Lands in the same organiser_submissions
// inbox owner/manager already reviews, with organiser_id left null so the
// review screen knows this one has no staff account behind it.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
    organiser_name?: string
    contact_person?: string
    contact_email?: string
    contact_phone?: string
    contact_instagram?: string
    event_name?: string
    preferred_date?: string
    estimated_attendance?: number
    concept?: string
    dj_details?: string
    special_requirements?: string
  } | null

  if (!body?.organiser_name || !body.contact_person || !body.event_name
    || !body.preferred_date || !body.concept) {
    return NextResponse.json(
      { error: 'organiser_name, contact_person, event_name, preferred_date and concept are required' },
      { status: 400 },
    )
  }
  if (!body.contact_email && !body.contact_phone) {
    return NextResponse.json({ error: 'Leave an email or a phone number so we can reach you' }, { status: 400 })
  }

  const phone = body.contact_phone ? normalisePhone(body.contact_phone) : null
  if (body.contact_phone && !phone) {
    return NextResponse.json({ error: 'Invalid Ghana phone number' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()

  const { data: tenant } = await supabase.from('tenants').select('id').eq('slug', 'memories-nc').maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'Venue not found' }, { status: 500 })

  const { data, error } = await supabase.from('organiser_submissions').insert({
    tenant_id: tenant.id,
    organiser_id: null,
    preferred_date: body.preferred_date,
    event_name: body.event_name,
    host_name: `${body.organiser_name} (${body.contact_person})`,
    description: body.concept,
    estimated_attendance: body.estimated_attendance ?? 100,
    dj_details: body.dj_details || null,
    special_requirements: body.special_requirements || null,
    contact_email: body.contact_email || null,
    contact_phone: phone,
    contact_instagram: body.contact_instagram || null,
  }).select('id').single()

  if (error) return NextResponse.json({ error: 'Could not submit — try again' }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id })
}
