import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_VERSION, emptyPlan, coerceMinutes, createStep, insertStep, moveStep, normalizePlan } from "./plan.js";

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

test("insertStep puts the step at the index", () => {
  const steps = ["a", "b"].map((id) => ({ id, label: id, minutes: 1 }));
  const step = { id: "n", label: "n", minutes: 1 };
  assert.deepEqual(insertStep(steps, 0, step).map((s) => s.id), ["n", "a", "b"]);
  assert.deepEqual(insertStep(steps, 1, step).map((s) => s.id), ["a", "n", "b"]);
  assert.deepEqual(insertStep(steps, 2, step).map((s) => s.id), ["a", "b", "n"]);
});

test("insertStep clamps an index past either end", () => {
  const steps = ["a", "b"].map((id) => ({ id, label: id, minutes: 1 }));
  const step = { id: "n", label: "n", minutes: 1 };
  assert.deepEqual(insertStep(steps, -3, step).map((s) => s.id), ["n", "a", "b"]);
  assert.deepEqual(insertStep(steps, 9, step).map((s) => s.id), ["a", "b", "n"]);
  assert.deepEqual(insertStep([], 0, step).map((s) => s.id), ["n"]);
});

test("insertStep returns a new array and keeps the step objects", () => {
  const steps = ["a", "b"].map((id) => ({ id, label: id, minutes: 1 }));
  const step = { id: "n", label: "n", minutes: 1 };
  const inserted = insertStep(steps, 1, step);
  assert.notEqual(inserted, steps);
  assert.deepEqual(steps.map((s) => s.id), ["a", "b"]);
  assert.equal(inserted[0], steps[0]);
  assert.equal(inserted[1], step);
});

test("moveStep swaps a step with its neighbour", () => {
  const steps = ["a", "b", "c"].map((id) => ({ id, label: id, minutes: 1 }));
  assert.deepEqual(moveStep(steps, 1, -1).map((s) => s.id), ["b", "a", "c"]);
  assert.deepEqual(moveStep(steps, 1, 1).map((s) => s.id), ["a", "c", "b"]);
});

test("moveStep leaves the order alone past either end", () => {
  const steps = ["a", "b"].map((id) => ({ id, label: id, minutes: 1 }));
  assert.deepEqual(moveStep(steps, 0, -1).map((s) => s.id), ["a", "b"]);
  assert.deepEqual(moveStep(steps, 1, 1).map((s) => s.id), ["a", "b"]);
  assert.deepEqual(moveStep(steps, 5, -1).map((s) => s.id), ["a", "b"]);
});

test("moveStep returns a new array and keeps the step objects", () => {
  const steps = ["a", "b"].map((id) => ({ id, label: id, minutes: 1 }));
  const moved = moveStep(steps, 0, 1);
  assert.notEqual(moved, steps);
  assert.deepEqual(steps.map((s) => s.id), ["a", "b"]);
  assert.equal(moved[1], steps[0]);
});
