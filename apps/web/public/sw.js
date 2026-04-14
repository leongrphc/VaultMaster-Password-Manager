const STATIC_CACHE = "vaultmaster-static-v2";
const PAGE_CACHE = "vaultmaster-pages-v2";
const STATIC_ROUTES = [
  "/",
  "/vault",
  "/vault/settings",
  "/vault/generator",
  "/vault/health",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PAGE_CACHE).then((cache) => cache.addAll(STATIC_ROUTES)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![STATIC_CACHE, PAGE_CACHE].includes(key))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (
    url.pathname.startsWith("/api/") ||
    url.searchParams.has("_rsc") ||
    request.headers.get("rsc") === "1" ||
    request.headers.has("next-router-prefetch")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGE_CACHE));
    return;
  }

  if (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  if (
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/" ||
    url.pathname === "/vault" ||
    url.pathname === "/vault/settings" ||
    url.pathname === "/vault/generator" ||
    url.pathname === "/vault/health"
  ) {
    event.respondWith(networkFirst(request, PAGE_CACHE));
  }
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match("/vault")) ||
      (await cache.match("/"))
    );
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);

  return cached || networkPromise;
}
