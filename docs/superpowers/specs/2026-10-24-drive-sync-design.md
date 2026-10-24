# Backwards Planner — Google Drive sync of templates

Date: 2026-10-24
Status: Approved 2026-10-24, ready for implementation planning

## Intent

Keep the template library the same on every device a person uses, through
their own Google Drive, without a backend. Templates are routines built up
over time ("Airport", "Train to Amsterdam"); retyping them on a second device,
or losing them with a phone, is the problem. One-time sharing with other
people is already solved by share links and file export/import (PR #3,
`sharing.js`) and is not part of this.

Success: a template saved, updated, renamed or deleted on one device shows up
the same on the others the next time they sync, nothing ever comes back from
the dead, and nothing is silently thrown away when two devices disagree about
a name.

## Decisions taken with the user

| Topic | Decision |
|---|---|
| Provider | Google Drive, accepting that renewing sign-in needs a tap (see Auth). Dropbox was offered as the alternative and declined. |
| Devices | Android installed app, desktop browser, iPhone Safari tab. The iPhone home-screen app is **not** a target. |
| Users | Anyone using the site, so the Google app goes "In production". |
| Trigger | Automatic while the app is open, plus a manual "Sync now". |
| Scope | Templates only. The current plan stays per device. |
| Name clash | Asked like Import asks, with the choices **Keep both** and **Replace with other device's**. Identical templates merge silently. |
| UI place | A small sync row on the Templates tab. Planning tab untouched. |
| Expired sign-in | Never pop up on its own. Show "Tap to sync" in the sync row. |
| Device testing | Sync ships to the live site behind a hidden flag (`#sync`), so the user can test on real devices before anyone else sees it. A later PR removes the flag. |
| iPhone fails | If sign-in works on Android and desktop but not in the iPhone Safari tab, Drive sync still ships; the iPhone stays local-only with export/import. |

## Goals

- Sync the library across one person's devices through their Google Drive.
- Deletes stay deleted; edits on different templates on different devices all
  survive.
- Works on the three target devices; degrades to "local only" everywhere else
  without breaking the app.
- No backend, no build step, no dependencies besides Google's own GIS script.

## Non-goals

- Syncing the current plan, the active-template marker or the open tab.
- Real-time sync, background sync while the app is closed, push from Drive.
- Sharing with other people through Drive (share links cover that).
- Showing the file in the user's visible Drive, or letting them edit it there.
- The iPhone home-screen app (popup sign-in there is known to be unreliable;
  it keeps working local-only).

## Anti-goals (a failure even if it technically works)

- A deleted template reappearing after a sync.
- A template silently disappearing because another device had one with the
  same name.
- A Google popup opening without the user having tapped something.
- The Planning tab gaining sync chrome, or the app refusing to work offline.
- Asking for access to the user's whole Drive.

## Research findings (2026-10-24, from Google's and Dropbox's docs)

Full notes with URLs: session notes file `drive-sync-research.md` (outside the
repo). Summary:

- **Token model.** Google Identity Services (GIS)
  `google.accounts.oauth2.initTokenClient` gives an access token of about one
  hour and no refresh token. Renewal needs a user gesture and always uses a
  popup ("only the dialog UX is supported"); with `prompt: ''` and consent
  already given, the popup opens and closes by itself. There is no silent
  background renewal. No deprecation of the token model was found.
- **No backend means no refresh token.** The code flow needs a client secret
  for the exchange; community reports say Google rejects PKCE without a secret
  for "Web application" clients. Not usable here.
- **iOS.** Google says "Due to ITP [redirect mode] is required for iOS" (for
  Sign In With Google) and the token model has no redirect mode. Reports say
  the popup is broken in iOS home-screen apps (`window.opener` lost). A normal
  Safari tab is expected to work but is **untested**.
- **Android installed PWA.** Expected to work (popup in the same Chrome
  profile). **Untested.**
- **Scopes.** `drive.appdata` and `drive.file` are both *non-sensitive*;
  `drive` and `drive.readonly` are *restricted*. "If your app utilizes only
  non-sensitive scopes, it is not mandatory for your app to complete the app
  verification process." Without (optional) brand verification the consent
  screen shows only the domain, not the app name and logo.
