# Backwards Planner

Set a deadline. Append the steps that have to happen before it. Read off when to
leave. Save a routine you repeat as a template.

Meeting someone? Give their steps negative minutes. A plane lands at 11:00,
"Deplane −10" and "Passport queue −25" run forward to a meet time of 11:35, and
your own steps count back from there. Negative steps stay at the top of the
list, tinted, with the meet time under the last one.

A single-page PWA with no build step and no dependencies. Install it to an Android
home screen and it works offline.

**Live:** <https://vandenwoody.github.io/vibe-backwards-planner/>

On Android, open that URL in Chrome and choose **Add to Home screen**.

## Run locally

    python -m http.server 8000

Then open <http://localhost:8000>. Do **not** open `index.html` from the filesystem —
ES module imports and service workers both require a real origin.

## Test

    npm test

Runs `node --test` over the pure modules. No `npm install` required.

## Sync

Templates can sync between one person's devices through their own Google Drive.
Sync is off until you turn it on in the sync row on the Templates tab:

- While sync is off the app makes no contact with Google. **Turn on** fetches
  Google's sign-in script, then **Continue with Google** opens Google's sign-in
  window: a browser only lets a popup open directly inside a tap, so the
  script has to be there before that tap. Once sync is on, the script loads
  each time the app starts.
- **Turn on** asks Google for access to the app's own hidden Drive folder
  (`drive.appdata`) and your email address. Nothing else in your Drive is
  visible to the app.
- Changes sync about 3 seconds after you make them, when the app comes back to
  the foreground, when the connection returns, and on **Sync now**.
- Google gives a browser app a token for about an hour and no way to renew it
  without a tap. After that, the row shows **Tap to sync**; one tap renews it.
  Local changes wait meanwhile and are never lost.
- Two different templates with the same name are asked about (Keep both /
  Replace with other device's); identical ones are merged silently.
- The iPhone home-screen app is not supported (Google's popup cannot return to
  it); use the app in a Safari tab, or Export/Import.

The library is stored as version 2 (`updatedAt` per template, tombstones for
deletes) under its own key, `backwards-planner:templates:v2`. The v1 key is read
once for migration and never written, so an older cached app version keeps its
own copy and cannot damage the new one. Export files and share links stay
version 1. `sync.js` holds the merge rules, `drive.js` the Google side.

### Google Cloud setup

Done once, by the owner of the site. The client id is public and lives in
`drive.js` as `GOOGLE_CLIENT_ID`.

1. Create a Google Cloud project and enable the **Google Drive API**.
2. Google Auth Platform → Branding: app name, support email, home page
   `https://vandenwoody.github.io/vibe-backwards-planner/`, privacy policy
   `https://vandenwoody.github.io/vibe-backwards-planner/privacy.html`,
   authorized domain `vandenwoody.github.io`.
3. Data access: scopes `https://www.googleapis.com/auth/drive.appdata`,
   `openid`, `email` (all non-sensitive, so no verification is required).
4. Audience: External, then **Publish app** (In production). Testing mode would
   cap users at 100 and expire every grant after seven days.
5. Clients: an OAuth client of type *Web application* with authorized
   JavaScript origins `https://vandenwoody.github.io`, `http://localhost:8000`
   and `http://localhost:8010`. No redirect URIs: sign-in uses a popup.

## Deploy

Pushing to `main` publishes. There is no build step — GitHub Pages serves the
repository root as-is. After changing any cached file, bump `CACHE_NAME` in
`sw.js` so installed copies pick up the update.

## Design notes

`schedule.js` and `plan.js` are pure and carry all the domain knowledge; they are
the parts worth keeping in a future rewrite. `app.js` is DOM wiring only.

Rendering is split deliberately: `renderStructure()` rebuilds the step rows and
runs only when a step is added or deleted, while `renderTimes()` refreshes
computed text and never writes to an input's `value`. Editing a duration
therefore recomputes the whole schedule without destroying the caret.

The deadline time is drawn by the app rather than by its picker. A
`datetime-local` control prints its value in the browser's locale, which would
put a 12-hour string at the head of a 24-hour column, so the real control sits
over the drawn time at zero opacity, so the row still opens the native picker
while the column stays canonical. Being invisible, the control has no visible
calendar icon and can show no caret, which on desktop would leave a click
selecting a segment you cannot see, so the click handler asks for the picker
explicitly. That control listens for `change` rather than `input`, because a
half-typed date reads as an empty value and would blank the header between
keystrokes.

Deleting applies immediately and parks the removed step in memory for six
seconds, so Undo can splice it back at the index it came from. Clearing every
step takes the same path, which is why it needs no confirmation dialog. A
pending undo is never persisted: reloading inside the window is a real delete.

Steps are reordered in a Reorder mode rather than by dragging: native drag and
drop does not work on Android, and plans are short enough that one place per tap
is quick. The mode swaps each row's minutes and delete for full-size up and down
arrows, so the row never has to fit five controls on a phone. The arrows are
always in the DOM and shown only by a class, so entering the mode drops no
focus. A move is not undoable, since the other arrow takes it back, and the mode
is not persisted: it ends on leaving the tab, on reload, or when fewer than two
steps remain.

Templates live in their own store beside the plan, so the plan's shape and version
never had to move. A template is a recipe rather than a plan: a name, the
deadline's caption and the step list, but no date or time, since that is exactly
what changes each time you use it. Its steps carry no ids — loading mints fresh
ones through `createStep`, so the same template can be loaded twice without two
rows ever sharing an identity. Where `normalizePlan` throws out a whole malformed
plan, `normalizeLibrary` drops only the items that are malformed: templates are
independent of each other, and losing the library to one bad entry would be the
wrong trade.

The app is two tabs. Planning is the schedule and nothing else; Templates is
where the library is managed, so template chrome never sits between the deadline
and the steps. The tab bar stays put even when both tabs are nearly empty, since
chrome that appears and disappears is more disorienting than an empty row. Which
tab you were on is deliberately not persisted: reopening the app into a
management screen would be a strange place to land.

Every row carries its own Load, Update, Rename and delete, and Update overwrites
that row with whatever is in the planner now. `activeId` survives as the In use
marker, which is what it always was — it says where the current plan came from.
A name already in use is refused inline, the way an unnamed step is, and
renaming a template to the name it already has closes the field quietly rather
than announcing a rename that did not happen. Loading, saving, updating,
renaming and deleting are all undoable, which is why `pending` holds a closure
that puts the previous state back rather than a list of removed steps: what
needs restoring differs between a step and a template.

The spec and implementation plan live in `docs/superpowers/`. They record the
original design and are not updated as the app moves on.
