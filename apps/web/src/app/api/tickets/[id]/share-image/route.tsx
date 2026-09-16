import { NextRequest, NextResponse } from 'next/server'
import { ImageResponse } from 'next/og'
import QRCode from 'qrcode'
import { createSupabaseServiceRole } from '@/lib/supabase/server'
import { sha256Hex } from '@evolveit/shared/crypto'

// Server-side rendered, not client-side: this is what makes the artwork
// consistent (every viewer of a shared image sees the same thing the
// buyer's phone rendered) and tamper-resistant (nothing in the browser can
// alter what gets posted to a story). Runs in the Node runtime, same as
// every other route in this app that touches the service role.
export const dynamic = 'force-dynamic'

const WIDTH = 1080
const HEIGHT = 1920

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = req.nextUrl.searchParams.get('access')
  if (!access) return NextResponse.json({ error: 'access token required' }, { status: 401 })

  const supabase = createSupabaseServiceRole()

  const { data: grant } = await supabase
    .from('ticket_access')
    .select('ticket_id')
    .eq('ticket_id', params.id)
    .eq('token_hash', sha256Hex(access))
    .single()
  if (!grant) return NextResponse.json({ error: 'invalid access' }, { status: 401 })

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, serial, buyer_name, status, share_image_url, ticket_types(name), events(name, starts_at, artwork_url)')
    .eq('id', params.id)
    .single()
  if (!ticket) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Cached from a previous render — the decision of what to render (buyer,
  // event, and any raffle win) is fixed at issuance, so a ticket's artwork
  // never needs to be regenerated once rendered.
  if (ticket.share_image_url) {
    return NextResponse.redirect(ticket.share_image_url, { status: 307 })
  }

  const event = ticket.events as unknown as { name: string; starts_at: string; artwork_url: string | null }
  const type = ticket.ticket_types as unknown as { name: string }

  const { data: reward } = await supabase.rpc('get_ticket_reward', { p_ticket_id: params.id }) as
    { data: { won: boolean; prize_name?: string } | null }

  // The QR on this image is a static, branded serial code, not the door
  // pass's rotating TOTP payload — that payload is fetched live from a
  // token-gated route and must never end up in something posted publicly.
  // A screenshot of this image can never open the door.
  const qrDataUrl = await QRCode.toDataURL(`MNC:${ticket.serial}`, { margin: 1, width: 360, color: { dark: '#14090B', light: '#E8DCC8' } })

  const vip = type.name.toLowerCase().includes('vip')
  const accent = vip ? '#C4B8A8' : '#B8122A'
  const eventDate = new Date(event.starts_at).toLocaleString('en-GH', {
    weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
  })

  const image = new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        backgroundColor: '#08070D', position: 'relative', fontFamily: 'sans-serif',
      }}>
        {event.artwork_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.artwork_url}
            width={WIDTH}
            height={HEIGHT}
            style={{ position: 'absolute', inset: 0, objectFit: 'cover', opacity: 0.55 }}
          />
        )}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, rgba(8,7,13,0.55) 0%, rgba(8,7,13,0.75) 55%, rgba(8,7,13,0.96) 100%)',
        }} />

        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', padding: '80px 64px' }}>
          <div style={{ display: 'flex', fontSize: 40, letterSpacing: 6, color: '#F3EDE4', textTransform: 'uppercase' }}>
            Memories<span style={{ color: accent }}>.</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 90 }}>
            <div style={{ display: 'flex', fontSize: 26, letterSpacing: 3, color: '#C4B8A8', textTransform: 'uppercase' }}>
              {eventDate}
            </div>
            <div style={{ display: 'flex', fontSize: 68, color: '#F3EDE4', marginTop: 16, lineHeight: 1.1 }}>
              {event.name}
            </div>
          </div>

          {reward?.won && (
            <div style={{
              display: 'flex', marginTop: 40, padding: '18px 28px', alignSelf: 'flex-start',
              backgroundColor: '#B8122A', color: '#F3EDE4', fontSize: 28, letterSpacing: 2,
            }}>
              🎉 Won: {reward.prize_name}
            </div>
          )}

          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            marginTop: 'auto', marginBottom: 60,
          }}>
            <div style={{ display: 'flex', backgroundColor: '#E8DCC8', padding: 24 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} width={280} height={280} />
            </div>
          </div>

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
            borderTop: '2px dashed #2A242C', paddingTop: 28,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', fontSize: 40, color: '#F3EDE4' }}>{ticket.buyer_name}</div>
              <div style={{ display: 'flex', fontSize: 24, letterSpacing: 3, color: accent, textTransform: 'uppercase', marginTop: 8 }}>
                {type.name}
              </div>
            </div>
            <div style={{ display: 'flex', fontSize: 22, letterSpacing: 2, color: '#8A8580' }}>{ticket.serial}</div>
          </div>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT }
  )

  const bytes = new Uint8Array(await image.arrayBuffer())
  const path = `${params.id}.png`
  const { error: uploadError } = await supabase.storage
    .from('ticket-art')
    .upload(path, bytes, { contentType: 'image/png', upsert: true })
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: pub } = supabase.storage.from('ticket-art').getPublicUrl(path)
  await supabase.from('tickets').update({ share_image_url: pub.publicUrl }).eq('id', params.id)

  return NextResponse.redirect(pub.publicUrl, { status: 307 })
}
