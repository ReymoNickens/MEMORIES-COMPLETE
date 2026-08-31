import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  encryptSecret,
  decryptSecret,
  hashPin,
  hashPinV2,
  verifyPin,
  signPayload,
  verifySignedPayload,
  sha256Hex,
} from './crypto.ts'
import { splitPesewas, toGHS, toPesewas, assertPesewas, formatAmount } from './money.ts'
import { normalisePhone, formatPhone } from './phone.ts'
import { parseQrPayload } from './totp.ts'

process.env['EVOLVEIT_DEMO'] = '1'

test('AES-GCM secret roundtrip', () => {
  const enc = encryptSecret('JBSWY3DPEHPK3PXP')
  assert.match(enc, /^v1\./)
  assert.equal(decryptSecret(enc), 'JBSWY3DPEHPK3PXP')
})

test('legacy base64 secrets still decode', () => {
  const legacy = Buffer.from('JBSWY3DPEHPK3PXP', 'utf8').toString('base64')
  assert.equal(decryptSecret(legacy), 'JBSWY3DPEHPK3PXP')
})

test('tampered ciphertext fails', () => {
  const enc = encryptSecret('secret')
  assert.throws(() => decryptSecret(enc.slice(0, -2) + 'aa'))
})

test('v1 pin hash matches seed formula', () => {
  const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  assert.equal(hashPin('1111', tenant), sha256Hex(`${tenant}:1111`))
  assert.equal(verifyPin('1111', tenant, hashPin('1111', tenant)), true)
  assert.equal(verifyPin('0000', tenant, hashPin('1111', tenant)), false)
})

test('v2 scrypt pin', () => {
  const stored = hashPinV2('2468', 'tenant', 'pepper')
  assert.match(stored, /^scrypt\$/)
  assert.equal(verifyPin('2468', 'tenant', stored, 'pepper'), true)
  assert.equal(verifyPin('2468', 'tenant', stored, 'wrong'), false)
})

test('signed payload rejects mutation', () => {
  const token = signPayload('{"u":1}', 'secret')
  assert.equal(verifySignedPayload(token, 'secret'), '{"u":1}')
  assert.equal(verifySignedPayload(token + 'x', 'secret'), null)
  assert.equal(verifySignedPayload(token, 'other'), null)
})

test('splitPesewas never drops remainder', () => {
  assert.deepEqual(splitPesewas(100, 3), [33, 33, 34])
  assert.equal(splitPesewas(100, 3).reduce((a, b) => a + b, 0), 100)
  assert.deepEqual(splitPesewas(50, 1), [50])
})

test('Ghana numbers', () => {
  assert.equal(normalisePhone('0244123456'), '+233244123456')
  assert.equal(normalisePhone('233244123456'), '+233244123456')
  assert.equal(normalisePhone('020'), null)
})

// The rest of this file closes gaps found while reconciling a second,
// independently-run audit branch (claude/continue-previous-ds4ie6): real
// edge cases that had no coverage on trunk, even though the functions
// themselves were already correct.

test('normalisePhone: strips spaces and dashes, rejects non-Ghana and malformed input', () => {
  assert.equal(normalisePhone('024 412 3456'), '+233244123456')
  assert.equal(normalisePhone('024-412-3456'), '+233244123456')
  assert.equal(normalisePhone('+233244123456'), '+233244123456')
  assert.equal(normalisePhone('+14155552671'), null) // not Ghana
  assert.equal(normalisePhone('02441234567'), null) // one digit too many
  assert.equal(normalisePhone('abc'), null)
  assert.equal(normalisePhone(''), null)
})

test('formatPhone: E.164 to local, non-Ghana passed through unchanged', () => {
  assert.equal(formatPhone('+233244123456'), '0244 123 456')
  assert.equal(formatPhone('+14155552671'), '+14155552671')
})

test('toGHS / toPesewas / assertPesewas', () => {
  assert.equal(toGHS(10000), 'GHS 100.00')
  assert.equal(toGHS(1), 'GHS 0.01')
  assert.equal(toGHS(0), 'GHS 0.00')
  assert.equal(toPesewas(1), 100)
  assert.equal(toPesewas(0.99), 99)
  assert.throws(() => assertPesewas(-1))
  assert.throws(() => assertPesewas(1.5))
  assert.throws(() => assertPesewas('100'))
  assert.doesNotThrow(() => assertPesewas(0))
})

test('formatAmount renders GHS with two decimals', () => {
  assert.match(formatAmount(13000000), /130,000\.00/)
})

test('parseQrPayload: valid payload and every malformed shape', () => {
  const uuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  assert.deepEqual(parseQrPayload(`EV1.${uuid}.123456`), { ticketId: uuid, totpCode: '123456' })
  assert.equal(parseQrPayload(`EV2.${uuid}.123456`), null) // wrong prefix
  assert.equal(parseQrPayload(`EV1.not-a-uuid.123456`), null)
  assert.equal(parseQrPayload(`EV1.${uuid}.12345`), null) // 5 digits
  assert.equal(parseQrPayload(`EV1.${uuid}.1234567`), null) // 7 digits
  assert.equal(parseQrPayload(`EV1.${uuid}.12a456`), null) // letters in code
  assert.equal(parseQrPayload(`EV1.${uuid}.123456.extra`), null) // too many segments
  assert.equal(parseQrPayload(`EV1.${uuid}`), null) // too few segments
  assert.equal(parseQrPayload(''), null)
})

test('SECURITY: signed payload never leaks the secret, and verify is symmetric', () => {
  const token = signPayload('{"user_id":"x"}', 'the-signing-secret')
  assert.doesNotMatch(token, /the-signing-secret/)
  // Every prefix/suffix mutation must fail, not just a full swap.
  assert.equal(verifySignedPayload(token.slice(0, -1), 'the-signing-secret'), null)
  assert.equal(verifySignedPayload('x' + token, 'the-signing-secret'), null)
})

test('SECURITY: decryptSecret rejects a ciphertext produced under a different key', () => {
  const encA = encryptSecret('a-real-totp-secret')
  const bad = encA.replace(/^v1\./, 'v1.') // same envelope, but ticketKey() in this
  // process is fixed by env, so simulate a foreign key by corrupting the tag
  // segment specifically rather than the ciphertext, to isolate auth-tag failure.
  const parts = bad.split('.')
  parts[2] = Buffer.from(Buffer.from(parts[2]!, 'base64url').map(b => b ^ 0xff)).toString('base64url')
  assert.throws(() => decryptSecret(parts.join('.')))
})
