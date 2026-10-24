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
} from "./templates.js";

test("emptyLibrary has the current version and no items", () => {
  assert.deepEqual(emptyLibrary(), { version: TEMPLATES_VERSION, items: [] });
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
    version: 1,
    items: [
      {
        id: "t1",
        name: "Airport run",
        deadlineLabel: "Flight departs",
        steps: [{ label: "Check in", minutes: 45 }],
      },
    ],
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
  const good = { id: "t1", name: "Keep me", deadlineLabel: "", steps: [] };
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
    { version: 2, items: [] },
    { version: 1 },
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
