// Shared domain types used across web, hub, and edge functions

export type TicketStatus = 'reserved' | 'issued' | 'used' | 'voided'
export type OrderStatus = 'pending_payment' | 'paid' | 'preparing' | 'complete' | 'voided'
export type OrderSource = 'counter_qr' | 'table_qr' | 'waiter'
export type PaymentSource = 'momo' | 'cash'
export type PaymentMethod = 'momo' | 'card' | 'ussd'
export type PaymentStatus = 'pending' | 'successful' | 'failed' | 'refunded'
export type StaffRole = 'owner' | 'manager' | 'door' | 'waiter' | 'bartender' | 'kitchen' | 'cashier' | 'organiser'
export type DeviceRole = 'hub' | 'door' | 'bar_display' | 'kitchen_display'
export type EventStatus = 'draft' | 'published' | 'cancelled'
export type LedgerAccount =
  | 'momo_clearing'
  | 'cash_drawer'
  | 'ticket_revenue'
  | 'fb_revenue'
  | 'deposit_liability'
  | 'forfeiture_income'
  | 'refunds'
  | 'comps'
  | 'paystack_fees'
  | 'organiser_payable'
  | 'club_retained'

export type LedgerDirection = 'DR' | 'CR'

export interface RedeemRequest {
  ticket_id: string
  totp_code: string
  device_id: string
  api_key: string
  door_label: string
}

export interface RedeemResult {
  ok: boolean
  reason?: 'already_used' | 'voided' | 'invalid_code' | 'outside_window' | 'not_found' | 'reserved' | 'used' | 'not_in_hub' | 'unauthorized'
  holder_name?: string
  ticket_type?: string
  event_name?: string
  scanned_at?: string
  door_label?: string
}

export interface CheckoutInitiateRequest {
  ticket_type_id: string
  quantity: number
  buyer_name: string
  buyer_phone: string
  buyer_email: string
  use_installments?: boolean
}

export interface CheckoutInitiateResponse {
  authorization_url: string
  reference: string
}

export interface TicketStatusResponse {
  issued: boolean
  failed?: boolean
  ticket_id?: string
}
