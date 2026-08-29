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
import { splitPesewas } from './money.ts'
import { normalisePhone } from './phone.ts'

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
