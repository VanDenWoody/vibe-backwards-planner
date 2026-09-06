# Backwards Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable, offline, single-page Android PWA where you set a deadline, append steps backwards, and read off the time you have to leave.

**Architecture:** Plain ES modules served as static files, no build step and no dependencies. All domain logic lives in two pure, test-first modules — `schedule.js` (backwards time arithmetic) and `plan.js` (plan shape, validation, coercion). `storage.js` is a thin `localStorage` wrapper; `app.js` is DOM wiring only. Rendering is deliberately split into a structure-sync pass and a time-refresh pass so that editing an input never destroys focus.

**Tech Stack:** Vanilla JavaScript (ES modules), HTML, CSS. `node --test` (Node's built-in runner, no packages). Python 3 stdlib for one-off icon generation. GitHub Pages for hosting.

**Spec:** `docs/superpowers/specs/2026-09-06-backwards-planner-design.md`

## Global Constraints

- **Zero runtime dependencies.** No npm packages, no CDN links, no `npm install` needed to run or test.
- **No build step.** The files in the repo are byte-for-byte the files that get served.
- **Node 18+** required for `node --test`.
- **All in-app paths are relative** (`./app.js`, `./icons/icon-192.png`), never root-absolute (`/app.js`). The site must work from `https://<user>.github.io/vibe-backwards-planner/` as well as from a domain root.
- **No network calls at runtime.** No analytics, no fonts, no telemetry. Nothing leaves the phone.
- **Never open the app from `file://`.** ES module imports are blocked there. Local dev is always `python -m http.server 8000` then `http://localhost:8000`.
- **`localStorage` key:** `backwards-planner:v1`. **Plan version:** `1`.
- **Colours:** background `#111827`, surface/theme `#1f2937`, text `#f9fafb`, muted `#9ca3af`, accent `#818cf8`.
- **Step order invariant:** `steps[0]` is the step nearest the deadline. The list is never reversed anywhere — entry order, storage order and display order are identical.

## Deviations from the spec (deliberate, flagged for review)

1. **`package.json` added.** Node treats `.js` as CommonJS unless told otherwise, so `import` in the test files fails without `{"type": "module"}`. It declares no dependencies; `npm install` is never run. Browsers ignore it entirely.
2. **`plan.js` added**, splitting pure plan-shape logic out of `storage.js`. The spec listed `schedule.js` as the only tested file, but plan validation is the other place a real bug can hide, and it cannot be tested while entangled with `localStorage`. `storage.js` remains untested and stays trivial. `createStep()` in `plan.js` mints step ids (the spec assigned this to `app.js`; ids belong where steps are created, and `app.js` calls `createStep`).
3. **Layout ambiguity resolved.** The spec says the add-step form sits "below the list" but also draws LEAVE as the terminal row. Resolution: deadline → steps → LEAVE render as one continuous schedule block, and the add-step form sits below that block. This keeps the leave time as the visual terminus of the count-back.
4. **`minutes` is coerced in two places.** The spec says storage always holds valid numbers so `schedule.js` "never has to parse", but also lists blank/non-numeric minutes as a `schedule.js` test case. Both hold: `coerceMinutes()` normalises at the input boundary, *and* `computeSchedule()` defensively treats any non-finite or negative value as `0`, making it a total function.

---

### Task 1: Project scaffolding and the pure schedule core

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `schedule.js`
- Test: `schedule.test.js`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `computeSchedule({ deadline, steps }) -> { rows, leaveAt, leaveDayOffset }` from `./schedule.js`, where
  - `deadline` is a `datetime-local` string such as `"2026-09-12T15:00"`, or `""`/invalid,
  - `steps` is `Array<{ id: string, label: string, minutes: number }>`,
  - `rows` is `Array<{ id: string, label: string, minutes: number, startsAt: Date, dayOffset: number }>`,
  - `leaveAt` is a `Date`, or `null` when the deadline is unset or unparseable,
  - `dayOffset` / `leaveDayOffset` are integer calendar-day differences from the deadline's local date (`-1` = the previous day).

- [ ] **Step 1: Create `package.json`**

Node needs this to treat `.js` as ES modules. It declares no dependencies and is never installed.

```json
{
  "name": "backwards-planner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.DS_Store
Thumbs.db
*.log
```

- [ ] **Step 3: Create `README.md`**

```markdown
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
```

- [ ] **Step 4: Write the failing tests**

Create `schedule.test.js`. The `local()` helper makes every assertion timezone-independent: both the input string and the resulting `Date` are interpreted in the same local zone, so the tests pass in any `TZ`.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSchedule } from "./schedule.js";

