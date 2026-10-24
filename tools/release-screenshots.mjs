// Takes the release-notes screenshots from the real app, so the notes never
// show a drawing of a screen that differs from the app.
//
//   python -m http.server 8000          (in the project folder, separately)
//   node tools/release-screenshots.mjs tools/release-shots/2026-10-24.json
//
// The spec lists shots. Each one starts from a fresh page with the given
// localStorage, runs its steps and captures the union of the clip selectors
// (or the whole viewport). "{{tomorrow}}" in storage becomes tomorrow's date,
// and "shareTemplate" opens the page through a shared-template link.
// Needs Chrome and Node 22+ (built-in WebSocket); writes PNGs at 2x.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SHARE_PARAM, encodeTemplate } from "../sharing.js";

const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const DEVICES = {
  phone: { width: 412, height: 870, deviceScaleFactor: 2, mobile: true },
  desktop: { width: 1000, height: 720, deviceScaleFactor: 2, mobile: false },
};
const PAD = 12;

const specPath = process.argv[2];
if (!specPath) {
  console.error("Usage: node tools/release-screenshots.mjs <spec.json>");
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const base = spec.base ?? "http://localhost:8000/";
const outDir = resolve(spec.out);
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const profile = mkdtempSync(join(tmpdir(), "release-shots-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--hide-scrollbars",
  "--lang=en-GB",
  "about:blank",
]);

let page;
for (let tries = 0; tries < 50 && !page; tries += 1) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = targets.find((target) => target.type === "page");
  } catch {
    await sleep(200);
  }
}
if (!page) throw new Error("Chrome did not start");

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((done) => socket.addEventListener("open", done, { once: true }));
let nextId = 0;
const pending = new Map();
const waiters = [];
socket.addEventListener("message", (message) => {
  const data = JSON.parse(message.data);
  if (data.id !== undefined) {
    const { ok, fail } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) fail(new Error(`${data.error.message}`));
    else ok(data.result);
  } else {
    for (const waiter of waiters.filter((w) => w.method === data.method)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.done();
    }
  }
});
const send = (method, params = {}) =>
  new Promise((ok, fail) => {
    nextId += 1;
    pending.set(nextId, { ok, fail });
    socket.send(JSON.stringify({ id: nextId, method, params }));
  });
const once = (method) => new Promise((done) => waiters.push({ method, done }));

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? expression);
  return result.result.value;
}

async function load(url) {
  const loaded = once("Page.loadEventFired");
  await send("Page.navigate", { url });
  await loaded;
  await sleep(700);
}

async function key(char) {
  for (const type of ["keyDown", "keyUp"]) {
    await send("Input.dispatchKeyEvent", { type, key: char, text: type === "keyDown" ? char : undefined });
  }
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

for (const shot of spec.shots) {
  const device = DEVICES[shot.device ?? "phone"];
  await send("Emulation.setDeviceMetricsOverride", device);
  // (pointer: coarse) follows touch emulation: the picker shows its keypad sheet.
  await send("Emulation.setTouchEmulationEnabled", { enabled: device.mobile, maxTouchPoints: device.mobile ? 5 : 1 });

  await load(base);
  const storage = JSON.stringify(shot.storage ?? {}).replaceAll("{{tomorrow}}", tomorrow());
  await evaluate(`localStorage.clear(); for (const [k, v] of Object.entries(${storage})) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); true`);
  // shareTemplate opens the app the way a friend's shared link does.
  // The query makes it a real navigation: a change of hash alone fires no load.
  const hash = shot.shareTemplate ? `?shared#${SHARE_PARAM}=${encodeTemplate(shot.shareTemplate)}` : "";
  await load(base + hash);

  for (const step of shot.steps ?? []) {
    if (step.click) await evaluate(`document.querySelector(${JSON.stringify(step.click)}).click(); true`);
    if (step.keys) for (const char of step.keys) await key(char);
    if (step.eval) await evaluate(step.eval);
    if (step.load) await load(base + step.load);
    await sleep(step.wait ?? 400);
  }

  let clip;
  if (!shot.clip) {
    clip = { x: 0, y: 0, width: device.width, height: device.height };
  } else {
    clip = await evaluate(`(() => {
      const rects = ${JSON.stringify(shot.clip)}.flatMap((s) => [...document.querySelectorAll(s)])
        .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
      const top = Math.min(...rects.map((r) => r.top)) + scrollY - ${PAD};
      const bottom = Math.max(...rects.map((r) => r.bottom)) + scrollY + ${PAD};
      const left = Math.min(...rects.map((r) => r.left)) - ${PAD};
      const right = Math.max(...rects.map((r) => r.right)) + ${PAD};
      const x = Math.max(0, left), y = Math.max(0, top);
      return { x, y, width: Math.min(innerWidth, right) - x, height: bottom - y };
    })()`);
  }
  const { data } = await send("Page.captureScreenshot", {
    format: "png",
    clip: { ...clip, scale: 1 },
    captureBeyondViewport: true,
  });
  const file = join(outDir, `${shot.name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`${shot.name}.png  ${Math.round(clip.width)}x${Math.round(clip.height)} css px`);
}

socket.close();
chrome.kill();
await sleep(500);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // Chrome may still hold a lock on Windows; the temp folder is harmless.
}
