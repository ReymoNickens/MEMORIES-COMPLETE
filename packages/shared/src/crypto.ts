import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hashPin(pin: string, tenantId: string): string {
  return sha256Hex(`${tenantId}:${pin}`)
}

export function hashDeviceKey(key: string): string {
  return sha256Hex(key)
}

export function encodeTotpSecret(base32Secret: string): string {
  return Buffer.from(base32Secret, 'utf8').toString('base64')
}

export function decodeTotpSecret(enc: string): string {
  return Buffer.from(enc, 'base64').toString('utf8')
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('hex')
}

export function signPayload(payload: string, secret: string): string {
  const body = Buffer.from(payload, 'utf8').toString('base64url')
  const sig = createHmac('sha256', secret).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifySignedPayload(token: string, secret: string): string | null {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', secret).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null
  try {
    return Buffer.from(body, 'base64url').toString('utf8')
  } catch {
    return null
  }
}
