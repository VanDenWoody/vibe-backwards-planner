// The release notes page lists its releases newest first, each as
// <section class="release" id="YYYY-MM-DD">. The app reads the first one to
// know whether there is something the user has not seen yet.

const RELEASE = /<section\b[^>]*\bclass="release"[^>]*\bid="(\d{4}-\d{2}-\d{2})"/;

// The date of the newest release in the page's HTML, or "" when none is found.
export function latestRelease(html) {
  if (typeof html !== "string") return "";
  const match = html.match(RELEASE);
  return match === null ? "" : match[1];
}

// ISO dates compare as strings. Nothing seen yet counts as unseen, so a new
// user is pointed at the notes too.
export function hasUnseen(latest, seen) {
  if (latest === "") return false;
  return seen === "" || latest > seen;
}
