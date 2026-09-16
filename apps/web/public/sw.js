// Memories Night Club — PWA service worker.
//
// Scope is deliberately narrow: cache the menu (for offline display) and
// static build assets, cache nothing else. Every other request — every
// API route that touches money, a session, ticket stock, or the owner
// dashboard — is left completely alone: this worker never calls
// respondWith() for them, so the browser handles them exactly as if no
// service worker were installed. That's the simplest way to guarantee
// nothing financial or session-scoped is ever served stale: there is no
// denylist to keep in sync, just a short allowlist of what's safe to cache,
// and everything else falls through untouched by default.
//
// This is separate from the door hub's offline system (apps/hub) on
// purpose — a hub is a trusted device fixed at one door; a staff phone
// running this worker is not the same threat model, and the two have
// different failure modes. Don't reuse the hub's sync mechanism here.

const STATIC_CACHE = 'mnc-static-v1'
const MENU_CACHE = 'mnc-menu-v1'

function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/')
    || url.pathname === '/manifest.json'
    || /\.(png|jpg|jpeg|webp|svg|ico)$/.test(url.pathname)
}

function isMenuRequest(url) {
  return url.pathname.startsWith('/api/menu/')
}

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== STATIC_CACHE && name !== MENU_CACHE)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // never intercept a write

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE))
    return
  }

  if (isMenuRequest(url)) {
    event.respondWith(networkFirst(req, MENU_CACHE))
    return
  }

  // Everything else — every other /api/* route, every staff/admin page —
  // is intentionally left unhandled here.
})

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) cache.put(request, response.clone())
  return response
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch (err) {
    const cached = await cache.match(request)
    if (cached) return cached
    throw err
  }
}
