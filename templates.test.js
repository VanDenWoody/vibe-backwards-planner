import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEMPLATES_VERSION,
  emptyLibrary,
  normalizeLibrary,
  createTemplate,
  findTemplate,
  findTemplateByName,
  saveTemplate,
  removeTemplate,
  planStepsFrom,
  sameContent,
  stampChanges,
  timeOfDeadline,
  nextOccurrence,
  onSameDay,
} from "./templates.js";

test("emptyLibrary has the current version and no items", () => {
  assert.deepEqual(emptyLibrary(), { version: TEMPLATES_VERSION, items: [], tombstones: [] });
  assert.equal(TEMPLATES_VERSION, 2);
});

test("emptyLibrary returns a fresh object each time", () => {
  emptyLibrary().items.push({ id: "x" });
  assert.deepEqual(emptyLibrary().items, []);
});

test("normalizeLibrary accepts well-formed items and drops unknown fields", () => {
  const result = normalizeLibrary({
    version: 1,
    items: [
      {
        id: "t1",
        name: "Airport run",
        deadlineLabel: "Flight departs",
        steps: [{ label: "Check in", minutes: 45, colour: "red" }],
        nonsense: true,
      },
    ],
    junk: 1,
  });
  assert.deepEqual(result, {
    version: 2,
    items: [
      {
        id: "t1",
        name: "Airport run",
        deadlineLabel: "Flight departs",
        deadlineTime: "",
        steps: [{ label: "Check in", minutes: 45 }],
        updatedAt: 0,
      },
    ],
    tombstones: [],
  });
});

test("normalizeLibrary defaults a missing deadlineLabel", () => {
  const result = normalizeLibrary({
    version: 1,
    items: [{ id: "t1", name: "Airport run", steps: [] }],
  });
  assert.equal(result.items[0].deadlineLabel, "");
});

test("normalizeLibrary drops only the malformed items, keeping the rest", () => {
  const good = { id: "t1", name: "Keep me", deadlineLabel: "", deadlineTime: "", steps: [], updatedAt: 0 };
  const result = normalizeLibrary({
    version: 1,
    items: [
      good,
      null,
      "a string",
      { id: "", name: "No id", steps: [] },
      { id: "t2", name: 5, steps: [] },
      { id: "t3", name: "Bad steps", steps: "nope" },
      { id: "t4", name: "Bad step", steps: [{ label: "x", minutes: "30" }] },
      { id: "t5", name: "Infinite", steps: [{ label: "x", minutes: -Infinity }] },
      { id: "t1", name: "Duplicate id", steps: [] },
    ],
  });
  assert.deepEqual(result.items, [good]);
});

test("normalizeLibrary discards a library that is malformed as a whole", () => {
  const rejects = [
    null,
    undefined,
    42,
    "a string",
    [],
    { version: 3, items: [], tombstones: [] },
    { version: 1 },
    { version: 2 },
    { version: 1, items: "nope" },
  ];
  for (const raw of rejects) {
    assert.deepEqual(normalizeLibrary(raw), emptyLibrary(), `should reject: ${JSON.stringify(raw)}`);
  }
});

test("createTemplate trims the name and strips the plan's step ids", () => {
  const created = createTemplate("  Airport run  ", "Flight departs", [
    { id: "s1", label: "Check in", minutes: 45 },
    { id: "s2", label: "Drive", minutes: 35 },
  ]);
  assert.equal(created.name, "Airport run");
  assert.equal(created.deadlineLabel, "Flight departs");
  assert.deepEqual(created.steps, [
    { label: "Check in", minutes: 45 },
    { label: "Drive", minutes: 35 },
  ]);
  assert.equal(typeof created.id, "string");
  assert.ok(created.id.length > 0);
});

test("createTemplate mints unique ids", () => {
  const ids = new Set();
  for (let i = 0; i < 500; i += 1) ids.add(createTemplate("Name", "", []).id);
  assert.equal(ids.size, 500);
});

test("createTemplate survives normalizeLibrary unchanged", () => {
  const created = createTemplate("Airport run", "Flight departs", [
    { id: "s1", label: "Check in", minutes: 45 },
  ]);
  const library = saveTemplate(emptyLibrary(), created);
  assert.deepEqual(normalizeLibrary(JSON.parse(JSON.stringify(library))), library);
});

test("saveTemplate appends a template the library has not seen", () => {
  const first = createTemplate("One", "", []);
  const second = createTemplate("Two", "", []);
  const library = saveTemplate(saveTemplate(emptyLibrary(), first), second);
  assert.deepEqual(library.items.map((item) => item.name), ["One", "Two"]);
});

