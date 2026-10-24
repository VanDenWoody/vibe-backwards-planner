const CACHE_NAME = "backwards-planner-v14";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./schedule.js",
  "./plan.js",
  "./storage.js",
  "./templates.js",
  "./sharing.js",
  "./sync.js",
  "./drive.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // cache: "reload" skips the browser's HTTP cache. GitHub Pages lets files be
    // cached for ten minutes, so without it a new version could be filled with
    // the old files and then serve them until the next release.
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then((hit) => hit || fetch(event.request))
    );
    return;
  }

  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