- **Testing mode** is capped at 100 listed test users and "authorizations by a
  test user will expire seven days from the time of consent". Publishing
  "In production" with non-sensitive scopes only avoids both.
- **Brand verification** (optional) needs a homepage and privacy policy on a
  domain verified in Search Console. `vandenwoody.github.io` is a top private
  domain (github.io is on the Public Suffix List), but whether Google accepts
  it for brand verification is **unknown**.
- **appDataFolder.** Hidden, app-private folder; list with
  `spaces=appDataFolder`, create with `parents: ['appDataFolder']`, multipart
  upload up to 5 MB, update with `PATCH`. Deleted when the user removes the
  app from their Drive. The v3 File resource has a monotonically increasing
  `version`; no documented `If-Match` support, so no server-side
  compare-and-swap.

## Constraints

- Static site on GitHub Pages; vanilla ES modules; tests with `node --test`.
- Origin `https://vandenwoody.github.io`, app under `/vibe-backwards-planner/`.
- The service worker caches same-origin assets only and already ignores
  cross-origin requests, so Google's script and API calls go to the network.
- Every change to cached files bumps `CACHE_NAME` in `sw.js`.
- Templates already refuse duplicate names, case-insensitively, trimmed
  (`findTemplateByName`).

## Design

### Google Cloud setup (done by the user, documented in the README)

1. Create a Google Cloud project, enable the **Google Drive API**.
2. Google Auth Platform → Branding: app name "Backwards Planner", support
   email, app home page `https://vandenwoody.github.io/vibe-backwards-planner/`,
   privacy policy `…/privacy.html`, authorized domain `vandenwoody.github.io`.
3. Data access: scopes `https://www.googleapis.com/auth/drive.appdata`,
   `openid`, `email` (all non-sensitive).
4. Audience: External, then **Publish app** (In production). No verification
   submission.
5. Clients: OAuth client of type *Web application*, authorized JavaScript
   origins `https://vandenwoody.github.io` and `http://localhost:8000`. No
   redirect URIs (the token model uses a popup).
6. Put the client ID (public, not a secret) in `drive.js`.

Scope choice: `drive.appdata` over `drive.file`. Both are non-sensitive, but
appdata keeps the file out of the user's Drive listing, where it could be
moved, renamed or edited by hand, and needs no folder handling. `email` is
there so the sync row can say which account is in use and so renewals can
pass `login_hint` and skip the account chooser.

### Auth flow

- The GIS script (`https://accounts.google.com/gsi/client`) is loaded lazily:
  when sync is on, at app start; when it is off, when the Templates tab is
  first shown (so it is ready before the user taps "Turn on" — a popup must
  open inside the tap itself, not after an `await`).
- **Turn on**: the tap calls `requestAccessToken({ prompt: 'consent' })`. On
  success, fetch the email (`https://openidconnect.googleapis.com/v1/userinfo`),
  store it, and run a first sync.
- The token lives **in memory only**, with its expiry time. It is never
  written to storage.
- At each sync: if there is no token or it expires within a minute, do not
  call Google; set the row to *Tap to sync*. Tapping calls
  `requestAccessToken({ prompt: '', login_hint: email })` and then syncs. A
  401 from Drive is treated the same way.
- Practical effect: after the app has been closed for more than about an hour,
  the first sync of a session needs one tap. Local edits are never lost
  meanwhile; they wait locally and go up on the next sync.
- **Turn off**: forget token and email, set sync off. Local templates stay.
  The Drive file stays (removable by the user under Drive → Settings → Manage
  apps). No token revocation (builder may add it; not required).
- Popup errors (`popup_failed_to_open`, `popup_closed`) leave the row in its
  previous state with a short notice; no retry loop.

### Hidden flag for device testing

Opening the app with `#sync` in the URL sets the localStorage key
`backwards-planner:sync-preview:v1` to `"1"` and clears the hash (the same
way `takeSharedLink` clears a share link); `#nosync` removes it. Without the
key the sync row is not rendered, the GIS script is never loaded and no sync
code runs, so the live app behaves exactly as today. The OAuth client is the
production one, on the production origin. Removing the flag is a separate,
later PR.

