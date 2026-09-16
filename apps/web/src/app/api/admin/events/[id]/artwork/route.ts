import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { requireContentAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 8 * 1024 * 1024
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

// Flyer upload for an event. Storage writes go through this route holding
// the service role, same as every other write in this app — the anon key
// never talks to Supabase Storage directly.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireContentAdmin()
  if ('error' in gate) return gate.error

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  const ext = ALLOWED_TYPES[file.type]
  if (!ext) {
    return NextResponse.json({ error: 'only jpeg, png or webp images are accepted' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'file too large (max 8MB)' }, { status: 400 })
  }

  const supabase = createSupabaseServiceRole()

  const { data: event } = await supabase.from('events')
    .select('id').eq('id', params.id).eq('tenant_id', gate.staff.tenant_id).maybeSingle()
  if (!event) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const path = `${gate.staff.tenant_id}/${params.id}-${Date.now()}.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { error: uploadError } = await supabase.storage
    .from('event-artwork')
    .upload(path, bytes, { contentType: file.type, upsert: false })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: pub } = supabase.storage.from('event-artwork').getPublicUrl(path)
  const artworkUrl = pub.publicUrl

  const { error: updateError } = await supabase.from('events')
    .update({ artwork_url: artworkUrl })
    .eq('id', params.id).eq('tenant_id', gate.staff.tenant_id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  return NextResponse.json({ ok: true, artwork_url: artworkUrl })
}
