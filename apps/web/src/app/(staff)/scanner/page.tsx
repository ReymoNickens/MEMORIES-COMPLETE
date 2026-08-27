'use client'

import { useEffect, useRef, useState } from 'react'
import { BrowserQRCodeReader } from '@zxing/browser'
import { parseQrPayload } from '@evolveit/shared/totp'
import type { RedeemResult } from '@evolveit/shared/types'

type ScanState = 'idle' | 'pass' | 'fail' | 'already_used' | 'cannot_verify'
const HUB_URL = process.env['NEXT_PUBLIC_HUB_URL'] ?? 'http://hub.lan:3001'
const DEVICE_ID = typeof window !== 'undefined' ? (localStorage.getItem('device_id') ?? '') : ''
const DOOR_LABEL = typeof window !== 'undefined' ? (localStorage.getItem('door_label') ?? 'Door 1') : 'Door 1'

export default function ScannerPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserQRCodeReader | null>(null)
  const [scanState, setScanState] = useState<ScanState>('idle')
  const [result, setResult] = useState<RedeemResult | null>(null)
  const [hubStatus, setHubStatus] = useState<'online' | 'degraded' | 'offline'>('offline')
  const lockRef = useRef(false)

  useEffect(() => {
    const reader = new BrowserQRCodeReader()
    readerRef.current = reader
    if (videoRef.current) {
      reader.decodeFromVideoDevice(undefined, videoRef.current, (res) => {
        if (res && !lockRef.current) {
          lockRef.current = true
          void handleScan(res.getText())
        }
      })
    }

    const hubPing = setInterval(async () => {
      try {
        const r = await fetch(`${HUB_URL}/v1/health`, { signal: AbortSignal.timeout(3000) })
        setHubStatus(r.ok ? 'online' : 'degraded')
      } catch {
        setHubStatus('offline')
      }
    }, 10_000)

    return () => {
      // BrowserQRCodeReader cleanup
      try { (reader as unknown as { reset?: () => void }).reset?.() } catch { /* ignore */ }
      clearInterval(hubPing)
    }
  }, [])

  async function handleScan(raw: string) {
    const parsed = parseQrPayload(raw)
    if (!parsed) {
      playTone(220)
      setScanState('fail')
      setResult({ ok: false, reason: 'invalid_code' })
      schedule_reset()
      return
    }

    const body = JSON.stringify({
      ticket_id: parsed.ticketId,
      totp_code: parsed.totpCode,
      device_id: DEVICE_ID,
      door_label: DOOR_LABEL,
    })

    let res: RedeemResult | null = null

    // Try hub first (3s timeout), then fall back to cloud (10s timeout)
    try {
      const hubRes = await fetch(`${HUB_URL}/v1/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(3000),
      })
      res = await hubRes.json() as RedeemResult
    } catch {
      try {
        const cloudRes = await fetch('/api/v1/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEVICE_ID}` },
          body,
          signal: AbortSignal.timeout(10_000),
        })
        res = await cloudRes.json() as RedeemResult
      } catch {
        playTone(180)
        setScanState('cannot_verify')
        setResult(null)
        schedule_reset()
        return
      }
    }

    if (!res) return
    setResult(res)

    if (res.ok) {
      playTone(440)
      setScanState('pass')
    } else if (res.reason === 'already_used') {
      playTone(330)
      setScanState('already_used')
    } else {
      playTone(220)
      setScanState('fail')
    }

    schedule_reset()
  }

  function schedule_reset() {
    setTimeout(() => {
      setScanState('idle')
      setResult(null)
      lockRef.current = false
    }, 4000)
  }

  function playTone(freq: number) {
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
      osc.start()
      osc.stop(ctx.currentTime + 0.6)
    } catch { /* audio blocked */ }
  }

  const statusDot = {
    online: 'bg-green-500',
    degraded: 'bg-amber-500',
    offline: 'bg-red-500',
  }[hubStatus]

  const overlayBg = {
    idle: 'transparent',
    pass: '#1A5C2E',
    fail: '#B8122A',
    already_used: '#B86800',
    cannot_verify: '#3D4C6B',
  }[scanState]

  return (
    <div className="fixed inset-0 bg-black overflow-hidden" style={{ touchAction: 'none' }}>
      {/* Camera viewfinder */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        autoPlay
        muted
        playsInline
      />

      {/* Status bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 bg-black/40">
        <span className="text-micro text-white/70">{DOOR_LABEL}</span>
        <div className={`w-3 h-3 rounded-full ${statusDot}`} />
      </div>

      {/* Result overlay */}
      {scanState !== 'idle' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{ backgroundColor: overlayBg }}
        >
          {scanState === 'pass' && (
            <>
              <div className="text-white text-[120px] leading-none mb-4">✓</div>
              <p className="text-scanner-lg text-white font-bold">ADMIT</p>
              {result?.holder_name && (
                <p className="text-scanner-md text-white mt-2">{result.holder_name}</p>
              )}
              {result?.ticket_type && (
                <p className="text-body-lg text-white/80 mt-1">{result.ticket_type}</p>
              )}
            </>
          )}

          {scanState === 'fail' && (
            <>
              <div className="text-white text-[120px] leading-none mb-4">✕</div>
              <p className="text-scanner-lg text-white font-bold capitalize">
                {result?.reason?.replace(/_/g, ' ') ?? 'Invalid'}
              </p>
            </>
          )}

          {scanState === 'already_used' && (
            <>
              <div className="text-white text-[80px] leading-none mb-4">⚠</div>
              <p className="text-scanner-lg text-white font-bold">ALREADY USED</p>
              {result?.scanned_at && (
                <p className="text-scanner-md text-white mt-2">
                  Scanned {new Date(result.scanned_at).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
                  {result.door_label ? ` · ${result.door_label}` : ''}
                </p>
              )}
            </>
          )}

          {scanState === 'cannot_verify' && (
            <>
              <div className="text-white text-[80px] leading-none mb-4">?</div>
              <p className="text-scanner-lg text-white font-bold">CANNOT VERIFY</p>
              <p className="text-scanner-md text-white mt-2">Contact manager</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