### Data model: library version 2

`templates.js`, `TEMPLATES_VERSION` goes from 1 to 2:

```js
{
  version: 2,
  items: [
    { id, name, deadlineLabel, steps: [{ label, minutes }], updatedAt }
  ],
  tombstones: [ { id, deletedAt } ]
}
```

- `updatedAt` and `deletedAt` are epoch milliseconds from the device clock.
- **New storage key** `backwards-planner:templates:v2`. The old key
  `backwards-planner:templates:v1` becomes a read-only migration source and
  is never written again. Reason: the service worker is cache-first, so an
  old app version can still run after the new one has written; old code
  reads anything but version 1 as an empty library and would wipe it on its
  next save, and a v1 write would drop tombstones so deletes come back.
  With separate keys an old version (or a rolled-back deploy) sees the
  library as it was at migration time and cannot damage the new one.
- **Migration**: `loadTemplates` reads the v2 key; if it is absent, it reads
  the v1 key, and `normalizeLibrary` turns version 1 into version 2 with
  `updatedAt: 0` on every item and `tombstones: []`. Anything else (unknown
  version, garbage) keeps today's behaviour: an empty library.
- A malformed tombstone is dropped, like a malformed item.
- Tombstones are kept forever (an id and a number each). A tombstone is
  dropped only when an item with the same id has a newer `updatedAt`.

**Stamping happens in one place.** A pure function
`stampChanges(previous, next, now)` compares two libraries and returns `next`
with: `updatedAt = now` on every item that is new or whose name, deadline
label or steps differ from `previous`; a tombstone `{ id, deletedAt: now }`
for every id in `previous` and not in `next`; and the tombstone removed for an
id that is back. `commitLibrary` in `app.js` runs every change through it.
A merged library from a sync does **not** go through `stampChanges` (that
would re-date every remote item to now); the sync saves it as-is and does
not set `dirty`. Clash choices (a rename, a tombstone) are stamped.
This makes the existing local paths (save, update, rename, delete, import,
and their undo) correct without touching them: an undo of a delete is a new
edit that beats the tombstone, rather than an old item that a synced
tombstone would kill again.

**Undo and sync.** Every undo in `app.js` restores a whole library snapshot.
If a remote merge landed between the snapshot and the undo, the undo would
tombstone what arrived and spread that to every device. So **no remote merge
is applied while an undo is on offer** (the 6-second window): the cycle
waits, like it waits for the rename field and the import dialog. Changes
from a sync are themselves not undoable; the clash dialog is the
confirmation for the only choices a sync makes.

### Merge rules (pure, in `sync.js`)

`mergeLibraries(local, remote)` returns `{ library, clashes }`:

1. **Union of ids.** For an id on both sides, the item with the larger
   `updatedAt` wins; on a tie the copy whose content sorts first (stable
   JSON) wins. The winner must not depend on which side is "local", or two
   devices can make opposite choices.
2. **Tombstones.** Union by id, keeping the larger `deletedAt`. An item is
   dropped if a tombstone for its id has `deletedAt >= updatedAt`; otherwise
   the tombstone is dropped.
3. **Name clashes** (two different ids whose names compare equal under
   `findTemplateByName` rules), one local, one remote:
   - **Identical** (same deadline label and same steps): keep the smaller
     id, tombstone the other, silently. Deterministic on purpose: "keep the
     remote one" would let device A keep `b` and device B keep `a`, and once
     both writes merged, both tombstones would apply and the template would
     vanish everywhere. An In use marker on the dropped id moves to the kept
     one.
   - **Different**: reported in `clashes` as `{ local, remote }`; the merge
     result keeps both for now.
4. The merge is commutative on content and idempotent, so merging the same
   file twice changes nothing.

Same template edited on two devices between syncs: last edit wins, silently
(rule 1). This is the trade made for simplicity; the name-clash dialog covers
the case the user cares about (two *different* templates fighting for a
name).

**Clash dialog.** Reuses the import dialog (`ask()` in `app.js`):

- Title: "You have two templates called “Airport”."
- Body: "This device: 4 steps · 1 h 35 min" / "Other device: 5 steps · 2 h".
- Buttons: **Keep both** (primary) and **Replace with other device's**, plus a
  "Do the same for the N others" checkbox when there are more clashes.
