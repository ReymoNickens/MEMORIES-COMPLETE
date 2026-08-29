import { createHmac, createHash, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto'

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hashPin(pin: string, tenantId: string): string {
  return sha256Hex(`${tenantId}:${pin}`)
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

/** @deprecated Use encryptSecret / decryptSecret for at-rest protection. */
export function encodeTotpSecret(base32Secret: string): string {
  return Buffer.from(base32Secret, 'utf8').toString('base64')
}

/** @deprecated Use encryptSecret / decryptSecret for at-rest protection. */
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