test("saveTemplate replaces in place, keeping the template's position", () => {
  const first = createTemplate("One", "", []);
  const second = createTemplate("Two", "", []);
  const third = createTemplate("Three", "", []);
  let library = saveTemplate(saveTemplate(saveTemplate(emptyLibrary(), first), second), third);

  library = saveTemplate(library, { ...first, name: "One, edited" });

  assert.deepEqual(library.items.map((item) => item.name), ["One, edited", "Two", "Three"]);
});

test("saveTemplate leaves the library it was given untouched", () => {
  const before = saveTemplate(emptyLibrary(), createTemplate("One", "", []));
  const snapshot = JSON.parse(JSON.stringify(before));
  saveTemplate(before, createTemplate("Two", "", []));
  assert.deepEqual(before, snapshot);
});

test("removeTemplate drops the named template and leaves the others", () => {
  const first = createTemplate("One", "", []);
  const second = createTemplate("Two", "", []);
  const library = saveTemplate(saveTemplate(emptyLibrary(), first), second);

  const result = removeTemplate(library, first.id);

  assert.deepEqual(result.items.map((item) => item.name), ["Two"]);
  assert.equal(library.items.length, 2, "the original library is untouched");
});

test("removeTemplate is a no-op for an id that is not there", () => {
  const library = saveTemplate(emptyLibrary(), createTemplate("One", "", []));
  assert.deepEqual(removeTemplate(library, "nope"), library);
});

test("findTemplate returns the template, or undefined when there is none", () => {
  const created = createTemplate("One", "", []);
  const library = saveTemplate(emptyLibrary(), created);
  assert.deepEqual(findTemplate(library, created.id), created);
  assert.equal(findTemplate(library, "nope"), undefined);
  assert.equal(findTemplate(library, ""), undefined);
});

test("findTemplateByName matches regardless of case and surrounding space", () => {
  const created = createTemplate("Airport run", "", []);
  const library = saveTemplate(emptyLibrary(), created);
  assert.deepEqual(findTemplateByName(library, "Airport run"), created);
  assert.deepEqual(findTemplateByName(library, "  airport RUN  "), created);
  assert.equal(findTemplateByName(library, "School morning"), undefined);
});

test("findTemplateByName returns the clash under its own stored spelling", () => {
  // What the message shows the user has to be the name in the picker, not the
  // variant they just typed.
  const library = saveTemplate(emptyLibrary(), createTemplate("Airport run", "", []));
  assert.equal(findTemplateByName(library, "airport RUN").name, "Airport run");
});

test("findTemplateByName skips the template being updated", () => {
  const created = createTemplate("Airport run", "", []);
  const library = saveTemplate(emptyLibrary(), created);
  assert.equal(findTemplateByName(library, "Airport run", created.id), undefined);
  assert.deepEqual(findTemplateByName(library, "Airport run", "another-id"), created);
});

test("planStepsFrom carries the labels and durations across", () => {
  const template = createTemplate("Airport run", "Flight departs", [
    { id: "s1", label: "Check in", minutes: 45 },
    { id: "s2", label: "Drive", minutes: 0 },
  ]);

  const steps = planStepsFrom(template);

  assert.deepEqual(
    steps.map(({ label, minutes }) => ({ label, minutes })),
    [
      { label: "Check in", minutes: 45 },
      { label: "Drive", minutes: 0 },
    ]
  );
});

test("planStepsFrom mints fresh ids, so loading twice never collides", () => {
  const template = createTemplate("Airport run", "", [
    { id: "s1", label: "Check in", minutes: 45 },
    { id: "s2", label: "Drive", minutes: 35 },
  ]);

  const ids = [...planStepsFrom(template), ...planStepsFrom(template)].map((step) => step.id);

  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
});

test("planStepsFrom gives minutes the real numbers computeSchedule needs", () => {
  const template = createTemplate("Airport run", "", [{ id: "s1", label: "Check in", minutes: 45 }]);
  assert.equal(typeof planStepsFrom(template)[0].minutes, "number");
});

test("planStepsFrom puts negative steps on top", () => {
  const template = createTemplate("Pickup", "Lands", [
    { label: "Drive", minutes: 45 },
    { label: "Passport queue", minutes: -25 },
  ]);
  assert.deepEqual(planStepsFrom(template).map((s) => s.minutes), [-25, 45]);
});

