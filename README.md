# Backwards Planner

Set a deadline. Append the steps that have to happen before it. Read off when to
leave. Save a routine you repeat as a template.

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

Templates live in their own store beside the plan, so the plan's shape and version
never had to move. A template is a recipe rather than a plan: a name, the
deadline's caption and the step list, but no date or time, since that is exactly
what changes each time you use it. Its steps carry no ids — loading mints fresh
ones through `createStep`, so the same template can be loaded twice without two
rows ever sharing an identity. Where `normalizePlan` throws out a whole malformed
plan, `normalizeLibrary` drops only the items that are malformed: templates are
independent of each other, and losing the library to one bad entry would be the
wrong trade.

Which template Update writes to is remembered, and persisted, so overwriting
stays one tap after a reload instead of retyping the name. A name already in use
is refused inline, the way an unnamed step is, since overwriting is what Update
is for. Loading, saving, updating and deleting are all undoable, which is why
`pending` holds a closure that puts the previous state back rather than a list of
removed steps: what needs restoring differs between a step and a template.

The spec and implementation plan live in `docs/superpowers/`. They record the
original design and are not updated as the app moves on.