function local(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
         `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function step(id, label, minutes) {
  return { id, label, minutes };
}

test("no steps: leave time equals the deadline", () => {
  const result = computeSchedule({ deadline: "2026-09-12T15:00", steps: [] });
  assert.deepEqual(result.rows, []);
  assert.equal(local(result.leaveAt), "2026-09-12T15:00");
  assert.equal(result.leaveDayOffset, 0);
});

test("one step starts its duration before the deadline", () => {
  const result = computeSchedule({
    deadline: "2026-09-12T15:00",
    steps: [step("a", "Passport control", 30)],
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, "a");
  assert.equal(result.rows[0].label, "Passport control");
  assert.equal(local(result.rows[0].startsAt), "2026-09-12T14:30");
  assert.equal(local(result.leaveAt), "2026-09-12T14:30");
});

test("several steps accumulate backwards in order", () => {
  const result = computeSchedule({
    deadline: "2026-09-12T15:00",
    steps: [
      step("a", "Passport control", 30),
      step("b", "Security", 30),
      step("c", "Train ride", 45),
      step("d", "Walk to station", 10),
    ],
  });
  assert.deepEqual(result.rows.map((r) => local(r.startsAt)), [
    "2026-09-12T14:30",
    "2026-09-12T14:00",
    "2026-09-12T13:15",
    "2026-09-12T13:05",
  ]);
  assert.equal(local(result.leaveAt), "2026-09-12T13:05");
  assert.equal(result.leaveDayOffset, 0);
});

test("a plan crossing midnight lands on the previous day", () => {
  const result = computeSchedule({
    deadline: "2026-09-12T01:30",
    steps: [step("a", "Check in", 60), step("b", "Drive", 90)],
  });
  assert.equal(local(result.rows[0].startsAt), "2026-09-12T00:30");
  assert.equal(result.rows[0].dayOffset, 0);
  assert.equal(local(result.rows[1].startsAt), "2026-09-11T23:00");
  assert.equal(result.rows[1].dayOffset, -1);
  assert.equal(local(result.leaveAt), "2026-09-11T23:00");
  assert.equal(result.leaveDayOffset, -1);
});

test("zero, blank, non-numeric and negative minutes all count as zero", () => {
  const result = computeSchedule({
    deadline: "2026-09-12T15:00",
    steps: [
      step("a", "Zero", 0),
      step("b", "Blank", ""),
      step("c", "Garbage", "abc"),
      step("d", "Negative", -30),
      step("e", "Missing", undefined),
    ],
  });
  assert.deepEqual(result.rows.map((r) => r.minutes), [0, 0, 0, 0, 0]);
  assert.equal(local(result.leaveAt), "2026-09-12T15:00");
});

test("an unset or unparseable deadline yields no schedule", () => {
  for (const deadline of ["", "not a date", null, undefined]) {
    const result = computeSchedule({ deadline, steps: [step("a", "Security", 30)] });
    assert.deepEqual(result.rows, [], `deadline: ${String(deadline)}`);
    assert.equal(result.leaveAt, null, `deadline: ${String(deadline)}`);
    assert.equal(result.leaveDayOffset, 0);
  }
});

test("a missing or non-array steps list is tolerated", () => {
  const result = computeSchedule({ deadline: "2026-09-12T15:00" });
  assert.deepEqual(result.rows, []);
  assert.equal(local(result.leaveAt), "2026-09-12T15:00");
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` / `Cannot find module` for `./schedule.js`.

- [ ] **Step 6: Write the minimal implementation**

Create `schedule.js`.

Two notes on the arithmetic. Subtraction happens on epoch milliseconds, so a duration is a real elapsed duration even across a DST transition — a 45-minute train ride takes 45 actual minutes. `dayNumber()` applies `Date.UTC` to the *local* calendar components, which yields a DST-immune integer day index, so calendar-day comparison never drifts.

```js
const MS_PER_MINUTE = 60000;
const MS_PER_DAY = 86400000;

function parseDeadline(value) {
  if (typeof value !== "string" || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toMinutes(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function dayNumber(date) {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY
  );
}

export function computeSchedule({ deadline, steps }) {
  const deadlineDate = parseDeadline(deadline);
  if (deadlineDate === null) {
    return { rows: [], leaveAt: null, leaveDayOffset: 0 };
  }

  const list = Array.isArray(steps) ? steps : [];
  const baseDay = dayNumber(deadlineDate);
  let cursor = deadlineDate.getTime();

  const rows = list.map((step) => {
    const minutes = toMinutes(step.minutes);
    cursor -= minutes * MS_PER_MINUTE;
    const startsAt = new Date(cursor);
    return {
      id: step.id,
      label: step.label,
      minutes,
      startsAt,
      dayOffset: dayNumber(startsAt) - baseDay,
    };
  });

  const leaveAt = new Date(cursor);
  return { rows, leaveAt, leaveDayOffset: dayNumber(leaveAt) - baseDay };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 8: Commit**

```bash
git add package.json .gitignore README.md schedule.js schedule.test.js
git commit -m "feat: add pure backwards-schedule core with tests"
```

---

### Task 2: The plan module

**Files:**
- Create: `plan.js`
- Test: `plan.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 at runtime; produces the step shape that `computeSchedule` consumes.
- Produces, from `./plan.js`:
  - `PLAN_VERSION: number` (= `1`)
  - `emptyPlan() -> { version: 1, deadline: "", deadlineLabel: "", steps: [] }`
  - `coerceMinutes(value: unknown) -> number` — a non-negative integer, `0` for anything unusable
  - `createStep(label: unknown, minutes: unknown) -> { id: string, label: string, minutes: number }`
  - `normalizePlan(raw: unknown) -> plan` — always a valid plan; anything malformed yields `emptyPlan()`

- [ ] **Step 1: Write the failing tests**

Create `plan.test.js`.

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_VERSION, emptyPlan, coerceMinutes, createStep, normalizePlan } from "./plan.js";