test("normalizeLibrary migrates version 1 to version 2", () => {
  const result = normalizeLibrary({ version: 1, items: [{ id: "t1", name: "A", deadlineLabel: "", steps: [] }] });
  assert.deepEqual(result, {
    version: 2,
    items: [{ id: "t1", name: "A", deadlineLabel: "", deadlineTime: "", steps: [], updatedAt: 0 }],
    tombstones: [],
  });
});

test("normalizeLibrary keeps a version 2 library with its updatedAt", () => {
  const raw = {
    version: 2,
    items: [{ id: "t1", name: "A", deadlineLabel: "", deadlineTime: "", steps: [], updatedAt: 7 }],
    tombstones: [{ id: "t2", deletedAt: 9 }],
  };
  assert.deepEqual(normalizeLibrary(raw), raw);
});

test("normalizeLibrary reads a missing or invalid updatedAt as 0", () => {
  const result = normalizeLibrary({
    version: 2,
    items: [
      { id: "t1", name: "A", steps: [] },
      { id: "t2", name: "B", steps: [], updatedAt: "5" },
    ],
    tombstones: [],
  });
  assert.deepEqual(result.items.map((item) => item.updatedAt), [0, 0]);
});

test("normalizeLibrary keeps valid tombstones and drops malformed ones", () => {
  const result = normalizeLibrary({
    version: 2,
    items: [],
    tombstones: [{ id: "t1", deletedAt: 5 }, { id: "" }, null, { id: "t2", deletedAt: "x" }],
  });
  assert.deepEqual(result.tombstones, [{ id: "t1", deletedAt: 5 }]);
});

test("normalizeLibrary rejects version 3", () => {
  assert.deepEqual(normalizeLibrary({ version: 3, items: [], tombstones: [] }), emptyLibrary());
});

test("createTemplate starts unstamped", () => {
  assert.equal(createTemplate("A", "", []).updatedAt, 0);
});

test("saveTemplate and removeTemplate keep the tombstones as they are", () => {
  const a = { id: "a", name: "A", deadlineLabel: "", steps: [], updatedAt: 1 };
  const library = { version: 2, items: [a], tombstones: [{ id: "x", deletedAt: 3 }] };
  assert.deepEqual(saveTemplate(library, { ...a, name: "B" }).tombstones, [{ id: "x", deletedAt: 3 }]);
  assert.deepEqual(removeTemplate(library, "a").tombstones, [{ id: "x", deletedAt: 3 }]);
});

test("sameContent compares name, deadline and steps in order", () => {
  const a = { id: "a", name: "A", deadlineLabel: "D", steps: [{ label: "x", minutes: 1 }, { label: "y", minutes: 2 }], updatedAt: 1 };
  assert.equal(sameContent(a, { ...a, id: "b", updatedAt: 9 }), true);
  assert.equal(sameContent(a, { ...a, name: "B" }), false);
  assert.equal(sameContent(a, { ...a, deadlineLabel: "E" }), false);
  assert.equal(sameContent(a, { ...a, steps: [...a.steps].reverse() }), false);
  assert.equal(sameContent(a, { ...a, steps: [{ label: "x", minutes: 1 }, { label: "y", minutes: 3 }] }), false);
  assert.equal(sameContent(a, { ...a, steps: [{ label: "x", minutes: 1 }] }), false);
});

function item(id, name, updatedAt, steps = []) {
  return { id, name, deadlineLabel: "", steps, updatedAt };
}

test("stampChanges stamps new and edited items, leaves unchanged ones", () => {
  const previous = { version: 2, items: [item("a", "A", 1), item("b", "B", 1)], tombstones: [] };
  const next = { version: 2, items: [item("a", "A", 1), item("b", "B2", 1), item("c", "C", 0)], tombstones: [] };
  const result = stampChanges(previous, next, 100);
  assert.deepEqual(result.items.map((i) => [i.id, i.updatedAt]), [["a", 1], ["b", 100], ["c", 100]]);
  assert.deepEqual(result.tombstones, []);
});

test("stampChanges adds a tombstone for a removed item", () => {
  const previous = { version: 2, items: [item("a", "A", 1)], tombstones: [] };
  const next = { version: 2, items: [], tombstones: [] };
  assert.deepEqual(stampChanges(previous, next, 100), {
    version: 2,
    items: [],
    tombstones: [{ id: "a", deletedAt: 100 }],
  });
});

