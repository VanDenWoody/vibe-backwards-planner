import { test } from "node:test";
import assert from "node:assert/strict";
import { createTemplate, emptyLibrary, saveTemplate, TEMPLATES_VERSION } from "./templates.js";
import {
  addImported,
  encodeTemplate,
  decodeTemplate,
  EXPORT_VERSION,
  exportLibrary,
  parseExportFile,
  readSharedLink,
  shareUrl,
  uniqueName,
} from "./sharing.js";

const airport = createTemplate("Airport run", "Flight departs", [
  { id: "s1", label: "Check in", minutes: 45 },
  { id: "s2", label: "Drive", minutes: 35 },
]);

function libraryOf(...templates) {
  return templates.reduce((library, template) => saveTemplate(library, template), emptyLibrary());
}

test("decodeTemplate reverses encodeTemplate, without the id", () => {
  assert.deepEqual(decodeTemplate(encodeTemplate(airport)), {
    name: "Airport run",
    deadlineLabel: "Flight departs",
    deadlineTime: "",
    steps: [
      { label: "Check in", minutes: 45 },
      { label: "Drive", minutes: 35 },
    ],
  });
});

test("a shared template keeps its negative steps", () => {
  const pickup = { id: "t9", name: "Pickup", deadlineLabel: "Lands", steps: [
    { label: "Passport queue", minutes: -25 },
    { label: "Drive", minutes: 45 },
  ] };
  assert.deepEqual(decodeTemplate(encodeTemplate(pickup)).steps, pickup.steps);
});

test("encodeTemplate survives text outside ASCII", () => {
  const template = createTemplate("Vakantie ✈️ — café", "Vertrek", [
    { id: "s1", label: "Koffers in de auto 🧳", minutes: 10 },
  ]);
  assert.equal(decodeTemplate(encodeTemplate(template)).name, "Vakantie ✈️ — café");
});

test("encodeTemplate only uses characters that are safe in a URL", () => {
  assert.match(encodeTemplate(airport), /^[A-Za-z0-9_-]+$/);
});

test("decodeTemplate refuses garbage instead of throwing", () => {
  for (const text of ["", "!!!", "e30", "bm9wZQ", undefined, null, 42]) {
    assert.equal(decodeTemplate(text), null, `should refuse: ${String(text)}`);
  }
});

test("decodeTemplate refuses a template with a malformed step", () => {
  const bad = Buffer.from(JSON.stringify({ v: 1, n: "X", d: "", s: [["Drive", "5"]] })).toString(
    "base64url"
  );
  assert.equal(decodeTemplate(bad), null);
});

test("shareUrl puts the template after the hash of the app's address, without its query", () => {
  const url = shareUrl("https://example.github.io/planner/index.html?x=1#old", airport);
  assert.ok(url.startsWith("https://example.github.io/planner/index.html#template="));
});

test("readSharedLink reads a full link, a bare hash and a pasted link with surrounding text", () => {
  const url = shareUrl("https://example.github.io/planner/", airport);
  const hash = url.slice(url.indexOf("#"));
  for (const input of [url, hash, `Look at this: ${url} 👍`]) {
    assert.equal(readSharedLink(input)?.name, "Airport run", `should read: ${input}`);
  }
});

test("readSharedLink returns null for text without a template", () => {
  for (const input of ["", "https://example.com/", "#steps=1", "#template=nope", null]) {
    assert.equal(readSharedLink(input), null, `should refuse: ${String(input)}`);
  }
});

test("exportLibrary round-trips through parseExportFile", () => {
  const library = libraryOf(airport, createTemplate("Dinner", "", []));
  const parsed = parseExportFile(exportLibrary(library));
  assert.deepEqual(
    parsed.map((template) => template.name),
    ["Airport run", "Dinner"]
  );
  assert.deepEqual(parsed[0].steps, airport.steps);
});

test("exportLibrary writes version 1 without updatedAt or tombstones", () => {
  const library = {
    version: TEMPLATES_VERSION,
    items: [{ ...airport, updatedAt: 123 }],
    tombstones: [{ id: "gone", deletedAt: 5 }],
  };
  const raw = JSON.parse(exportLibrary(library));
  assert.equal(EXPORT_VERSION, 1);
  assert.deepEqual(raw, {
    version: 1,
    items: [{ id: airport.id, name: "Airport run", deadlineLabel: "Flight departs", deadlineTime: "", steps: airport.steps }],
  });
});

