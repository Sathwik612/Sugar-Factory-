const CACHE_NAME = "sugar-factory-shell-v1";
const SHELL_ASSETS = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.svg", "/icon-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    request.headers.has("authorization")
  ) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => response.ok ? response : Promise.reject(new Error("Navigation failed")))
        .catch(() => caches.match("/")),
    );
    return;
  }

  if (["script", "style", "font", "image"].includes(request.destination)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
  }
});

self.addEventListener("push", (event) => {
  const payload = event.data?.json?.() ?? {};
  event.waitUntil(self.registration.showNotification(payload.title ?? "Sugar Factory Intelligence", {
    body: payload.body ?? "A factory update needs your attention.",
    icon: "/icon-192.svg",
    badge: "/icon-192.svg",
    data: { url: payload.url ?? "/" },
    tag: payload.tag,
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => new URL(client.url).pathname === target);
      return existing ? existing.focus() : self.clients.openWindow(target);
    }),
  );
});