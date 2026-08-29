import { createHmac, createHash, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto'

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** @deprecated Legacy SHA-256 PIN hash — only kept for migration fallback. Use hashPinStrong. */
export function hashPin(pin: string, tenantId: string): string {
  return sha256Hex(`${tenantId}:${pin}`)
}

/**
 * PBKDF2-SHA256 with 600,000 iterations (NIST SP 800-132 recommendation).
 * Returns `salt$hash` where both are hex-encoded.
 */
export function hashPinStrong(pin: string): { encoded: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = pbkdf2Sync(pin, salt, 600000, 32, 'sha256').toString('hex')
  return { encoded: `${salt}$${hash}` }
}

/** Constant-time verification for a PBKDF2-SHA256 encoded PIN hash. */
export function verifyPinStrong(pin: string, encoded: string): boolean {
  const sep = encoded.indexOf('$')
  if (sep === -1) return false
  const salt = encoded.substring(0, sep)
  const stored = encoded.substring(sep + 1)
  const candidate = pbkdf2Sync(pin, salt, 600000, 32, 'sha256').toString('hex')
  const a = Buffer.from(candidate, 'hex')
  const b = Buffer.from(stored, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// HMAC-SHA256 of the device API key using a server secret so hash-table
// attacks against a stolen DB row fail without the server secret.
// serverSecret defaults to HUB_SECRET env var when omitted.
export function hashDeviceKey(key: string, serverSecret?: string): string {
  const secret = serverSecret ?? process.env['HUB_SECRET'] ?? ''
  if (!secret) throw new Error('HUB_SECRET must be set for device key hashing')
  return createHmac('sha256', secret).update(key).digest('hex')
}

// Encrypt a plaintext secret with AES-256-GCM.
// keyHex must be a 64-char hex string (32 bytes).
// Output format: <ivHex>:<tagHex>:<ciphertextHex>
export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`
}

// Decrypt a value produced by encryptSecret.
export function decryptSecret(enc: string, keyHex: string): string {
  const parts = enc.split(':')
  if (parts.length !== 3) throw new Error('invalid_enc_format')
  const [ivHex, tagHex, ctHex] = parts as [string, string, string]
  const key = Buffer.from(keyHex, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8')
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
