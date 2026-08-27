'use client'

import { useEffect, useState } from 'react'
import { createSupabaseClient } from '@/lib/supabase/client'
import { formatAmount } from '@evolveit/shared/money'

interface ShiftRevenue {
  ticket_revenue: number
  fb_revenue: number
  comps: number
  refunds: number
  paystack_fees: number
  momo_received: number
  cash_collected: number
}

interface WaiterSummary {
  waiter_id: string
  waiter_name: string
  expected_pesewas: number
  handed_in_pesewas: number
  variance_pesewas: number
  order_count: number
}

export default function OwnerDashboard() {
  const [revenue, setRevenue] = useState<ShiftRevenue | null>(null)
  const [waiters, setWaiters] = useState<WaiterSummary[]>([])
  const [shiftId, setShiftId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createSupabaseClient()

    // Get current open shift
    void supabase
      .from('shifts')
      .select('id')
      .is('closed_at', null)
      .order('opened_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data: shift }) => {
        if (!shift) return
        setShiftId(shift.id)
        return Promise.all([
          supabase.rpc('get_shift_revenue', { p_shift_id: shift.id }),
          supabase.rpc('get_waiter_cash_summary', { p_shift_id: shift.id }),
        ])
      })
      .then(results => {
        if (!results) return
        const [revResult, waiterResult] = results
        if (revResult.data) setRevenue(revResult.data as ShiftRevenue)
        if (waiterResult.data) setWaiters(waiterResult.data as WaiterSummary[])
      })

    if (!shiftId) return

    // Real-time updates
    const channel = supabase
      .channel('owner-dashboard')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ledger_entries' }, () => {
        void supabase.rpc('get_shift_revenue', { p_shift_id: shiftId }).then(({ data }) => {
          if (data) setRevenue(data as ShiftRevenue)
        })
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [shiftId])

  const netRevenue = revenue
    ? revenue.ticket_revenue + revenue.fb_revenue - revenue.comps - revenue.refunds - revenue.paystack_fees
    : 0

  return (
    <div className="min-h-screen bg-ev-page p-6" data-tenant="memories-nc">
      <h1 className="text-h1 text-ev-dark font-display mb-2">Owner Dashboard</h1>
      <nav className="flex flex-wrap gap-3 text-body-md mb-6">
        <a className="underline" href="/dashboard/shift-close">Shift close</a>
        <a className="underline" href="/organiser">Organiser</a>
        <a className="underline" href="/floor">Floor</a>
        <a className="underline" href="/reissue">Reissue</a>
        <a className="underline" href="/staff/claim">Stations</a>
      </nav>

      {/* Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Ticket Revenue', value: revenue?.ticket_revenue ?? 0, accent: false },
          { label: 'F&B Revenue', value: revenue?.fb_revenue ?? 0, accent: false },
          { label: 'MoMo Received', value: revenue?.momo_received ?? 0, accent: false },
          { label: 'Cash Collected', value: revenue?.cash_collected ?? 0, accent: false },
          { label: 'Comps', value: revenue?.comps ?? 0, accent: true },
          { label: 'Refunds', value: revenue?.refunds ?? 0, accent: true },
          { label: 'Paystack Fees', value: revenue?.paystack_fees ?? 0, accent: true },
          { label: 'Net Revenue', value: netRevenue, accent: false },
        ].map(({ label, value, accent }) => (
          <div key={label} className="bg-ev-card rounded-lg border border-ev-border p-4">
            <p className="text-label text-ev-muted uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-h1 font-mono ${accent ? 'text-ev-warning' : 'text-ev-dark'}`}>
              {formatAmount(value)}
            </p>
          </div>
        ))}
      </div>

      {/* Waiter reconciliation */}
      <div className="bg-ev-card rounded-lg border border-ev-border overflow-hidden">
        <div className="px-4 py-3 border-b border-ev-border">
          <h2 className="text-h2 text-ev-dark">Waiter Cash Reconciliation</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                {['Waiter', 'Orders', 'Expected', 'Handed In', 'Variance'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-label text-ev-muted uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {waiters.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-body-md text-ev-muted">
                    No cash collections this shift
                  </td>
                </tr>
              )}
              {waiters.map(w => (
                <tr key={w.waiter_id} className="border-t border-ev-border">
                  <td className="px-4 py-3 text-body-md text-ev-dark">{w.waiter_name}</td>
                  <td className="px-4 py-3 text-body-md font-mono text-ev-dark">{w.order_count}</td>
                  <td className="px-4 py-3 font-mono text-ev-dark">{formatAmount(w.expected_pesewas)}</td>
                  <td className="px-4 py-3 font-mono text-ev-dark">{formatAmount(w.handed_in_pesewas)}</td>
                  <td className={`px-4 py-3 font-mono font-semibold ${w.variance_pesewas > 0 ? 'text-ev-error' : 'text-ev-success'}`}>
                    {w.variance_pesewas > 0 ? '-' : ''}{formatAmount(Math.abs(w.variance_pesewas))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
