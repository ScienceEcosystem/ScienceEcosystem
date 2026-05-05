// ScienceEcosystem PWA Service Worker
// Strategy:
//   - Static shell (HTML/CSS/JS)  → Cache First (fast loads)
//   - API calls to OpenAlex etc  → Network First (fresh data)
//   - Everything else             → Network First with cache fallback

const CACHE_VERSION = "se-v2";
const STATIC_CACHE = CACHE_VERSION + "-static";
const DATA_CACHE = CACHE_VERSION + "-data";

// Pages and assets to pre-cache on install (the "app shell")
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/search.html",
  "/library.html",
  "/paper.html",
  "/profile.html",
  "/user-profile.html",
  "/journal-finder.html",
  "/research-tools.html",
  "/funder-finder.html",
  "/style.css",
  "/scripts/search.js",
  "/scripts/components.js",
  "/scripts/library.js",
  "/scripts/session.js",
  "/scripts/paper.js",
  "/scripts/profile.js",
  "/assets/logos_se/logo.png",
  "/assets/logos_se/logo_name.png",
  "/offline.html",
];

// ── Install: pre-cache static shell ──────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // addAll will fail silently per-asset if any 404, so use individual adds
      return Promise.allSettled(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn("[SW] Failed to cache " + url + ":", err.message);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("se-") && k !== STATIC_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: routing strategy ───────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Don't intercept non-GET, chrome-extension, or POST requests
  if (request.method !== "GET") return;
  if (!url.protocol.startsWith("http")) return;

  // ── 1. API calls (our own backend + OpenAlex + external APIs) ──
  //    Network First: try network, fall back to cache if offline
  const isApiCall =
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("openalex.org") ||
    url.hostname.includes("zenodo.org") ||
    url.hostname.includes("crossref.org") ||
    url.hostname.includes("datacite.org") ||
    url.hostname.includes("unpaywall.org") ||
    url.hostname.includes("api.figshare.com") ||
    url.hostname.includes("api.github.com");

  if (isApiCall) {
    event.respondWith(networkFirstWithCache(request, DATA_CACHE, 60 * 1000)); // 1 min TTL
    return;
  }

  // ── 2. Static assets on our own origin ──
  //    Cache First: serve from cache instantly, revalidate in background
  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".png") ||
      url.pathname.endsWith(".jpg") ||
      url.pathname.endsWith(".svg") ||
      url.pathname.endsWith(".ico") ||
      url.pathname.endsWith(".woff2") ||
      url.pathname.endsWith(".woff"));

  if (isStaticAsset) {
    event.respondWith(cacheFirstWithRevalidate(request, STATIC_CACHE));
    return;
  }

  // ── 3. HTML navigation pages ──
  //    Network First: always try to get fresh HTML, cache as fallback
  if ((request.headers.get("Accept") || "").includes("text/html")) {
    event.respondWith(networkFirstWithOfflineFallback(request, STATIC_CACHE));
    return;
  }

  // ── 4. Everything else: network only ──
  // (fonts from Google, vis.js CDN, etc.)
  event.respondWith(fetch(request).catch(() => new Response("", { status: 408 })));
});

// ── Strategy helpers ──────────────────────────────────────────────────────────

/**
 * Cache First with background revalidation (stale-while-revalidate).
 * Great for CSS/JS/images — instant load, auto-updates in background.
 */
async function cacheFirstWithRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Revalidate in background regardless
  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || (await networkFetch) || new Response("", { status: 408 });
}

/**
 * Network First with cache fallback and optional TTL.
 * Great for API data — fresh when online, cached when offline.
 */
async function networkFirstWithCache(request, cacheName, ttlMs) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Network First for HTML pages, with offline.html fallback.
 */
async function networkFirstWithOfflineFallback(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;

    // Last resort: show offline page
    const offline = await cache.match("/offline.html");
    return (
      offline ||
      new Response("<h1>You are offline</h1><p>Please check your connection and try again.</p>", {
        headers: { "Content-Type": "text/html" },
      })
    );
  }
}

// ── Background sync for library saves when offline ───────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-library") {
    event.waitUntil(syncPendingLibraryItems());
  }
});

async function syncPendingLibraryItems() {
  // Read queued items from IndexedDB and POST them when back online
  // This is a placeholder — wire up to your library.js save queue
  const db = await openDB();
  const pending = await db.getAll("pending-saves");
  for (const item of pending) {
    try {
      await fetch("/api/library", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      await db.delete("pending-saves", item.id);
    } catch (_) {
      // Will retry next sync
    }
  }
}

// Minimal IndexedDB helper for offline queue
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("se-offline", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("pending-saves")) {
        db.createObjectStore("pending-saves", { keyPath: "id" });
      }
    };
    req.onsuccess = (e) =>
      resolve({
        getAll: (store) =>
          new Promise((res, rej) => {
            const tx = e.target.result.transaction(store, "readonly");
            const req2 = tx.objectStore(store).getAll();
            req2.onsuccess = () => res(req2.result);
            req2.onerror = () => rej(req2.error);
          }),
        delete: (store, key) =>
          new Promise((res, rej) => {
            const tx = e.target.result.transaction(store, "readwrite");
            const req2 = tx.objectStore(store).delete(key);
            req2.onsuccess = () => res();
            req2.onerror = () => rej(req2.error);
          }),
      });
    req.onerror = () => reject(req.error);
  });
}

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (_) {
    data = { title: "ScienceEcosystem", body: event.data.text() };
  }

  const options = {
    body: data.body || "",
    icon: "/assets/logos_se/logo.png",
    badge: "/assets/logos_se/logo.png",
    tag: data.tag || "se-notification",
    data: { url: data.url || "/" },
    actions: data.actions || [],
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(data.title || "ScienceEcosystem", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
