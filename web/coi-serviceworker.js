// Local copy of COOP/COEP helper to enable SharedArrayBuffer in browsers.
if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
  self.addEventListener("fetch", (event) => {
    const r = event.request;
    if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
      return;
    }
    event.respondWith(
      (async () => {
        const response = await fetch(r);
        const newHeaders = new Headers(response.headers);
        newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
        newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      })()
    );
  });
} else {
  const register = async () => {
    if (window.crossOriginIsolated) return;
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("./coi-serviceworker.js");
    } catch (err) {
      console.warn("COOP/COEP Service Worker failed to register:", err);
    }
  };
  register();
}
