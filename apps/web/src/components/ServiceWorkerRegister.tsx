'use client'

import { useEffect } from 'react'

// Registers the offline-caching service worker (public/sw.js). Its scope is
// menu + static assets only — see the worker itself for why nothing else is
// cached. Safe to mount on every page: registration is idempotent and the
// worker only ever intercepts the narrow set of requests it opts into.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // Best-effort — a registration failure (e.g. private browsing) just
        // means the app runs without offline caching, not that it breaks.
      })
    }
  }, [])

  return null
}