- *Keep both*: the other device's template is renamed with `uniqueName`
  ("Airport (2)"), which is an edit and syncs back to the other device.
- *Replace with other device's*: the local template is deleted (tombstone);
  if it was the In use template, the marker moves to the remote id.
- The dialog opens **only from a tap** (Turn on, Tap to sync, Sync now,
  Resolve), which is always on the Templates tab. An automatic sync that
  finds a clash writes nothing, sets the row to "Sync paused — name clash"
  and stops; automatic syncs stay paused until the user taps **Resolve**.
- Closing the dialog (Escape) also writes nothing and leaves the row Paused.

Changes that came from another device are applied without an undo prompt when
there was no clash; the row's "Synced 10:42" is the only signal. An In use
marker pointing at a template deleted elsewhere is cleared.

### Sync cycle (`drive.js` + `app.js`)

The Drive file: `templates.json` in `appDataFolder`, content is exactly the
version-2 library.

1. List `spaces=appDataFolder`, `q=name='templates.json'`, fields
   `id, version`. If there is more than one (two devices created it at once),
   download and merge all, keep the oldest, delete the others.
2. If none: merge local with an empty library and create the file.
3. Download the file. If its `version` field (library version) is newer than
   this app knows, stop and show "Drive has templates from a newer version of
   the app. Reload to update." Never overwrite it.
4. `mergeLibraries(local, remote)`; resolve clashes via the dialog.
5. Save the merged library locally (`saveTemplates`) and re-render.
6. If the merged library differs from the remote one, `PATCH` it up.
7. Race check: if the Drive `version` after the `PATCH` is more than one above
   the `version` read in step 1, another device wrote in between; run the
   cycle once more. Because merging is idempotent and every device keeps its
   full library locally, a write that still gets overwritten is repaired on
   that device's next sync. No server-side compare-and-swap is needed.

Only one cycle runs at a time; a request during a cycle sets a "run again"
flag.

**When it runs** (only while sync is on and a valid token exists):

- at app start (if the token from earlier in this page's life is still valid;
  after a reload there is none, so the row shows *Tap to sync*),
- 3 seconds after the last library change (debounced),
- on `visibilitychange` to visible, and on `online`,
- on "Sync now".

A remote merge is not applied while the rename field is open or the import
dialog is showing; the cycle waits for them to close.

### UI: the sync row

One line on the Templates tab, under the Export/Import row:

| State | Row shows | Tap does |
|---|---|---|
| Off | "Sync templates with Google Drive" · **Turn on** | consent popup, first sync |
| Syncing | "Syncing…" | — |
| Synced | "Synced 10:42 · name@gmail.com" · **⋯** | menu: Sync now, Turn off |
| Needs sign-in | "Tap to sync" (+ "· changes waiting" if local edits are unsynced) | renewal popup, sync |
| Offline | "Offline — changes sync when you're back" | — |
| Paused | "Sync paused — name clash" · **Resolve** | reruns the cycle |
| Newer data | "Drive has newer templates. Reload to update." | reload |
| Error | "Sync failed: <short reason>" · **Retry** | reruns the cycle |
| GIS unavailable | "Google sign-in could not load" (script blocked or offline at first use) | retry load |
| Home-screen iPhone | "Sync works in Safari, not in the home-screen app" (when `navigator.standalone === true`) | — |
| Sign-in failed | "Google sign-in didn't work in this browser. Use Export/Import instead." (popup failed to open or never returned) | retry |

The ⋯ menu uses the same pattern as the row menus from PR #3. Nothing on the
Planning tab changes.

### Local sync state

New localStorage key `backwards-planner:sync:v1`:
`{ enabled: boolean, email: string, lastSyncedAt: number, dirty: boolean }`.
`dirty` is set by every `commitLibrary` and cleared after a successful cycle;
it drives "changes waiting". Load and save follow `storage.js`'s existing
try/catch style.

### How it fits next to `sharing.js`

