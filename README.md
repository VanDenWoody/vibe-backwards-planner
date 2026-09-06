# Backwards Planner

Set a deadline. Append the steps that have to happen before it. Read off when to leave.

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

The spec and implementation plan live in `docs/superpowers/`.
