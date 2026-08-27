export const ErrorCodes = {
  SOLD_OUT:           'TICKET_SOLD_OUT',
  ALREADY_REDEEMED:   'TICKET_ALREADY_REDEEMED',
  INVALID_QR:         'TICKET_INVALID_QR',
  OUTSIDE_WINDOW:     'TICKET_OUTSIDE_WINDOW',
  PAYMENT_FAILED:     'PAYMENT_FAILED',
  WEBHOOK_SIG_FAIL:   'WEBHOOK_SIGNATURE_INVALID',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  PHONE_INVALID:      'PHONE_INVALID',
  NOT_FOUND:          'NOT_FOUND',
  LEDGER_IMMUTABLE:   'LEDGER_IMMUTABLE',
} as const

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]

export interface ApiError {
  error: string
  code: ErrorCode
}

export function makeError(code: ErrorCode, message: string): ApiError {
  return { error: message, code }
}
