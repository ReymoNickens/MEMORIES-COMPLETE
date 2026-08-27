export function normalisePhone(input: string): string | null {
  let cleaned = input.replace(/\s+/g, '').replace(/-/g, '')
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '+233' + cleaned.slice(1)
  } else if (cleaned.startsWith('233') && !cleaned.startsWith('+')) {
    cleaned = '+' + cleaned
  }
  if (/^\+233\d{9}$/.test(cleaned)) return cleaned
  return null
}

export function formatPhone(e164: string): string {
  // +233244123456 -> 0244 123 456
  if (e164.startsWith('+233')) {
    const local = '0' + e164.slice(4)
    return local.slice(0, 4) + ' ' + local.slice(4, 7) + ' ' + local.slice(7)
  }
  return e164
}
