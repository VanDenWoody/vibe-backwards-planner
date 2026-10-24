const CACHE_NAME = "backwards-planner-v21";

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
  "./picker.js",
  "./whatsnew.js",
  "./privacy.html",
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
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // The release notes are shared as a link and are not part of the app: leave
  // the page (with or without its trailing slash) and its preview image to the
  // network.
  if (url.pathname.includes("/release-notes")) return;

  // A page that is cached under its own URL (privacy.html) is served as
  // itself; every other navigation is the app.
  if (event.request.mode === "navigate") {
    event.respondWith(
      caches
        .match(event.request, { ignoreSearch: true })
        .then((hit) => hit || caches.match("./index.html"))
        .then((hit) => hit || fetch(event.request))
    );
    return;
  }

  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
