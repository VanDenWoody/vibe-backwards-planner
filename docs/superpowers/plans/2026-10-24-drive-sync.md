# Google Drive Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the template library the same on all of one person's devices through their Google Drive app folder, behind a hidden `#sync` flag.

**Architecture:** The library becomes version 2 (per-template `updatedAt`, tombstones) under a new storage key. A pure `sync.js` merges two libraries and reports name clashes. `drive.js` wraps Google Identity Services (token model, popup) and the Drive v3 REST API, and runs one sync cycle against an injected `fetch`. `app.js` stamps every local change, shows a sync row on the Templates tab, asks about clashes with the existing import dialog, and triggers syncs while the app is open.

**Tech Stack:** Vanilla ES modules, no build step, `node --test`, Google Identity Services (`https://accounts.google.com/gsi/client`), Drive API v3.

**Spec:** `docs/superpowers/specs/2026-10-24-drive-sync-design.md`

## Global Constraints

- Work on a new branch from up-to-date `main` (e.g. `feat/drive-sync`); open a PR against `main`; never merge it.
- No dependencies, no build step. Every module that has tests must import cleanly under Node (no top-level `window`/`document`).
- Bump `CACHE_NAME` in `sw.js` once per PR that changes cached files (main is at `backwards-planner-v10`; use the next free number when the PR is cut).
- Storage keys: library `backwards-planner:templates:v2` (v1 key `backwards-planner:templates:v1` is read-only, never written); sync state `backwards-planner:sync:v1`; preview flag `backwards-planner:sync-preview:v1`.
- OAuth scopes, exactly: `https://www.googleapis.com/auth/drive.appdata openid email`.
- Drive file: name `templates.json`, in `appDataFolder`.
- Without the preview flag, no sync UI renders, the GIS script is never loaded and no network call is made.
- The access token lives in memory only.
- A Google popup only ever opens inside a click handler, synchronously (no `await` before `requestAccessToken`).
- Export files and share links stay format version 1 and never carry `updatedAt` or tombstones.
- Copy for the sync row is fixed by the spec's UI table (Task 7).

## Review Focus

1. **An old cached app version still running** after the new one migrated: it must still see its v1 library and must not damage v2. Pinned by Task 2 `loadTemplates never writes the v1 key` and `v2 key wins over v1`.
2. **Undo inside the 6 s window while a sync is due**: the undo must not tombstone templates that came from another device. Pinned by Task 7 step "hold merges while `pending !== null`" and the manual check in Task 9.
3. **Two devices resolving the same identical-name pair differently** (stale reads): the template must survive on both. Pinned by Task 4 `identical clash converges whichever side is local`.
4. **Drive returns `version` as a string** (int64): a numeric comparison on strings ("10" < "9") breaks the race check. Pinned by Task 6 `race check compares versions numerically`.
5. **A deleted template restored with Undo after its tombstone already reached Drive**: it must come back everywhere. Pinned by Task 1 `stampChanges re-stamps a restored item and drops its tombstone` and Task 4 `newer item beats older tombstone`.

---

### Task 0: Google Cloud setup (the user, not an agent)

Needed before Task 9; Tasks 1–8 use a placeholder client ID.

- [ ] Follow the spec's "Google Cloud setup" steps 1–5 (project, Drive API, Branding with privacy URL `https://vandenwoody.github.io/vibe-backwards-planner/privacy.html`, scopes, External + **Publish app**, Web client with origins `https://vandenwoody.github.io` and `http://localhost:8000`).
- [ ] Paste the client ID into `GOOGLE_CLIENT_ID` in `drive.js` (Task 6) or hand it to the implementer.

---

### Task 1: Library version 2 in `templates.js`

**Files:**
- Modify: `templates.js`
- Test: `templates.test.js` (update the existing version-1 expectations to version 2)