test("stampChanges re-stamps a restored item and drops its tombstone", () => {
  const previous = { version: 2, items: [], tombstones: [{ id: "a", deletedAt: 50 }] };
  const next = { version: 2, items: [item("a", "A", 1)], tombstones: [] };
  assert.deepEqual(stampChanges(previous, next, 100), {
    version: 2,
    items: [item("a", "A", 100)],
    tombstones: [],
  });
});

test("stampChanges re-stamps a restored item even when next still carries its tombstone", () => {
  const previous = { version: 2, items: [], tombstones: [{ id: "a", deletedAt: 50 }] };
  const next = { version: 2, items: [item("a", "A", 1)], tombstones: [{ id: "a", deletedAt: 50 }] };
  const result = stampChanges(previous, next, 100);
  assert.equal(result.items[0].updatedAt, 100);
  assert.deepEqual(result.tombstones, []);
});

test("stampChanges keeps tombstones from previous that an older snapshot lacks", () => {
  const previous = { version: 2, items: [item("b", "B", 1)], tombstones: [{ id: "x", deletedAt: 40 }] };
  const next = { version: 2, items: [item("b", "B", 1)], tombstones: [] };
  assert.deepEqual(stampChanges(previous, next, 100).tombstones, [{ id: "x", deletedAt: 40 }]);
});

test("stampChanges ignores the order of items", () => {
  const previous = { version: 2, items: [item("a", "A", 1), item("b", "B", 2)], tombstones: [] };
  const next = { version: 2, items: [item("b", "B", 2), item("a", "A", 1)], tombstones: [] };
  assert.deepEqual(stampChanges(previous, next, 100), next);
});

test("stampChanges leaves its inputs untouched", () => {
  const previous = { version: 2, items: [item("a", "A", 1)], tombstones: [] };
  const next = { version: 2, items: [item("a", "A2", 1)], tombstones: [] };
  const snapshot = JSON.stringify([previous, next]);
  stampChanges(previous, next, 100);
  assert.equal(JSON.stringify([previous, next]), snapshot);
});

test("createTemplate keeps a clock time and drops anything else", () => {
  assert.equal(createTemplate("A", "", [], "08:15").deadlineTime, "08:15");
  assert.equal(createTemplate("A", "", []).deadlineTime, "");
  for (const bad of ["8:15", "24:00", "08:60", "2026-10-25T08:15", 815, null]) {
    assert.equal(createTemplate("A", "", [], bad).deadlineTime, "", `should drop: ${String(bad)}`);
  }
});

test("normalizeLibrary keeps a valid deadlineTime and blanks a broken one", () => {
  const result = normalizeLibrary({
    version: 2,
    items: [
      { id: "t1", name: "A", steps: [], deadlineTime: "23:59" },
      { id: "t2", name: "B", steps: [], deadlineTime: "noon" },
    ],
    tombstones: [],
  });
  assert.deepEqual(result.items.map((item) => item.deadlineTime), ["23:59", ""]);
});

test("sameContent sees a changed deadline time", () => {
  const a = createTemplate("A", "", [], "08:15");
  assert.equal(sameContent(a, { ...a, deadlineTime: "08:30" }), false);
  assert.equal(sameContent(a, { ...a }), true);
});

test("timeOfDeadline takes the clock time of a plan deadline", () => {
  assert.equal(timeOfDeadline("2026-10-30T14:00"), "14:00");
  assert.equal(timeOfDeadline("2026-10-30T14:00:30"), "14:00");
  assert.equal(timeOfDeadline(""), "");
  assert.equal(timeOfDeadline(undefined), "");
});

test("nextOccurrence is today while the time is still ahead", () => {
  assert.equal(nextOccurrence("08:15", new Date(2026, 9, 24, 7, 0)), "2026-10-24T08:15");
});

test("nextOccurrence is tomorrow once the time has passed or is now", () => {
  assert.equal(nextOccurrence("08:15", new Date(2026, 9, 24, 13, 23)), "2026-10-25T08:15");
  assert.equal(nextOccurrence("08:15", new Date(2026, 9, 24, 8, 15)), "2026-10-25T08:15");
});

test("nextOccurrence rolls over the end of a month and a year", () => {
  assert.equal(nextOccurrence("06:00", new Date(2026, 9, 31, 22, 0)), "2026-11-01T06:00");
  assert.equal(nextOccurrence("00:00", new Date(2026, 11, 31, 0, 1)), "2027-01-01T00:00");
});

test("onSameDay keeps the date and swaps the time", () => {
  assert.equal(onSameDay("2026-10-30T14:00", "08:15"), "2026-10-30T08:15");
});