test("emptyPlan has the current version and no content", () => {
  assert.deepEqual(emptyPlan(), { version: PLAN_VERSION, deadline: "", deadlineLabel: "", steps: [] });
});

test("emptyPlan returns a fresh object each time", () => {
  const first = emptyPlan();
  first.steps.push({ id: "x", label: "x", minutes: 1 });
  assert.deepEqual(emptyPlan().steps, []);
});

test("coerceMinutes normalises anything to a non-negative number", () => {
  assert.equal(coerceMinutes("30"), 30);
  assert.equal(coerceMinutes(45), 45);
  assert.equal(coerceMinutes("0"), 0);
  assert.equal(coerceMinutes(""), 0);
  assert.equal(coerceMinutes("abc"), 0);
  assert.equal(coerceMinutes("-30"), 0);
  assert.equal(coerceMinutes(-30), 0);
  assert.equal(coerceMinutes(null), 0);
  assert.equal(coerceMinutes(undefined), 0);
  assert.equal(coerceMinutes(NaN), 0);
});

test("createStep coerces its inputs", () => {
  const created = createStep("  Security  ", "30");
  assert.equal(created.label, "  Security  ");
  assert.equal(created.minutes, 30);
  assert.equal(typeof created.id, "string");
  assert.ok(created.id.length > 0);
  assert.equal(createStep(null, "x").label, "");
});

test("createStep mints unique ids", () => {
  const ids = new Set();
  for (let i = 0; i < 500; i += 1) ids.add(createStep("Step", 1).id);
  assert.equal(ids.size, 500);
});

test("normalizePlan accepts a well-formed plan and drops unknown fields", () => {
  const result = normalizePlan({
    version: 1,
    deadline: "2026-09-12T15:00",
    deadlineLabel: "Flight departs",
    steps: [{ id: "a", label: "Security", minutes: 30, colour: "red" }],
    nonsense: true,
  });
  assert.deepEqual(result, {
    version: 1,
    deadline: "2026-09-12T15:00",
    deadlineLabel: "Flight departs",
    steps: [{ id: "a", label: "Security", minutes: 30 }],
  });
});

test("normalizePlan defaults a missing deadlineLabel", () => {
  const result = normalizePlan({ version: 1, deadline: "2026-09-12T15:00", steps: [] });
  assert.equal(result.deadlineLabel, "");
});

