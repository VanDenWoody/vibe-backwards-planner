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

test("numeric strings are NOT accepted — callers must coerce first", () => {
  const result = computeSchedule({
    deadline: "2026-09-12T15:00",
    steps: [step("a", "Looks numeric but isn't", "30")],
  });
  assert.equal(result.rows[0].minutes, 0);
  assert.equal(local(result.leaveAt), "2026-09-12T15:00");
});