**Interfaces:**
- Produces:
  - `TEMPLATES_VERSION = 2`
  - `emptyLibrary(): { version: 2, items: [], tombstones: [] }`
  - template shape `{ id, name, deadlineLabel, steps: [{label, minutes}], updatedAt: number }`
  - `normalizeTemplate(raw)` accepts a missing/invalid `updatedAt` as `0`
  - `normalizeLibrary(raw)` accepts version 1 (migrates: `updatedAt: 0`, `tombstones: []`) and version 2; anything else → `emptyLibrary()`
  - `createTemplate(name, deadlineLabel, steps)` returns `updatedAt: 0` (stamping is `stampChanges`' job)
  - `saveTemplate`, `removeTemplate` keep `tombstones` unchanged (removeTemplate does **not** add one)
  - `sameContent(a, b): boolean` — equal name, deadlineLabel and steps (labels and minutes, in order)
  - `stampChanges(previous, next, now: number): library`

- [ ] **Step 1: Write the failing tests**

```js
test("normalizeLibrary migrates version 1 to version 2", () => {
  const result = normalizeLibrary({ version: 1, items: [{ id: "t1", name: "A", deadlineLabel: "", steps: [] }] });
  assert.deepEqual(result, {
    version: 2,
    items: [{ id: "t1", name: "A", deadlineLabel: "", steps: [], updatedAt: 0 }],
    tombstones: [],
  });
});
test("normalizeLibrary keeps valid tombstones and drops malformed ones", () => {
  const result = normalizeLibrary({ version: 2, items: [], tombstones: [{ id: "t1", deletedAt: 5 }, { id: "" }, null, { id: "t2", deletedAt: "x" }] });
  assert.deepEqual(result.tombstones, [{ id: "t1", deletedAt: 5 }]);
});
test("normalizeLibrary rejects version 3", () => {
  assert.deepEqual(normalizeLibrary({ version: 3, items: [], tombstones: [] }), emptyLibrary());
});
test("stampChanges stamps new and edited items, leaves unchanged ones", () => {
  // prev: a (updatedAt 1), b (updatedAt 1); next: a unchanged, b renamed, c new → a.updatedAt 1, b 100, c 100
});
test("stampChanges adds a tombstone for a removed item", () => {
  // prev has a, next has none → tombstones [{ id: "a", deletedAt: 100 }]
});
test("stampChanges re-stamps a restored item and drops its tombstone", () => {
  // prev: no items, tombstone a@50; next: a (updatedAt 1, as in an undo snapshot) → a.updatedAt 100, tombstones []
});
test("stampChanges ignores the order of items", () => {
  // prev [a, b], next [b, a] with same content → no updatedAt changes
});
```

Write the commented tests out with concrete libraries; `now` is `100`.

- [ ] **Step 2: Run** `node --test templates.test.js` — expected: the new tests FAIL, older ones fail on `version: 1`.
- [ ] **Step 3: Implement** the interfaces above. `stampChanges` matches items by id and compares with `sameContent`; it carries `previous`'s tombstones that `next` does not have (an undo snapshot may predate a tombstone).
- [ ] **Step 4: Run** `node --test` — expected: all PASS (fix existing tests' expectations to version 2 / `tombstones: []` / `updatedAt: 0`).
- [ ] **Step 5: Commit** `feat: library version 2 with updatedAt and tombstones`

---

### Task 2: Storage keys and sync state in `storage.js`

**Files:**
- Modify: `storage.js`
- Create: `storage.test.js` (stub `globalThis.window = { localStorage: <Map-backed fake> }` per test)

**Interfaces:**
- Consumes: `normalizeLibrary`, `emptyLibrary` (Task 1)
- Produces:
  - `TEMPLATES_KEY = "backwards-planner:templates:v2"`, `LEGACY_TEMPLATES_KEY = "backwards-planner:templates:v1"`
  - `loadTemplates()` reads v2; if absent, reads v1 and migrates (does not write)
  - `saveTemplates(library)` writes v2 only
  - `SYNC_KEY = "backwards-planner:sync:v1"`; `loadSyncState(): { enabled: boolean, email: string, lastSyncedAt: number, dirty: boolean }` (defaults `false, "", 0, false`); `saveSyncState(state)`
  - `PREVIEW_KEY = "backwards-planner:sync-preview:v1"`; `loadSyncPreview(): boolean`; `saveSyncPreview(on: boolean)` (false removes the key)

- [ ] **Step 1: Write the failing tests**: `loadTemplates migrates from the v1 key`, `v2 key wins over v1`, `loadTemplates never writes the v1 key` (after load + save, the v1 raw string is byte-identical), `loadSyncState returns defaults on garbage`, `saveSyncPreview(false) removes the key`.
- [ ] **Step 2: Run** `node --test storage.test.js` — expected: FAIL.
- [ ] **Step 3: Implement**, keeping the existing try/catch style.
- [ ] **Step 4: Run** `node --test` — expected: PASS.
- [ ] **Step 5: Commit** `feat: store the library under a v2 key and add sync state`

---

### Task 3: Export stays version 1 in `sharing.js`

**Files:**
- Modify: `sharing.js`, `sharing.test.js`

**Interfaces:**
- Produces: `EXPORT_VERSION = 1`; `exportLibrary(library)` writes `{ version: 1, items: [{ id, name, deadlineLabel, steps }] }` (no `updatedAt`, no `tombstones`); `parseExportFile` accepts version 1 only, unchanged output; `addImported` unchanged in behaviour (returns a v2 library).

- [ ] **Step 1: Write the failing tests**: `exportLibrary writes version 1 without updatedAt or tombstones`; `an export round-trips through parseExportFile`.
- [ ] **Step 2: Run** `node --test sharing.test.js` — expected: FAIL.
- [ ] **Step 3: Implement.** `parseExportFile` keeps accepting `version: 1` and maps items through `normalizeTemplate` (skipping nulls and duplicate ids), since `normalizeLibrary` now returns version 2.
- [ ] **Step 4: Run** `node --test` — expected: PASS.
- [ ] **Step 5: Commit** `fix: keep the export format at version 1`

---

### Task 4: Merge in `sync.js`

**Files:**
- Create: `sync.js`, `sync.test.js`

**Interfaces:**
- Consumes: `TEMPLATES_VERSION`, `sameContent`, `findTemplateByName` rules (trimmed, `toLocaleLowerCase`), `uniqueName` from `sharing.js`
- Produces:
  - `mergeLibraries(local, remote): { library, clashes: Array<{ local: Template, remote: Template }>, merged }`
  - `applyClashChoice(library, clash, choice: "keep-both" | "replace", now): library` — keep-both renames `clash.remote` with `uniqueName` and sets its `updatedAt = now`; replace removes `clash.local` and adds tombstone `{ id: clash.local.id, deletedAt: now }`
  - `librariesEqual(a, b): boolean` — same items (by id, content and `updatedAt`) and same tombstones, order-insensitive
  - `mergeLibraries` also returns `merged: Array<{ dropped: string, kept: string }>` for identical-clash merges, so the caller can move the In use marker.

Rules (from the spec, exact):
1. Same id both sides: larger `updatedAt` wins; tie → the copy whose `JSON.stringify` of `{name, deadlineLabel, steps}` sorts first.
2. Tombstones: union by id, larger `deletedAt`. Item dropped if `deletedAt >= updatedAt`, else tombstone dropped.
3. Name clash between a local-only id and a remote-only id: identical (same `deadlineLabel` and same steps; names already compare equal case-insensitively) → keep the smaller id, tombstone the other with `deletedAt = max(updatedAt of both)`, report in `merged`; different → both kept, reported in `clashes`.

- [ ] **Step 1: Write the failing tests** (names are the spec of each case):
  - `disjoint libraries are unioned`
  - `same id: newer updatedAt wins`
  - `same id tie: result does not depend on which side is local` (swap arguments, assert equal libraries)
  - `older edit loses to a tombstone`
  - `newer item beats older tombstone` (and the tombstone is gone)
  - `tombstone on one side removes the item from the other`
  - `identical clash keeps the smaller id`
  - `identical clash converges whichever side is local` (merge(a,b) and merge(b,a) give equal libraries; then merging those two results keeps exactly one template)
  - `different clash is reported and both are kept`
  - `merge is idempotent` (merging the result with remote again changes nothing)
  - `applyClashChoice keep-both numbers the remote copy` → `"Airport (2)"`, `updatedAt` = now
  - `applyClashChoice replace tombstones the local copy`
- [ ] **Step 2: Run** `node --test sync.test.js` — expected: FAIL (module missing).
- [ ] **Step 3: Implement** `sync.js`. Pure, no DOM.
- [ ] **Step 4: Run** `node --test` — expected: PASS.
- [ ] **Step 5: Commit** `feat: merge template libraries for sync`

---

### Task 5: Stamp every local change in `app.js`, preview flag

**Files:**
- Modify: `app.js` (`commitLibrary` ~line 556, `takeSharedLink` ~line 960), `sw.js` (`ASSETS` + `sync.js`; bump `CACHE_NAME`)

**Interfaces:**
- Consumes: `stampChanges` (Task 1), `loadSyncState/saveSyncState`, `loadSyncPreview/saveSyncPreview` (Task 2)
- Produces in `app.js`: `commitLibrary(next)` stamps with `Date.now()` and sets `syncState.dirty = true`; `applySyncedLibrary(next)` saves and renders without stamping and without touching `dirty`; module-level `syncPreview: boolean`.

- [ ] **Step 1: Implement** `commitLibrary` = `library = stampChanges(library, next, Date.now())`, save, mark dirty, render. Add `applySyncedLibrary`.
- [ ] **Step 2: Implement the flag**: on start and on `hashchange`, `#sync` → `saveSyncPreview(true)`, `#nosync` → `saveSyncPreview(false)`; clear the hash with `history.replaceState` as `takeSharedLink` does.
- [ ] **Step 3: Run** `node --test` — expected: PASS.
- [ ] **Step 4: Verify in the browser** (`python -m http.server 8000`, unregister the service worker or bump the cache first — it is cache-first): with an existing v1 library in localStorage, reload → templates still listed, v2 key now present after the first edit, v1 key unchanged; delete + Undo → item back with a fresh `updatedAt`, no tombstone left.
- [ ] **Step 5: Commit** `feat: stamp template changes for sync`

---

### Task 6: Google auth and Drive client in `drive.js`

**Files:**
- Create: `drive.js`, `drive.test.js`

**Interfaces:**
- Consumes: `mergeLibraries`, `applyClashChoice`, `librariesEqual` (Task 4); `normalizeLibrary`, `TEMPLATES_VERSION`, `emptyLibrary` (Task 1)
- Produces:
  - `GOOGLE_CLIENT_ID = "<placeholder>.apps.googleusercontent.com"`, `SCOPES = "https://www.googleapis.com/auth/drive.appdata openid email"`
  - `loadGis(): Promise<void>` — injects the GIS script once; rejects on load error
  - `createAuth({ onToken, onError })` → `{ request(prompt: "consent" | "", loginHint: string): void, token(): string | null }` — wraps `google.accounts.oauth2.initTokenClient`; stores `{ accessToken, expiresAt }` in memory; `token()` returns null within 60 s of expiry
  - `fetchEmail(fetchFn, token): Promise<string>` — `GET https://openidconnect.googleapis.com/v1/userinfo`
  - `createDriveClient(fetchFn, getToken)` → `{ list(): Promise<Array<{id, version: string, createdTime}>>, download(id): Promise<unknown>, create(library): Promise<{id, version}>, update(id, library): Promise<{id, version}>, remove(id): Promise<void> }`; throws `AuthError` on 401, `DriveError` (with `status`) otherwise
  - `runSyncCycle({ client, local, interactive: boolean, resolve(clashes): Promise<Array<"keep-both"|"replace"> | null>, now: number })` → `Promise<{ status: "synced" | "paused" | "newer" | "again", library?, merged? }>`

Endpoints: list `GET https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='templates.json'&fields=files(id,version,createdTime)&orderBy=createdTime`; download `GET …/files/{id}?alt=media`; create `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version` with metadata `{ name: "templates.json", parents: ["appDataFolder"] }`; update `PATCH https://www.googleapis.com/upload/drive/v3/files/{id}?uploadType=media&fields=id,version`; delete `DELETE …/files/{id}`.

Cycle (spec "Sync cycle", exact order): list → if several, download all, merge them into the oldest (rename duplicate names inside the remote set with `uniqueName`) → if any file's `version` > `TEMPLATES_VERSION` return `newer` without writing → `mergeLibraries(local, remote)` → clashes: if `!interactive` return `paused`; else `resolve()`; `null` → `paused`; apply choices → write (create if no file, update if not `librariesEqual(result, remote)`) → delete extra files → if new Drive version > read version + 1 return `again` (with the library) else `synced`.

- [ ] **Step 1: Write the failing tests** with a fake `fetch` that records requests and serves canned responses:
  - `cycle creates the file when Drive has none`
  - `cycle does not write when nothing changed`
  - `cycle merges two files into the oldest and deletes the other`
  - `cycle stops on a newer library version without writing`
  - `cycle pauses on a clash when not interactive and writes nothing`
  - `cycle applies clash answers when interactive`
  - `cycle pauses when the clash dialog is cancelled`
  - `race check compares versions numerically` (read `"9"`, after write `"11"` → `again`; read `"9"`, after `"10"` → `synced`)
  - `401 raises AuthError`
  - `requests carry the bearer token`
- [ ] **Step 2: Run** `node --test drive.test.js` — expected: FAIL.
- [ ] **Step 3: Implement** `drive.js`. Only `loadGis` and `createAuth` touch `document`/`google`, and only when called.
- [ ] **Step 4: Run** `node --test` — expected: PASS.
- [ ] **Step 5: Commit** `feat: Google Drive client and sync cycle`

---

### Task 7: Sync row, triggers and auth wiring

**Files:**
- Modify: `index.html` (row under `.transfer`), `styles.css`, `app.js`, `sw.js` (`ASSETS` + `drive.js`)

**Interfaces:**
- Consumes: everything from Tasks 2, 5, 6.
- Produces: `requestSync({ interactive: boolean })` in `app.js`; row states as below.

Row copy (exact, from the spec):

| State | Text | Control |
|---|---|---|
| off | Sync templates with Google Drive | **Turn on** |
| syncing | Syncing… | — |
| synced | Synced HH:MM · {email} | **⋯** → Sync now, Turn off |
| needs-sign-in | Tap to sync (+ " · changes waiting" when `dirty`) | whole row is the button |
| offline | Offline — changes sync when you're back | — |
| paused | Sync paused — name clash | **Resolve** |
| newer | Drive has newer templates. Reload to update. | reload |
| error | Sync failed: {reason} | **Retry** |
| gis-unavailable | Google sign-in could not load | retry |
| ios-standalone | Sync works in Safari, not in the home-screen app | — |
| sign-in-failed | Google sign-in didn't work in this browser. Use Export/Import instead. | retry |

- [ ] **Step 1: Markup and style** the row; it renders only when `syncPreview` is true. The ⋯ menu reuses the row-menu pattern from PR #3.
- [ ] **Step 2: Load GIS** at start when `syncState.enabled`, else on first Templates tab show; never when `!syncPreview`. Show `ios-standalone` when `navigator.standalone === true`.
- [ ] **Step 3: Wire taps**: Turn on → `auth.request("consent", "")`; Tap to sync / Retry / Resolve / Sync now → `auth.request("", email)` when `token()` is null, else sync directly; all with `interactive: true`. `popup_failed_to_open` / `popup_closed` → `sign-in-failed`.
- [ ] **Step 4: Triggers** (non-interactive, only when enabled and `token()` non-null, otherwise set needs-sign-in): 3 s after `commitLibrary`, `visibilitychange` to visible, `online`. `offline` event or `navigator.onLine === false` → offline state.
- [ ] **Step 5: Single flight and holds**: one cycle at a time with a run-again flag; before applying a result, wait while `pending !== null`, `naming !== null` or `importDialogEl.open`, then apply via `applySyncedLibrary`; status `again` reruns once. After `synced`: `lastSyncedAt = now`, `dirty = false`, clear an In use marker whose template is gone or move it per `merged`.
- [ ] **Step 6: Turn off**: forget token and email, `enabled = false`, keep the library.
- [ ] **Step 7: Run** `node --test` — PASS. **Verify in the browser** at `http://localhost:8000/#sync` with the real client ID (Task 0): turn on, consent, file created (row says Synced), edit → synced within ~3 s, Turn off → row back to off. Without `#sync` (fresh profile): no row, no request to `accounts.google.com` in the network log.
- [ ] **Step 8: Commit** `feat: sync templates with Google Drive behind #sync`

---

### Task 8: Clash dialog, privacy page, README, cache bump

**Files:**
- Modify: `app.js`, `README.md`, `sw.js`
- Create: `privacy.html`

- [ ] **Step 1: Clash dialog** via `ask()`: title `You have two templates called “{name}”.`; body `facts("This device: " + summarize(local), "Other device: " + summarize(remote))`; buttons `{ value: "keep-both", label: "Keep both", primary: true }`, `{ value: "replace", label: "Replace with other device's" }`; `all` text `Do the same for the {n} other{s}` when more clashes remain; Escape → `resolve` returns `null`.
- [ ] **Step 2: `privacy.html`**: standalone page (own doctype, viewport, styles link): templates are stored on the device and, when sync is on, only in the user's own Google Drive app folder; the app has no server and sends nothing elsewhere; how to remove the data (Drive → Settings → Manage apps). Add to `ASSETS`.
- [ ] **Step 3: README**: a "Sync (preview)" section — Google Cloud setup steps from the spec, the `#sync`/`#nosync` flag, the one-tap-per-session limitation, iPhone home-screen app not supported.
- [ ] **Step 4: Bump `CACHE_NAME`** once for this PR; confirm `ASSETS` lists `sync.js`, `drive.js`, `privacy.html`.
- [ ] **Step 5: Run** `node --test` — PASS. **Verify in the browser** with two profiles against one Google account: create "Airport" with different steps in each, sync both → second sync shows the dialog; Keep both → "Airport (2)" appears in both after syncing; repeat with Replace → one left in both.
- [ ] **Step 6: Commit** `feat: ask about name clashes during sync`; push; `gh pr create` against `main` describing the change and the verification. Do not merge.

---

### Task 9: Device test on the live site (the user, after merge)

- [ ] Open `https://vandenwoody.github.io/vibe-backwards-planner/#sync` on the Android installed app, desktop Chrome, and an iPhone Safari tab.
- [ ] On each: Turn on, sync; edit on A → appears on B; delete on B → gone on A; delete + Undo within 6 s while another device syncs → template survives everywhere; offline edit then online → synced; after an hour, row shows Tap to sync and one tap syncs.
- [ ] Outcome: all pass → follow-up PR removes the `#sync` flag. iPhone fails, others pass → follow-up PR removes the flag and shows `sign-in-failed` copy on iPhone (decided). Android fails → bring the Dropbox fallback back to the user as a decision.
