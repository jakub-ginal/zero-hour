const VERSION = "zh-1.16.0";
const SHELL_CACHE = `zero-hour-shell-${VERSION}`;
const API_CACHE = `zero-hour-api-${VERSION}`;

const SHELL = [
  "/",
  "/index.html",
  "/calendar.html",
  "/mission-control.html",
  "/launch.html",
  "/styles.css",
  "/app.js",
  "/shared.js",
  "/mission-control.js",
  "/launch.js",
  "/ascent.js",
  "/starfield.js",
  "/favicon.svg",
  "/site.webmanifest",
  "/icon-180.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== API_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function staticFirst(request, event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const update = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  const response = await update;
  return response || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/api/health") return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, SHELL_CACHE).catch(async () => {
        const pathname = new URL(request.url).pathname;
        return (
          (await caches.match(pathname)) ||
          (await caches.match("/index.html")) ||
          Response.error()
        );
      }),
    );
    return;
  }

  event.respondWith(staticFirst(request, event));
});