- Share links and file export never carry `updatedAt` or tombstones. The
  export file format stays **version 1** (`EXPORT_VERSION = 1` in
  `sharing.js`, decoupled from `TEMPLATES_VERSION`), so files and links work
  between old and new app versions. `parseExportFile` keeps reading version 1.
- Imported templates get fresh ids and `updatedAt = now` via `stampChanges`,
  so they sync like any other new template.
- `addImported` and `uniqueName` are reused by the clash dialog's Keep both.

### Files

| File | Change |
|---|---|
| `templates.js` | Version 2 shape, migration, tombstones, `stampChanges`. Pure. |
| `sync.js` (new) | `mergeLibraries`, clash detection, identical-template test. Pure, fully unit-tested. |
| `drive.js` (new) | GIS loading, token client, Drive REST calls, the sync cycle. Browser-only, not unit-tested; takes `fetch` as a parameter so the cycle can be tested with a fake. |
| `storage.js` | Sync state load/save. |
| `sharing.js` | `EXPORT_VERSION = 1`; strip `updatedAt` on export. |
| `app.js` | `commitLibrary` stamps and marks dirty; sync row rendering; clash dialog; triggers. |
| `index.html`, `styles.css` | Sync row markup and style. |
| `privacy.html` (new) | Short privacy note: templates go only to the user's own Drive app folder; nothing is sent elsewhere. Needed for the consent screen. |
| `sw.js` | Add `sync.js`, `drive.js`, `privacy.html` to `ASSETS`; bump `CACHE_NAME`. |
| `README.md` | Google Cloud setup, how sync behaves, the one-tap-per-session limitation. |

### Testing

- Unit (`node --test`): migration 1→2; `stampChanges` (new, edited,
  unchanged, deleted, restored); `mergeLibraries` (disjoint, same id both
  edited, delete vs older edit, delete vs newer edit, tombstone resurrection
  attempt, identical name clash, different name clash, idempotence,
  commutativity of content); export still writes version 1 without
  `updatedAt`; the sync cycle against a fake `fetch` (no file, one file, two
  files, newer version, 401, race re-run).
- Manual, on the real devices, with the real OAuth client: Android installed
  app, desktop Chrome, iPhone Safari tab — turn on, edit on A, sync on B,
  delete on B, sync on A, clash on first sync, offline edit then online,
  token expiry after an hour.

## Fallback: Dropbox

Not chosen; recorded in case Google proves impractical (for example the
Safari popup fails in testing). Dropbox's OAuth with PKCE works in a browser
with a full-page redirect, gives refresh tokens (`token_access_type=offline`)
without a client secret, supports CORS, and offers an App-folder permission.
That removes the per-session tap and works in the iPhone home-screen app. An
app stays in "development" up to 50 linked users; beyond that it needs
Dropbox production approval within two weeks. Only `drive.js` would be
replaced; `sync.js`, the data model and the UI are provider-neutral.

## Calls made by the designer (not discussed with the user)

- Scope `drive.appdata` (not `drive.file`), plus `openid email`.
- Token kept in memory only; no revocation on Turn off.
- Tombstones kept forever.
- Same template edited on two devices: last edit wins, silently.
- Deterministic tie-break: smaller id / first-sorting content.
- New storage key for version 2; v1 key left untouched.
- No remote merge while an undo, the rename field or the import dialog is open;
  sync results are not undoable.
- Automatic syncs never open the clash dialog; they pause until Resolve.
- Keep both renames the other device's copy, as Import numbers the incoming one.
- Export format stays version 1.
- A `privacy.html` page.

## Left to the builder

- Exact copy and styling of the sync row and dialog, within the states above.
- Debounce length and the exact token-expiry margin.
- Whether to revoke the token on Turn off.
- Internal structure of `drive.js`.

## Risks and unknowns

- iPhone Safari tab and Android installed-app popup behaviour are untested.
  They are tested on the live site behind the `#sync` flag. If the iPhone
  fails, it stays local-only (decided); if Android also fails, the Dropbox
  fallback comes back to the user as a new decision.
- Device clocks decide "last edit wins"; a badly wrong clock can make an old
  edit win. Accepted.
- Google may change GIS; the token model has no announced deprecation today.
- Without brand verification the consent screen shows
  "vandenwoody.github.io" rather than "Backwards Planner".
