'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { formatAmount } from '@evolveit/shared/money'
import { normalisePhone } from '@evolveit/shared/phone'

interface Product {
  id: string
  name: string
  description: string | null
  category: string
  station: string
  price_pesewas: number
  image_url: string | null
}

interface MenuResponse {
  table: { id: string; label: string; zone: string; seats: number; min_spend_pesewas: number }
  source: string
  allows_cash: boolean
  products: Product[]
}

interface CartItem {
  product: Product
  quantity: number
}

export default function MenuPage() {
  const { token } = useParams<{ token: string }>()
  const [menu, setMenu] = useState<MenuResponse | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [paymentSource, setPaymentSource] = useState<'momo' | 'cash'>('momo')
  const [view, setView] = useState<'menu' | 'cart'>('menu')
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    void fetch(`/api/menu/${token}`)
      .then(r => r.json())
      .then(d => {
        setMenu(d as MenuResponse)
        // Restore cart from sessionStorage on refresh
        const saved = sessionStorage.getItem(`cart-${token}`)
        if (saved) setCart(JSON.parse(saved) as CartItem[])
      })
  }, [token])

  function addToCart(product: Product) {
    setCart(prev => {
      const existing = prev.find(c => c.product.id === product.id)
      const next = existing
        ? prev.map(c => c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c)
        : [...prev, { product, quantity: 1 }]
      sessionStorage.setItem(`cart-${token}`, JSON.stringify(next))
      return next
    })
  }

  function removeFromCart(productId: string) {
    setCart(prev => {
      const next = prev
        .map(c => c.product.id === productId ? { ...c, quantity: c.quantity - 1 } : c)
        .filter(c => c.quantity > 0)
      sessionStorage.setItem(`cart-${token}`, JSON.stringify(next))
      return next
    })
  }

  function validatePhone() {
    const norm = normalisePhone(guestPhone)
    if (!norm) { setPhoneError('Enter a valid Ghana number'); return false }
    setPhoneError('')
    return true
  }

  async function checkout() {
    if (!validatePhone() || !guestName) return
    setIsLoading(true)
    try {
      const res = await fetch('/api/orders/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          items: cart.map(c => ({ product_id: c.product.id, quantity: c.quantity })),
          guest_name: guestName,
          guest_phone: guestPhone,
          payment_source: paymentSource,
        }),
      })
      const data = await res.json() as { authorization_url?: string; order_id?: string; status?: string }
      if (data.authorization_url) {
        window.location.href = data.authorization_url
      } else if (data.status === 'paid') {
        sessionStorage.removeItem(`cart-${token}`)
        setCart([])
        alert('Order placed! Your waiter will bring your drinks.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const totalPesewas = cart.reduce((s, c) => s + c.product.price_pesewas * c.quantity, 0)
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0)

  const grouped = (menu?.products ?? []).reduce<Record<string, Product[]>>((acc, p) => {
    acc[p.category] ??= []
    acc[p.category]!.push(p)
    return acc
  }, {})

  if (!menu) return (
    <div className="min-h-screen bg-ev-page flex items-center justify-center">
      <p className="text-body-md text-ev-muted">Loading menu...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-ev-page pb-24">
      <div className="bg-ev-bg px-4 py-5 text-center">
        <h1 className="text-h1 text-white font-display">Memories Night Club</h1>
        <p className="text-body-md text-ev-secondary">{menu.table.label}</p>
      </div>

      {view === 'menu' && (
        <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
          {Object.entries(grouped).map(([category, products]) => (
            <div key={category}>
              <h2 className="text-label text-ev-muted uppercase tracking-widest mb-3 capitalize">
                {category.replace('_', ' ')}
              </h2>
              <div className="space-y-2">
                {products.map(product => (
                  <div key={product.id} className="bg-ev-card rounded-lg border border-ev-border p-4 flex items-center justify-between">
                    <div className="flex-1 mr-4">
                      <p className="text-h3 text-ev-dark">{product.name}</p>
                      {product.description && <p className="text-body-md text-ev-muted">{product.description}</p>}
                      <p className="text-body-md text-ev-crimson font-mono mt-1">{formatAmount(product.price_pesewas)}</p>
                    </div>
                    <button
                      onClick={() => addToCart(product)}
                      className="w-10 h-10 rounded-full bg-ev-crimson text-white text-h2 flex items-center justify-center min-h-tap min-w-tap"
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'cart' && (
        <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
          {cart.map(item => (
            <div key={item.product.id} className="bg-ev-card rounded-lg border border-ev-border p-4 flex items-center justify-between">
              <div>
                <p className="text-h3 text-ev-dark">{item.product.name}</p>
                <p className="text-body-md text-ev-muted font-mono">{formatAmount(item.product.price_pesewas)} × {item.quantity}</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => removeFromCart(item.product.id)} className="w-10 h-10 rounded-full border border-ev-border flex items-center justify-center min-h-tap min-w-tap">−</button>
                <span className="text-h2 font-mono w-4 text-center">{item.quantity}</span>
                <button onClick={() => addToCart(item.product)} className="w-10 h-10 rounded-full border border-ev-border flex items-center justify-center min-h-tap min-w-tap">+</button>
              </div>
            </div>
          ))}

          <div className="bg-ev-card rounded-lg border border-ev-border p-4 space-y-3">
            <input
              type="text"
              value={guestName}
              onChange={e => setGuestName(e.target.value)}
              placeholder="Your name"
              className="w-full h-12 border border-ev-border rounded-lg px-4 text-body-lg"
            />
            <div className="flex items-center border border-ev-border rounded-lg overflow-hidden">
              <span className="px-3 text-body-md text-ev-muted bg-gray-50 h-12 flex items-center border-r border-ev-border">🇬🇭 +233</span>
              <input
                type="tel"
                value={guestPhone}
                onChange={e => setGuestPhone(e.target.value)}
                onBlur={validatePhone}
                placeholder="024 412 3456"
                className="flex-1 h-12 px-3 text-body-lg"
              />
            </div>
            {phoneError && <p className="text-label text-ev-error">{phoneError}</p>}

            {menu.allows_cash && (
              <div className="flex gap-2">
                <button
                  onClick={() => setPaymentSource('momo')}
                  className={`flex-1 h-12 rounded-lg border text-h3 min-h-tap ${paymentSource === 'momo' ? 'bg-ev-momo border-ev-momo text-black' : 'border-ev-border text-ev-dark'}`}
                >
                  MoMo
                </button>
                <button
                  onClick={() => setPaymentSource('cash')}
                  className={`flex-1 h-12 rounded-lg border text-h3 min-h-tap ${paymentSource === 'cash' ? 'bg-green-100 border-ev-success text-ev-success' : 'border-ev-border text-ev-dark'}`}
                >
                  Cash
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-body-lg text-ev-dark font-semibold">Total</span>
            <span className="text-h1 font-mono text-ev-crimson">{formatAmount(totalPesewas)}</span>
          </div>

          <button
            onClick={checkout}
            disabled={isLoading || cart.length === 0}
            className="w-full h-14 bg-ev-crimson text-white text-h3 rounded-lg min-h-tap-lg disabled:opacity-40"
          >
            {isLoading ? 'Processing...' : paymentSource === 'momo' ? 'Pay with MoMo' : 'Place Cash Order'}
          </button>
        </div>
      )}

      {/* Floating cart button */}
      {view === 'menu' && cartCount > 0 && (
        <button
          onClick={() => setView('cart')}
          className="fixed bottom-6 left-4 right-4 max-w-lg mx-auto h-14 bg-ev-crimson text-white text-h3 rounded-lg flex items-center justify-between px-6 shadow-lg"
        >
          <span>{cartCount} item{cartCount !== 1 ? 's' : ''}</span>
          <span>View Order →</span>
          <span className="font-mono">{formatAmount(totalPesewas)}</span>
        </button>
      )}

      {view === 'cart' && (
        <button
          onClick={() => setView('menu')}
          className="fixed bottom-6 left-4 text-ev-crimson text-body-md underline"
        >
          ← Back to menu
        </button>
      )}
    </div>
  )
}
