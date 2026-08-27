import * as OTPAuth from 'otpauth'

export function generateQrPayload(ticketUuid: string, totpSecret: string): string {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(totpSecret),
    period: 30,
    digits: 6,
    algorithm: 'SHA1',
  })
  const code = totp.generate()
  return `EV1.${ticketUuid}.${code}`
}

export function verifyTotp(totpSecret: string, code: string, allowedWindowSkew = 1): boolean {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(totpSecret),
    period: 30,
    digits: 6,
    algorithm: 'SHA1',
  })
  const delta = totp.validate({ token: code, window: allowedWindowSkew })
  return delta !== null
}

export function parseQrPayload(qr: string): { ticketId: string; totpCode: string } | null {
  const parts = qr.split('.')
  if (parts.length !== 3) return null
  if (parts[0] !== 'EV1') return null
  if (!/^[0-9a-f-]{36}$/.test(parts[1] ?? '')) return null
  if (!/^\d{6}$/.test(parts[2] ?? '')) return null
  return { ticketId: parts[1]!, totpCode: parts[2]! }
}
