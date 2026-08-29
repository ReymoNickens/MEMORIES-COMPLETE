'use client'

import { useEffect, useState } from 'react'
import { formatAmount } from '@evolveit/shared/money'

interface OrderItem { product_name: string; quantity: number; status: string }
interface TableOrder {
  id: string
  amount_pesewas: number
  payment_source: string
  status: string
  created_at: string
  order_items: OrderItem[]
}
interface WaiterTable { id: string; label: string; zone: string | null; orders: TableOrder[] }

export default function WaiterPage() {
  const [tables, setTables] = useState<WaiterTable[]>([])
  const [selectedTable, setSelectedTable] = useState<WaiterTable | null>(null)
  const [cashAmount, setCashAmount] = useState('')
  const [showCashSheet, setShowCashSheet] = useState<string | null>(null)

  async function reload() {
    const res = await fetch('/api/waiter/tables')
    const data = await res.json() as { tables?: WaiterTable[] }
    setTables(data.tables ?? [])
  }

  useEffect(() => { void reload() }, [])

  function tableStatus(table: WaiterTable): 'empty' | 'pending' | 'done' {
    if (table.orders.length === 0) return 'empty'
    const anyPending = table.orders.some(o =>
      (o.order_items ?? []).some(i => i.status !== 'delivered' && i.status !== 'voided')
    )
    return anyPending ? 'pending' : 'done'
  }

  const statusColor: Record<string, string> = {
    empty: 'border-ev-border text-ev-muted',
    pending: 'border-yellow-500 text-yellow-600 bg-yellow-50',
    done: 'border-green-600 text-green-700 bg-green-50',
  }

  async function collectCash(orderId: string) {
    const pesewas = Math.round(parseFloat(cashAmount) * 100)
    if (!pesewas || isNaN(pesewas)) return
    await fetch('/api/orders/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, cash_pesewas: pesewas }),
    })
    setShowCashSheet(null)
    setCashAmount('')
    void reload()
  }

  return (
    <div className="min-h-screen bg-ev-page pb-20">
      <div className="bg-ev-bg px-4 py-4 text-center">
        <h1 className="text-h1 text-white font-display">My Tables</h1>
      </div>

      {tables.length === 0 && (
        <p className="text-ev-muted text-body-md text-center mt-12">No active tables assigned to you.</p>
      )}

      <div className="grid grid-cols-3 gap-3 p-4 max-w-lg mx-auto">
        {tables.map(table => {
          const status = tableStatus(table)
          return (
            <button
              key={table.id}
              onClick={() => setSelectedTable(table)}
              className={`rounded-lg border-2 p-3 text-center min-h-tap transition-colors ${statusColor[status]}`}
            >
              <div className="text-h3 font-semibold">{table.label}</div>
              <div className="text-micro capitalize">{status}</div>
            </button>
          )
        })}
      </div>

      {selectedTable && (
        <div className="fixed inset-0 bg-black/50 z-10" onClick={() => setSelectedTable(null)}>
          <div
            className="absolute bottom-0 left-0 right-0 bg-ev-card rounded-t-2xl max-h-[80vh] overflow-y-auto p-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-h2 text-ev-dark mb-4">Table {selectedTable.label}</h2>

            {selectedTable.orders.filter(o => o.status !== 'voided').map(order => (
              <div key={order.id} className="border border-ev-border rounded-lg p-3 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-label text-ev-muted uppercase">{order.payment_source}</span>
                  <span className="text-label text-ev-muted uppercase">{order.status}</span>
                </div>
                {(order.order_items ?? []).map((item, i) => (
                  <div key={i} className="flex justify-between text-body-md text-ev-dark py-1">
                    <span>{item.quantity}× {item.product_name}</span>
                    <span className="text-label text-ev-muted uppercase">{item.status}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center mt-3 pt-2 border-t border-ev-border">
                  <span className="text-body-md font-mono text-ev-dark">{formatAmount(order.amount_pesewas)}</span>
                  {order.payment_source === 'cash' && order.status === 'paid' && (
                    <button
                      onClick={() => setShowCashSheet(order.id)}
                      className="bg-ev-success text-white text-label px-4 py-2 rounded-lg min-h-tap"
                    >
                      Cash Collected
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCashSheet && (
        <div className="fixed inset-0 bg-black/60 z-20 flex items-end">
          <div className="w-full bg-ev-card rounded-t-2xl p-6 space-y-4">
            <h3 className="text-h2 text-ev-dark">Collect Cash</h3>
            <div className="flex items-center border border-ev-border rounded-lg overflow-hidden">
              <span className="px-4 text-body-lg text-ev-muted bg-gray-50 h-14 flex items-center border-r border-ev-border">GHS</span>
              <input
                type="number"
                step="0.01"
                value={cashAmount}
                onChange={e => setCashAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 h-14 px-4 text-h2 font-mono text-ev-dark focus:outline-none"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowCashSheet(null); setCashAmount('') }}
                className="flex-1 h-14 border border-ev-border rounded-lg text-ev-dark text-h3 min-h-tap-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => void collectCash(showCashSheet)}
                className="flex-1 h-14 bg-ev-success text-white rounded-lg text-h3 min-h-tap-lg"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
