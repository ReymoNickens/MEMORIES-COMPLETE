import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Demo / v1 seed hash. Production PINs should use hashPinV2. */
export function hashPin(pin: string, tenantId: string): string {
  return sha256Hex(`${tenantId}:${pin}`)
}

export function hashPinV2(pin: string, tenantId: string, pepper: string): string {
  const salt = createHash('sha256').update(`pin:${tenantId}:${pepper}`).digest()
  const key = scryptSync(pin, salt, 32, { N: 16384, r: 8, p: 1 })
  return `scrypt$${key.toString('hex')}`
}

export function verifyPin(pin: string, tenantId: string, stored: string, pepper = ''): boolean {
  if (stored.startsWith('scrypt$')) {
    const next = hashPinV2(pin, tenantId, pepper)
    return safeEqualHex(stored.slice(7), next.slice(7))
  }
  return safeEqualHex(hashPin(pin, tenantId), stored)
}

export function hashDeviceKey(key: string): string {
  return sha256Hex(key)
}

function ticketKey(): Buffer {
  const hex = process.env['TICKET_MASTER_KEY'] ?? ''
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex')
  if (process.env['EVOLVEIT_DEMO'] === '1') {
    return createHash('sha256').update('evolveit-demo-ticket-master-not-for-prod').digest()
  }
  throw new Error('TICKET_MASTER_KEY must be 32-byte hex')
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', ticketKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`
}

export function decryptSecret(enc: string): string {
  if (!enc.startsWith('v1.')) {
    return Buffer.from(enc, 'base64').toString('utf8')
  }
  const parts = enc.split('.')
  if (parts.length !== 4) throw new Error('bad_secret')
  const iv = Buffer.from(parts[1]!, 'base64url')
  const tag = Buffer.from(parts[2]!, 'base64url')
  const ct = Buffer.from(parts[3]!, 'base64url')
  const dec = createDecipheriv('aes-256-gcm', ticketKey(), iv)
  dec.setAuthTag(tag)
  return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8')
}

export function encodeTotpSecret(base32Secret: string): string {
  return encryptSecret(base32Secret)
}

export function decodeTotpSecret(enc: string): string {
  return decryptSecret(enc)
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

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}
