import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasUnseen, latestRelease } from "./whatsnew.js";

test("latestRelease takes the first release section", () => {
  const html = `
    <section class="release" id="2026-11-02" aria-labelledby="a"></section>
    <section class="release" id="2026-10-24"></section>`;
  assert.equal(latestRelease(html), "2026-11-02");
});

test("latestRelease ignores feature ids that also start with a date", () => {
  assert.equal(latestRelease(`<section class="feature" id="2026-10-24-sync">`), "");
});

test("latestRelease gives an empty string for anything else", () => {
  assert.equal(latestRelease(""), "");
  assert.equal(latestRelease(null), "");
  assert.equal(latestRelease("<p>Offline</p>"), "");
});

test("latestRelease reads the real release notes page", () => {
  const html = readFileSync(new URL("./release-notes/index.html", import.meta.url), "utf8");
  assert.match(latestRelease(html), /^\d{4}-\d{2}-\d{2}$/);
});

test("hasUnseen is true for a newer release or when nothing was seen", () => {
  assert.equal(hasUnseen("2026-11-02", "2026-10-24"), true);
  assert.equal(hasUnseen("2026-10-24", ""), true);
});

test("hasUnseen is false once the latest release was seen", () => {
  assert.equal(hasUnseen("2026-10-24", "2026-10-24"), false);
  assert.equal(hasUnseen("2026-10-24", "2026-11-02"), false);
});

test("hasUnseen is false when the latest release is unknown", () => {
  assert.equal(hasUnseen("", ""), false);
  assert.equal(hasUnseen("", "2026-10-24"), false);
});
