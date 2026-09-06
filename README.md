# Backwards Planner

Set a deadline. Append the steps that have to happen before it. Read off when to leave.

A single-page PWA with no build step and no dependencies. Install it to an Android
home screen and it works offline.

## Run locally

    python -m http.server 8000

Then open <http://localhost:8000>. Do **not** open `index.html` from the filesystem —
ES module imports and service workers both require a real origin.

## Test

    npm test

Runs `node --test` over the pure modules. No `npm install` required.