test("normalizePlan discards anything malformed", () => {
  const rejects = [
    null,
    undefined,
    42,
    "a string",
    [],
    { version: 2, deadline: "", steps: [] },
    { version: 1, steps: [] },
    { version: 1, deadline: 15, steps: [] },
    { version: 1, deadline: "", steps: "nope" },
    { version: 1, deadline: "", steps: [null] },
    { version: 1, deadline: "", steps: [{ id: "", label: "x", minutes: 1 }] },
    { version: 1, deadline: "", steps: [{ id: "a", label: 5, minutes: 1 }] },
    { version: 1, deadline: "", steps: [{ id: "a", label: "x", minutes: "30" }] },
    { version: 1, deadline: "", steps: [{ id: "a", label: "x", minutes: -1 }] },
  ];
  for (const raw of rejects) {
    assert.deepEqual(normalizePlan(raw), emptyPlan(), `should reject: ${JSON.stringify(raw)}`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `./plan.js`. The Task 1 tests still pass.

- [ ] **Step 3: Write the minimal implementation**

Create `plan.js`. `createStep` uses a timestamp-plus-counter id rather than `crypto.randomUUID()` so it carries no secure-context requirement and stays trivially testable.

```js
export const PLAN_VERSION = 1;

let counter = 0;

function newId() {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}`;
}

export function emptyPlan() {
  return { version: PLAN_VERSION, deadline: "", deadlineLabel: "", steps: [] };
}

export function coerceMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function createStep(label, minutes) {
  return {
    id: newId(),
    label: typeof label === "string" ? label : "",
    minutes: coerceMinutes(minutes),
  };
}

export function normalizePlan(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return emptyPlan();
  if (raw.version !== PLAN_VERSION) return emptyPlan();
  if (typeof raw.deadline !== "string") return emptyPlan();
  if (!Array.isArray(raw.steps)) return emptyPlan();

  const steps = [];
  for (const step of raw.steps) {
    if (step === null || typeof step !== "object") return emptyPlan();
    if (typeof step.id !== "string" || step.id === "") return emptyPlan();
    if (typeof step.label !== "string") return emptyPlan();
    if (!Number.isFinite(step.minutes) || step.minutes < 0) return emptyPlan();
    steps.push({ id: step.id, label: step.label, minutes: step.minutes });
  }

  return {
    version: PLAN_VERSION,
    deadline: raw.deadline,
    deadlineLabel: typeof raw.deadlineLabel === "string" ? raw.deadlineLabel : "",
    steps,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 15 tests across both files, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plan.js plan.test.js
git commit -m "feat: add plan shape, validation and coercion with tests"
```

---

### Task 3: App shell — deadline, schedule rendering, persistence

Delivers a working page that loads a plan, renders the backwards schedule, and persists deadline edits. Adding and editing steps arrives in Task 4; this task is verified against a plan seeded by hand.

**Files:**
- Create: `storage.js`
- Create: `index.html`
- Create: `styles.css`
- Create: `app.js`

**Interfaces:**
- Consumes: `computeSchedule` from `./schedule.js`; `emptyPlan`, `normalizePlan` from `./plan.js`.
- Produces, from `./storage.js`: `STORAGE_KEY: string`, `loadPlan() -> plan` (always a valid plan, never throws), `savePlan(plan) -> void` (never throws).
- Produces, inside `app.js` for Task 4 to extend: `renderStructure()` (rebuilds the step rows from `state.steps`), `renderTimes()` (refreshes computed text only, never touching inputs), and the module-level `state` holding the current plan.

- [ ] **Step 1: Create `storage.js`**

A thin wrapper. All the logic worth testing already lives in `plan.js`.

```js
import { emptyPlan, normalizePlan } from "./plan.js";

export const STORAGE_KEY = "backwards-planner:v1";

export function loadPlan() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyPlan();
    return normalizePlan(JSON.parse(raw));
  } catch {
    return emptyPlan();
  }
}

export function savePlan(plan) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch {
    // Storage disabled or full. The in-memory plan keeps working.
  }
}
```

- [ ] **Step 2: Create `index.html`**

Order is deadline → steps → leave (one schedule block), then the add-step form below it.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Backwards Planner</title>
    <meta name="theme-color" content="#1f2937" />
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="app">
      <header class="deadline">
        <input
          id="deadline-label"
          class="deadline__label"
          type="text"
          placeholder="Flight departs"
          autocomplete="off"
          aria-label="Deadline name"
        />
        <input
          id="deadline-when"
          class="deadline__when"
          type="datetime-local"
          aria-label="Deadline date and time"
        />
      </header>

      <p id="empty-hint" class="hint" hidden>Set a deadline to see your schedule.</p>

      <ol id="steps" class="steps"></ol>

      <footer id="leave" class="leave" hidden>
        <span class="leave__caption">Leave</span>
        <strong id="leave-time" class="leave__time"></strong>
      </footer>

      <form id="add-step" class="add-step">
        <input
          id="new-label"
          class="add-step__label"
          type="text"
          placeholder="Step before that…"
          autocomplete="off"
          required
        />
        <input
          id="new-minutes"
          class="add-step__minutes"
          type="number"
          inputmode="numeric"
          min="0"
          step="1"
          placeholder="30"
          aria-label="Minutes"
        />
        <button class="add-step__submit" type="submit">Add</button>
      </form>
    </main>

    <script type="module" src="./app.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `styles.css`**

Mobile-first, dark, 44px minimum tap targets.

```css
:root {
  --bg: #111827;
  --surface: #1f2937;
  --text: #f9fafb;
  --muted: #9ca3af;
  --accent: #818cf8;
  --radius: 10px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-text-size-adjust: 100%;
}

.app {
  max-width: 34rem;
  margin: 0 auto;
  padding: 1rem 1rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

input,
button {
  font: inherit;
  color: inherit;
}

input {
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius);
  padding: 0.5rem;
  min-height: 44px;
}

input:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.deadline {
  background: var(--surface);
  border-radius: var(--radius);
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.deadline__label {
  font-size: 1.1rem;
  font-weight: 600;
}

.deadline__label::placeholder {
  color: var(--muted);
}

.deadline__when {
  color: var(--muted);
}

.hint {
  color: var(--muted);
  margin: 0.5rem 0.75rem;
}

.steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.step {
  display: grid;
  grid-template-columns: 4.5rem 1fr 3.5rem auto 44px;
  align-items: center;
  gap: 0.25rem;
  background: var(--surface);
  border-radius: var(--radius);
  padding-right: 0.25rem;
}

.step--zero {
  opacity: 0.45;
}

.step__time {
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  padding-left: 0.75rem;
  font-size: 0.95rem;
}

.step__minutes {
  text-align: right;
  font-variant-numeric: tabular-nums;
  padding-right: 0.25rem;
}

.step__unit {
  color: var(--muted);
  font-size: 0.85rem;
}

.step__delete {
  min-width: 44px;
  min-height: 44px;
  background: none;
  border: 0;
  color: var(--muted);
  font-size: 1.4rem;
  line-height: 1;
  border-radius: var(--radius);
}

.step__delete:active {
  background: rgba(255, 255, 255, 0.08);
}

.leave {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.25rem;
  padding: 0.9rem 0.75rem;
  border-top: 2px solid var(--accent);
}

.leave__caption {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.8rem;
  color: var(--muted);
}

.leave__time {
  font-size: 2rem;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}

.add-step {
  display: grid;
  grid-template-columns: 1fr 4.5rem auto;
  gap: 0.25rem;
  margin-top: 1rem;
}

.add-step__label,
.add-step__minutes {
  background: var(--surface);
}

.add-step__minutes {
  text-align: right;
}

.add-step__submit {
  min-height: 44px;
  padding: 0 1rem;
  border: 0;
  border-radius: var(--radius);
  background: var(--accent);
  color: #111827;
  font-weight: 600;
}

.add-step__submit:active {
  filter: brightness(0.9);
}
```

- [ ] **Step 4: Create `app.js`**

Rendering is split on purpose. `renderStructure()` rebuilds rows and is called only when the *set* of steps changes; `renderTimes()` rewrites computed text only and never touches an input's value, so typing in a field never loses focus or the caret. Task 4 depends on this split.

```js
import { computeSchedule } from "./schedule.js";
import { loadPlan, savePlan } from "./storage.js";

const deadlineLabelEl = document.querySelector("#deadline-label");
const deadlineWhenEl = document.querySelector("#deadline-when");
const emptyHintEl = document.querySelector("#empty-hint");
const stepsEl = document.querySelector("#steps");
const leaveEl = document.querySelector("#leave");
const leaveTimeEl = document.querySelector("#leave-time");

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

const state = loadPlan();

function formatAt(date, dayOffset) {
  if (date === null) return "";
  const time = timeFmt.format(date);
  return dayOffset === 0 ? time : `${time} (${dateFmt.format(date)})`;
}

function renderStructure() {
  stepsEl.replaceChildren();

  for (const step of state.steps) {
    const li = document.createElement("li");
    li.className = "step";
    li.dataset.id = step.id;

    const time = document.createElement("span");
    time.className = "step__time";

    const label = document.createElement("input");
    label.className = "step__label";
    label.type = "text";
    label.value = step.label;
    label.autocomplete = "off";
    label.setAttribute("aria-label", "Step name");

    const minutes = document.createElement("input");
    minutes.className = "step__minutes";
    minutes.type = "number";
    minutes.min = "0";
    minutes.step = "1";
    minutes.inputMode = "numeric";
    minutes.value = String(step.minutes);
    minutes.setAttribute("aria-label", "Minutes");

    const unit = document.createElement("span");
    unit.className = "step__unit";
    unit.textContent = "min";

    const remove = document.createElement("button");
    remove.className = "step__delete";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Delete step");

    li.append(time, label, minutes, unit, remove);
    stepsEl.append(li);
  }
}

function renderTimes() {
  const { rows, leaveAt, leaveDayOffset } = computeSchedule(state);
  const hasDeadline = leaveAt !== null;

  emptyHintEl.hidden = hasDeadline;
  leaveEl.hidden = !hasDeadline;

  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const li of stepsEl.children) {
    const row = byId.get(li.dataset.id);
    li.querySelector(".step__time").textContent =
      row && hasDeadline ? formatAt(row.startsAt, row.dayOffset) : "";
    li.classList.toggle("step--zero", row ? row.minutes === 0 : false);
  }

  if (hasDeadline) {
    leaveTimeEl.textContent = formatAt(leaveAt, leaveDayOffset);
  }
}

deadlineWhenEl.addEventListener("input", () => {
  state.deadline = deadlineWhenEl.value;
  savePlan(state);
  renderTimes();
});

deadlineLabelEl.addEventListener("input", () => {
  state.deadlineLabel = deadlineLabelEl.value;
  savePlan(state);
});

deadlineWhenEl.value = state.deadline;
deadlineLabelEl.value = state.deadlineLabel;
renderStructure();
renderTimes();
```

- [ ] **Step 5: Verify the app renders and persists**

Start the server:

```bash
python -m http.server 8000
```

Open `http://localhost:8000` and check, in order:

1. The page shows the deadline row, the hint "Set a deadline to see your schedule.", and no leave row.
2. In the DevTools Console, seed a plan and reload:

```js
localStorage.setItem("backwards-planner:v1", JSON.stringify({
  version: 1,
  deadline: "2026-09-12T15:00",
  deadlineLabel: "Flight departs",
  steps: [
    { id: "a", label: "Passport control", minutes: 30 },
    { id: "b", label: "Security", minutes: 30 },
    { id: "c", label: "Train ride", minutes: 45 },
    { id: "d", label: "Walk to station", minutes: 10 }
  ]
})); location.reload();
```

3. Four rows appear reading `14:30`, `14:00`, `13:15`, `13:05` top to bottom, and the leave row reads `13:05`.
4. Change the deadline to `01:30` on the same date — the earliest rows gain a `(11 Sep)`-style date suffix.
5. Reload — the deadline you set is still there.
6. Run `localStorage.setItem("backwards-planner:v1", "{{{garbage")` and reload: the app opens empty rather than breaking.

- [ ] **Step 6: Commit**

```bash
git add storage.js index.html styles.css app.js
git commit -m "feat: render the backwards schedule and persist the plan"
```

---

### Task 4: Add, edit and delete steps

**Files:**
- Modify: `app.js` (extend the imports and the element lookups, then insert handlers before the initialisation lines at the end of the file)

**Interfaces:**
- Consumes: `renderStructure()`, `renderTimes()`, `state`, `stepsEl` from Task 3; `coerceMinutes`, `createStep` from `./plan.js`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Import the plan helpers**

Extend the existing import block so the top of `app.js` reads:

```js
import { computeSchedule } from "./schedule.js";
import { coerceMinutes, createStep } from "./plan.js";
import { loadPlan, savePlan } from "./storage.js";
```

- [ ] **Step 2: Add the element lookups**

Append to the `document.querySelector` block near the top of `app.js`:

```js
const addStepEl = document.querySelector("#add-step");
const newLabelEl = document.querySelector("#new-label");
const newMinutesEl = document.querySelector("#new-minutes");
```

- [ ] **Step 3: Wire editing, deleting and adding**

Insert these three handlers immediately after the existing `deadlineLabelEl` handler and before the initialisation lines at the end of the file. Both list handlers are delegated to `#steps`, so they keep working across every rebuild. Editing calls only `renderTimes()`, which never rewrites an input value — that is what keeps the caret in place while typing.

```js
stepsEl.addEventListener("input", (event) => {
  const li = event.target.closest("li.step");
  if (li === null) return;

  const step = state.steps.find((candidate) => candidate.id === li.dataset.id);
  if (step === undefined) return;

  if (event.target.classList.contains("step__label")) {
    step.label = event.target.value;
  } else if (event.target.classList.contains("step__minutes")) {
    step.minutes = coerceMinutes(event.target.value);
  } else {
    return;
  }

  savePlan(state);
  renderTimes();
});

stepsEl.addEventListener("click", (event) => {
  const button = event.target.closest("button.step__delete");
  if (button === null) return;

  const li = button.closest("li.step");
  state.steps = state.steps.filter((step) => step.id !== li.dataset.id);
  savePlan(state);
  renderStructure();
  renderTimes();
});

addStepEl.addEventListener("submit", (event) => {
  event.preventDefault();

  const label = newLabelEl.value.trim();
  if (label === "") return;

  state.steps.push(createStep(label, newMinutesEl.value));
  savePlan(state);
  renderStructure();
  renderTimes();

  addStepEl.reset();
  newLabelEl.focus();
});
```

- [ ] **Step 4: Verify the full interaction loop**

With `python -m http.server 8000` running, clear storage first (`localStorage.clear()` in the Console, then reload), then:

1. Set the deadline to today at `15:00` and type `Flight departs` as its name.
2. Add `Passport control` / `30`. It appears reading `14:30`, and the leave row reads `14:30`.
3. Add `Security` / `30`, then `Train ride` / `45`, then `Walk to station` / `10`. The list reads `14:30`, `14:00`, `13:15`, `13:05`; leave reads `13:05`.
4. Change `Security` from `30` to `45`. Every time above and below updates immediately **and the caret stays in the field** — this is the regression that matters. Type several digits in a row and confirm focus never jumps.
5. Clear the minutes field entirely: that row greys out and counts as 0.
6. Add a step leaving the minutes box empty — it is added with 0 minutes.
7. Submit with an empty label — nothing is added.
8. Delete the middle step; the remaining times recompute.
9. Reload — every edit survived.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: add, edit in place and delete steps"
```

---

### Task 5: Make it an installable, offline PWA

**Files:**
- Create: `tools/make-icons.py`
- Create: `icons/icon-192.png` (generated)
- Create: `icons/icon-512.png` (generated)
- Create: `manifest.json`
- Create: `sw.js`
- Modify: `index.html` (add the manifest link)
- Modify: `app.js` (register the service worker)

**Interfaces:**
- Consumes: every file created so far, listed by relative path in the service worker's asset list.
- Produces: nothing consumed by later code.

- [ ] **Step 1: Create `tools/make-icons.py`**

Python stdlib only — no Pillow, no npm. It writes 8-bit truecolour PNGs directly: a dark ground with three white bars of decreasing width, kept inside the central 80% so Android's maskable crop cannot clip them.

```python
"""Generate the app icons. Run: python tools/make-icons.py"""

import os
import struct
import zlib

BACKGROUND = (31, 41, 55)  # #1f2937
FOREGROUND = (249, 250, 251)  # #f9fafb

# (x0, y0, x1, y1) as fractions of the canvas, inside the maskable safe zone.
BARS = [
    (0.22, 0.28, 0.78, 0.38),
    (0.22, 0.45, 0.62, 0.55),
    (0.22, 0.62, 0.46, 0.72),
]


def chunk(tag, data):
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def write_icon(path, size):
    rects = [
        (int(x0 * size), int(y0 * size), int(x1 * size), int(y1 * size))
        for x0, y0, x1, y1 in BARS
    ]

    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter type: none
        for x in range(size):
            colour = BACKGROUND
            for x0, y0, x1, y1 in rects:
                if x0 <= x < x1 and y0 <= y < y1:
                    colour = FOREGROUND
                    break
            raw.extend(colour)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        handle.write(chunk(b"IHDR", header))
        handle.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        handle.write(chunk(b"IEND", b""))
    print(f"wrote {path} ({size}x{size})")


if __name__ == "__main__":
    os.makedirs("icons", exist_ok=True)
    write_icon(os.path.join("icons", "icon-192.png"), 192)
    write_icon(os.path.join("icons", "icon-512.png"), 512)
```

- [ ] **Step 2: Generate the icons**

Run: `python tools/make-icons.py`
Expected: `icons/icon-192.png` and `icons/icon-512.png` exist. Open both — a dark square with three white bars. If either file fails to open as an image, stop and fix the encoder before continuing.

- [ ] **Step 3: Create `manifest.json`**

Every path is relative so the app installs correctly from a GitHub Pages project subpath.

```json
{
  "name": "Backwards Planner",
  "short_name": "Backwards",
  "description": "Set a deadline, plan backwards, know when to leave.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#111827",
  "theme_color": "#1f2937",
  "icons": [
    { "src": "./icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "./icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 4: Link the manifest from `index.html`**

Add immediately after the existing `<meta name="theme-color" …>` line:

```html
    <link rel="manifest" href="./manifest.json" />
```

- [ ] **Step 5: Create `sw.js`**

Cache-first over a fixed list. Bump `CACHE_NAME` to ship an update. Test files and `tools/` are deliberately not cached.

```js
const CACHE_NAME = "backwards-planner-v1";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./schedule.js",
  "./plan.js",
  "./storage.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
```

- [ ] **Step 6: Register the service worker in `app.js`**

Append at the very end of `app.js`, after the initialisation lines. The `catch` matters: registration fails on insecure origins and must never take the app down with it.

```js
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Not a secure context, or the browser refused. The app works regardless.
    });
  });
}
```

- [ ] **Step 7: Verify installability and offline operation**

With `python -m http.server 8000` running, open `http://localhost:8000` in Chrome:

1. DevTools → Application → Manifest: name, icons and theme colour all resolve with no errors listed.
2. DevTools → Application → Service Workers: `sw.js` shows as **activated and running**.
3. DevTools → Application → Cache Storage → `backwards-planner-v1`: all ten assets listed.
4. Tick DevTools → Network → **Offline**, then hard-reload. The app still loads and the plan is still there.
5. Untick Offline.

- [ ] **Step 8: Commit**

```bash
git add tools/make-icons.py icons/icon-192.png icons/icon-512.png manifest.json sw.js index.html app.js
git commit -m "feat: make the planner an installable offline PWA"
```

---

### Task 6: Publish to GitHub Pages and verify on the phone

**Files:**
- Modify: `README.md` (add the live URL and a deployment note)

**Interfaces:**
- Consumes: the complete app from Tasks 1–5.
- Produces: a live URL.

> **Confirm before running this task.** It publishes the repository publicly. Check with the user that the repository name and public visibility are what they want before creating or pushing anything.

- [ ] **Step 1: Confirm the repository details with the user**

Ask for the repository name (default: `vibe-backwards-planner`) and confirm public visibility. Do not proceed without an explicit yes.

- [ ] **Step 2: Verify the working tree is clean and the tests pass**

```bash
npm test && git status --short
```

Expected: all tests pass, no uncommitted changes.

- [ ] **Step 3: Create the public repository and push**

```bash
gh repo create vibe-backwards-planner --public --source=. --remote=origin --push
```

If `gh` is unavailable or unauthenticated, create the repository through the GitHub web UI instead, then:

```bash
git remote add origin https://github.com/<user>/vibe-backwards-planner.git
git branch -M main
git push -u origin main
```

- [ ] **Step 4: Enable Pages**

```bash
gh api -X POST repos/<user>/vibe-backwards-planner/pages -f "source[branch]=main" -f "source[path]=/"
```

Or via the web UI: Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)` → Save.

Wait for the first deployment, then confirm the site is live:

```bash
curl -sI https://<user>.github.io/vibe-backwards-planner/ | head -1
```

Expected: `HTTP/2 200`.

- [ ] **Step 5: Update `README.md`**

Add after the opening description:

```markdown
**Live:** <https://<user>.github.io/vibe-backwards-planner/>

## Deploy

Pushing to `main` publishes. There is no build step — GitHub Pages serves the
repository root as-is. After changing any cached file, bump `CACHE_NAME` in
`sw.js` so installed copies pick up the update.
```

- [ ] **Step 6: Verify on the Android phone**

1. Open the live URL in Chrome on the phone.
2. Menu → **Add to Home screen**. The icon appears on the home screen.
3. Launch from the icon: it opens standalone, with no browser address bar.
4. Build a real plan — a flight time and four or five steps.
5. Switch the phone to **airplane mode** and relaunch from the icon. The app opens and the plan is intact.
6. Confirm the leave time is legible at arm's length and the delete buttons are comfortably tappable.

- [ ] **Step 7: Commit and push**

```bash
git add README.md
git commit -m "docs: add live URL and deployment notes"
git push
```

---

## Definition of done

- `npm test` passes with no dependencies installed.
- The app runs from `http://localhost:8000` with no console errors.
- Editing a step's minutes updates every time in the list without losing input focus.
- The plan survives a reload; corrupt storage opens an empty plan instead of breaking.
- The app installs to the Android home screen and works in airplane mode.
- Every path in the shipped files is relative, and the app works from the GitHub Pages project subpath.
