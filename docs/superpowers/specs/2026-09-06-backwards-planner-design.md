# Backwards Planner — Design

Date: 2026-09-06
Status: Approved, ready for implementation planning

## Purpose

Answer one question: **when do I have to leave?**

You set a deadline (a flight at 15:00 on a given date), then append the steps
that have to happen before it — passport control, security, the train ride, the
walk to the station. The app counts backwards and shows the clock time at which
each step must begin, ending in a departure time.

Personal hobby project. A prototype, intended to be rebuilt more seriously
later; the design protects that path by isolating the domain logic.

## Scope

In scope:

- One plan: a deadline plus an ordered list of steps.
- Steps are a label and a duration in minutes.
- Edit any step's label or minutes in place; delete any step.
- The plan persists between openings.
- Installable on Android, works offline.

Explicitly out of scope for the prototype:

- Fixed-time anchors (a step pinned to "the 12:47 train"). Every step is a
  duration; the user reconciles real timetables themselves.
- Multiple or named plans, templates, reusable routines.
- Reordering steps. Wrong order means delete and re-add.
- Countdown to the leave time, notifications, alarms.
- Any network call, account, or sync. Nothing leaves the phone.

## Delivery

An installable PWA served as static files from GitHub Pages on a public
repository, added to the Android home screen and run offline thereafter.

Plain ES modules, no build step and no dependencies: the files in the repo are
the files that are served. Consequences:

- All paths in the app are **relative**, so the site works from a project
  subpath (`/vibe-backwards-planner/`) as well as a domain root.
- The app cannot be opened from `file://` — ES module imports are blocked by
  origin rules there. Local development uses `python -m http.server 8000` and
  `http://localhost:8000`. This costs nothing extra, since service workers
  already require `https://` or `localhost`.

## Data model

A single plan object in `localStorage` under the key `backwards-planner:v1`:

```js
{
  version: 1,
  deadline: "2026-09-12T15:00",     // datetime-local input value
  deadlineLabel: "Flight departs",
  steps: [
    { id: "s1", label: "Passport control", minutes: 30 },
    { id: "s2", label: "Security",         minutes: 30 }
  ]
}
```

`minutes` is stored as a **number**. The input field's raw string is coerced on
change: a blank or non-numeric entry is stored as `0`, so anything read back
from storage is always a valid number and `schedule.js` never has to parse.

`steps[0]` is the step **nearest the deadline** — the last thing done before it.
Appending a step pushes further back in time. Entry order, storage order and
display order are the same direction, so the list is never reversed anywhere in
the system.

The deadline is a date **and** time. This makes plans that cross midnight fall
out of ordinary date arithmetic rather than needing a special case.

## The pure core

`schedule.js` exports one function:

```js
computeSchedule({ deadline, steps }) -> { rows, leaveAt }
```

Algorithm — walk backwards from the deadline:

```
t = deadline
for each step in steps (in order):
    start = t - step.minutes
    emit row { id, label, minutes, startsAt: start }
    t = start
leaveAt = t
```

Each row's `startsAt` is the clock time at which that step must **begin**.
`leaveAt` is where the walk ends: the departure time.

This module has no DOM access, no storage access and no reference to the current
time. The same input always produces the same output. It is the only file that
carries domain knowledge, the only file with tests, and the piece that
transplants unchanged into a future rewrite.

## Rendering

Backwards, deadline on top, matching the direction the plan was built. The
sketch below shows layout and ordering; the marker glyphs are illustrative, not
specified:

```
15:00   *  Flight departs
14:30      Passport control      30 min  x
14:00      Security              30 min  x
13:15      Train ride            45 min  x
13:05      Walk to station       10 min  x
------------------------------------------
13:05   -> LEAVE
```

- The deadline row carries two controls: the datetime picker and a free-text
  field for `deadlineLabel`, both editable in place like everything else.
- Every step row shows the time that step starts.
- Label and minutes are live input fields; editing recomputes the whole
  schedule immediately. Editing is saving — there is no save button.
- Each row has a delete control.
- The add-step form sits below the list, where the list grows.
- The leave time is an emphasised terminal row rather than a pinned header. It
  necessarily equals the earliest step's start time; the duplication is
  deliberate, so the number the user actually wants is unmissable.
- Any computed time falling on a different calendar day from the deadline also
  shows its date.

Mobile-first: large tap targets, `inputmode="numeric"` on the minutes fields.

## Error handling

| Condition | Behaviour |
|---|---|
| Minutes blank or non-numeric | Treated as 0; row renders greyed. Never blocks mid-typing. |
| Negative minutes | Prevented at the input (`min="0"`). |
| No deadline set | No schedule rendered; a prompt to set one. |
| No steps | `leaveAt` equals the deadline. |
| `localStorage` absent, unreadable or corrupt | Fall back to an empty plan. Never throw. |
| Stored `version` unrecognised | Discard and start empty. |

## Files

```
index.html
styles.css
app.js               DOM wiring only: read inputs, call schedule.js, render,
                     persist, mint step ids
schedule.js          pure domain logic
storage.js           load/save the plan, tolerate corrupt or absent data
sw.js                service worker
manifest.json        PWA manifest
icons/               icon-192.png, icon-512.png
schedule.test.js     node --test
```

The service worker is cache-first over a hardcoded list of the app's files, with
a `CACHE_NAME` constant bumped to invalidate. Old caches are deleted on
activate. It is deliberately not a caching framework.

## Testing

`node --test schedule.test.js` — zero dependencies, no `npm install`. The pure
core is developed test-first. Cases:

- No steps: `leaveAt` equals the deadline, no rows.
- One step.
- Several steps: times accumulate correctly backwards.
- A plan crossing midnight: the leave time lands on the previous date.
- Zero, blank and non-numeric minutes.
- Deadline unset.

The DOM wiring is verified by running the app on the phone, not by tests.

## Deployment

Public GitHub repository, Pages serving from the default branch. Free on a
personal account for public repositories. Because the deployed site is publicly
readable on any static host, a public repository costs no real privacy here —
no secrets and no personal data are involved, and nothing leaves the phone at
runtime.
