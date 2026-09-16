import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { requireContentAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 8 * 1024 * 1024
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export async function GET() {
  const gate = await requireContentAdmin()
  if ('error' in gate) return gate.error

  const supabase = createSupabaseServiceRole()
  const { data, error } = await supabase.from('gallery_photos')
    .select('*').eq('tenant_id', gate.staff.tenant_id).order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ photos: data ?? [] })
}

export async function POST(req: NextRequest) {
  const gate = await requireContentAdmin()
  if ('error' in gate) return gate.error

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const caption = form?.get('caption')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  const ext = ALLOWED_TYPES[file.type]
  if (!ext) return NextResponse.json({ error: 'only jpeg, png or webp images are accepted' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'file too large (max 8MB)' }, { status: 400 })

  const supabase = createSupabaseServiceRole()
  const path = `${gate.staff.tenant_id}/${Date.now()}-${randomUUID()}.${ext}`
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { error: uploadError } = await supabase.storage
    .from('gallery').upload(path, bytes, { contentType: file.type, upsert: false })
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: pub } = supabase.storage.from('gallery').getPublicUrl(path)

  const { count } = await supabase.from('gallery_photos')
    .select('id', { count: 'exact', head: true }).eq('tenant_id', gate.staff.tenant_id)

  const { data, error } = await supabase.from('gallery_photos').insert({
    tenant_id: gate.staff.tenant_id,
    url: pub.publicUrl,
    caption: typeof caption === 'string' ? caption : null,
    sort_order: count ?? 0,
    uploaded_by: gate.staff.user_id,
  }).select('id, url').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id, url: data.url })
}

export async function DELETE(req: NextRequest) {
  const gate = await requireContentAdmin()
  if ('error' in gate) return gate.error

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const supabase = createSupabaseServiceRole()
  const { error } = await supabase.from('gallery_photos').delete()
    .eq('id', id).eq('tenant_id', gate.staff.tenant_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