test("an export round-trips through parseExportFile", () => {
  const library = libraryOf({ ...airport, updatedAt: 9 }, createTemplate("Dinner", "Eat", [{ label: "Cook", minutes: 30 }]));
  assert.deepEqual(parseExportFile(exportLibrary(library)), [
    { name: "Airport run", deadlineLabel: "Flight departs", deadlineTime: "", steps: airport.steps },
    { name: "Dinner", deadlineLabel: "Eat", deadlineTime: "", steps: [{ label: "Cook", minutes: 30 }] },
  ]);
});

test("parseExportFile refuses a version 2 library file", () => {
  assert.equal(parseExportFile(JSON.stringify({ version: 2, items: [], tombstones: [] })), null);
});

test("parseExportFile returns null for a file that is not a template export", () => {
  for (const text of ["", "not json", "[]", "{}", '{"version":1}', '{"version":99,"items":[]}']) {
    assert.equal(parseExportFile(text), null, `should refuse: ${text}`);
  }
});

test("parseExportFile accepts an export with no templates", () => {
  assert.deepEqual(parseExportFile(exportLibrary(emptyLibrary())), []);
});

test("parseExportFile skips malformed templates but keeps the rest", () => {
  const text = JSON.stringify({
    version: 1,
    items: [{ id: "x", name: "", steps: [] }, airport],
  });
  assert.deepEqual(
    parseExportFile(text).map((template) => template.name),
    ["Airport run"]
  );
});

test("uniqueName returns the name unchanged when it is free", () => {
  assert.equal(uniqueName(emptyLibrary(), "Airport run"), "Airport run");
});

test("uniqueName numbers a taken name, skipping numbers already in use", () => {
  const library = libraryOf(airport, createTemplate("airport run (2)", "", []));
  assert.equal(uniqueName(library, "Airport run"), "Airport run (3)");
});

test("addImported as new mints a fresh id and keeps the name when free", () => {
  const library = addImported(emptyLibrary(), decodeTemplate(encodeTemplate(airport)), "new");
  assert.equal(library.items.length, 1);
  assert.equal(library.items[0].name, "Airport run");
  assert.notEqual(library.items[0].id, airport.id);
});

test("addImported as new beside a clash saves it under a numbered name", () => {
  const library = addImported(libraryOf(airport), { ...airport, steps: [] }, "new");
  assert.deepEqual(
    library.items.map((template) => template.name),
    ["Airport run", "Airport run (2)"]
  );
});

test("addImported as replace keeps the clash's id, position and spelling", () => {
  const dinner = createTemplate("Dinner", "", []);
  const library = libraryOf(airport, dinner);
  const incoming = { name: "AIRPORT RUN", deadlineLabel: "Boarding", steps: [{ label: "Taxi", minutes: 20 }] };

  const result = addImported(library, incoming, "replace");

  assert.deepEqual(result.items[0], {
    id: airport.id,
    name: "Airport run",
    deadlineLabel: "Boarding",
    deadlineTime: "",
    steps: [{ label: "Taxi", minutes: 20 }],
    updatedAt: 0,
  });
  assert.equal(result.items[1], dinner);
});

test("addImported leaves the library it was given untouched", () => {
  const library = libraryOf(airport);
  const snapshot = JSON.parse(JSON.stringify(library));
  addImported(library, airport, "replace");
  addImported(library, airport, "new");
  assert.deepEqual(library, snapshot);
});

test("a shared link carries the template's deadline time", () => {
  const commute = createTemplate("Commute", "Desk", [{ label: "Bike", minutes: 25 }], "08:15");
  assert.equal(decodeTemplate(encodeTemplate(commute)).deadlineTime, "08:15");
});

test("a template without a time keeps the link it had before times existed", () => {
  const payload = JSON.parse(
    atob(encodeTemplate(airport).replace(/-/g, "+").replace(/_/g, "/"))
  );
  assert.equal("t" in payload, false);
});

test("a shared link with a broken time still decodes, without the time", () => {
  const payload = { v: 1, n: "Commute", d: "", t: "25:99", s: [["Bike", 25]] };
  const text = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(decodeTemplate(text).deadlineTime, "");
});

test("export and import keep the deadline time", () => {
  const commute = createTemplate("Commute", "Desk", [{ label: "Bike", minutes: 25 }], "08:15");
  const [incoming] = parseExportFile(exportLibrary(libraryOf(commute)));
  assert.equal(incoming.deadlineTime, "08:15");
  assert.equal(addImported(emptyLibrary(), incoming, "new").items[0].deadlineTime, "08:15");
});
