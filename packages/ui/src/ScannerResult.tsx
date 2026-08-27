import React, { useEffect } from 'react'

export interface ScannerResultProps {
  result: {
    ok: boolean
    reason?: 'already_used' | 'voided' | 'invalid_code' | 'outside_window' | 'not_found'
    holder_name?: string
    ticket_type?: string
    scanned_at?: string
    door_label?: string
  } | null
  onDismiss?: () => void
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
  } catch { /* audio context may be unavailable */ }
}

export function ScannerResult({ result, onDismiss }: ScannerResultProps) {
  useEffect(() => {
    if (!result) return
    playTone(result.ok ? 440 : result.reason === 'already_used' ? 330 : 220)
    const timer = setTimeout(() => onDismiss?.(), 4000)
    return () => clearTimeout(timer)
  }, [result])

  if (!result) return null

  const bg = result.ok
    ? '#1A5C2E'
    : result.reason === 'already_used'
      ? '#B86800'
      : result.reason === undefined
        ? '#3D4C6B'
        : '#B8122A'

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center z-50"
      style={{ backgroundColor: bg }}
      onClick={onDismiss}
    >
      {result.ok ? (
        <>
          <div className="text-white text-[120px] leading-none mb-4">✓</div>
          <p className="text-[40px] font-bold text-white leading-tight">ADMIT</p>
          {result.holder_name && <p className="text-[24px] text-white mt-2">{result.holder_name}</p>}
          {result.ticket_type && <p className="text-base text-white/80 mt-1">{result.ticket_type}</p>}
        </>
      ) : result.reason === 'already_used' ? (
        <>
          <div className="text-white text-[80px] leading-none mb-4">⚠</div>
          <p className="text-[32px] font-bold text-white">ALREADY USED</p>
          {result.scanned_at && (
            <p className="text-[20px] text-white mt-2">
              Scanned {new Date(result.scanned_at).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
              {result.door_label ? ` · ${result.door_label}` : ''}
            </p>
          )}
        </>
      ) : result.reason === undefined ? (
        <>
          <div className="text-white text-[80px] leading-none mb-4">?</div>
          <p className="text-[28px] font-bold text-white">CANNOT VERIFY</p>
          <p className="text-[20px] text-white mt-2">Contact manager</p>
        </>
      ) : (
        <>
          <div className="text-white text-[120px] leading-none mb-4">✕</div>
          <p className="text-[28px] font-bold text-white capitalize">
            {result.reason.replace(/_/g, ' ')}
          </p>
        </>
      )}
    </div>
  )
}
