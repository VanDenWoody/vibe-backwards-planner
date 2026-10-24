import { test } from "node:test";
import assert from "node:assert/strict";
import { applyClashChoice, librariesEqual, mergeLibraries } from "./sync.js";

function item(id, name, updatedAt, steps = [{ label: "Drive", minutes: 30 }], deadlineLabel = "") {
  return { id, name, deadlineLabel, steps, updatedAt };
}

function lib(items, tombstones = []) {
  return { version: 2, items, tombstones };
}

function byId(library) {
  return Object.fromEntries(library.items.map((i) => [i.id, i]));
}

test("disjoint libraries are unioned", () => {
  const { library, clashes } = mergeLibraries(lib([item("a", "A", 1)]), lib([item("b", "B", 2)]));
  assert.deepEqual(library.items.map((i) => i.id), ["a", "b"]);
  assert.deepEqual(clashes, []);
});

test("same id: newer updatedAt wins", () => {
  const local = lib([item("a", "Old", 1)]);
  const remote = lib([item("a", "New", 2)]);
  assert.equal(mergeLibraries(local, remote).library.items[0].name, "New");
  assert.equal(mergeLibraries(remote, local).library.items[0].name, "New");
});

test("same id tie: result does not depend on which side is local", () => {
  const one = lib([item("a", "Alpha", 5)]);
  const two = lib([item("a", "Beta", 5)]);
  const ab = mergeLibraries(one, two).library;
  const ba = mergeLibraries(two, one).library;
  assert.deepEqual(ab, ba);
  assert.equal(ab.items[0].name, "Alpha");
});

test("older edit loses to a tombstone", () => {
  const local = lib([item("a", "A", 5)]);
  const remote = lib([], [{ id: "a", deletedAt: 9 }]);
  const { library } = mergeLibraries(local, remote);
  assert.deepEqual(library.items, []);
  assert.deepEqual(library.tombstones, [{ id: "a", deletedAt: 9 }]);
});

test("an edit at the same moment as the delete loses too", () => {
  const { library } = mergeLibraries(lib([item("a", "A", 9)]), lib([], [{ id: "a", deletedAt: 9 }]));
  assert.deepEqual(library.items, []);
});

test("newer item beats older tombstone", () => {
  const local = lib([item("a", "A", 10)]);
  const remote = lib([], [{ id: "a", deletedAt: 9 }]);
  const { library } = mergeLibraries(local, remote);
  assert.deepEqual(library.items, [item("a", "A", 10)]);
  assert.deepEqual(library.tombstones, []);
  assert.deepEqual(mergeLibraries(remote, local).library, library);
});

test("tombstone on one side removes the item from the other", () => {
  const local = lib([item("a", "A", 1), item("b", "B", 1)]);
  const remote = lib([item("b", "B", 1)], [{ id: "a", deletedAt: 4 }]);
  for (const { library } of [mergeLibraries(local, remote), mergeLibraries(remote, local)]) {
    assert.deepEqual(library.items.map((i) => i.id), ["b"]);
    assert.deepEqual(library.tombstones, [{ id: "a", deletedAt: 4 }]);
  }
});

test("tombstones are unioned with the larger deletedAt", () => {
  const { library } = mergeLibraries(
    lib([], [{ id: "x", deletedAt: 3 }, { id: "y", deletedAt: 8 }]),
    lib([], [{ id: "x", deletedAt: 5 }, { id: "z", deletedAt: 1 }])
  );
  assert.deepEqual(library.tombstones, [
    { id: "x", deletedAt: 5 },
    { id: "y", deletedAt: 8 },
    { id: "z", deletedAt: 1 },
  ]);
});

test("identical clash keeps the smaller id", () => {
  const { library, clashes, merged } = mergeLibraries(
    lib([item("t2", "Airport", 4)]),
    lib([item("t1", "airport", 7)])
  );
  assert.deepEqual(library.items.map((i) => i.id), ["t1"]);
  assert.deepEqual(library.tombstones, [{ id: "t2", deletedAt: 7 }]);
  assert.deepEqual(clashes, []);
  assert.deepEqual(merged, [{ dropped: "t2", kept: "t1" }]);
});

test("identical clash converges whichever side is local", () => {
  const a = lib([item("t1", "Airport", 4)]);
  const b = lib([item("t2", "Airport", 7)]);
  const ab = mergeLibraries(a, b).library;
  const ba = mergeLibraries(b, a).library;
  assert.ok(librariesEqual(ab, ba));
  const both = mergeLibraries(ab, ba).library;
  assert.equal(both.items.length, 1);
  assert.equal(both.items[0].id, "t1");
  // A stale read: each device merged against the other's old file, then the
  // two results meet. The template must survive.
  const stale = mergeLibraries(mergeLibraries(a, b).library, mergeLibraries(b, a).library).library;
  assert.equal(stale.items.length, 1);
});

test("different clash is reported and both are kept", () => {
  const local = item("t1", "Airport", 4, [{ label: "Drive", minutes: 30 }]);
  const remote = item("t2", "Airport", 5, [{ label: "Train", minutes: 50 }]);
  const { library, clashes, merged } = mergeLibraries(lib([local]), lib([remote]));
  assert.deepEqual(library.items.map((i) => i.id), ["t1", "t2"]);
  assert.deepEqual(clashes, [{ local, remote }]);
  assert.deepEqual(merged, []);
});

test("a clash with a template whose rename arrived from the other side is reported", () => {
  // Local renamed a to "Airport"; the other side made a new "Airport" (c).
  const local = lib([item("a", "Airport", 6)]);
  const remote = lib([item("a", "X", 5), item("c", "Airport", 5, [{ label: "Bus", minutes: 9 }])]);
  const { clashes } = mergeLibraries(local, remote);
  assert.deepEqual(clashes.map((c) => [c.local.id, c.remote.id]), [["a", "c"]]);
});

test("merge is idempotent", () => {
  const local = lib([item("a", "A", 3), item("t2", "Airport", 1)], [{ id: "z", deletedAt: 2 }]);
  const remote = lib([item("a", "A2", 4), item("b", "B", 1), item("t1", "Airport", 1)], [{ id: "y", deletedAt: 1 }]);
  const once = mergeLibraries(local, remote).library;
  const twice = mergeLibraries(once, remote);
  assert.ok(librariesEqual(once, twice.library));
  assert.deepEqual(twice.clashes, []);
  assert.ok(librariesEqual(mergeLibraries(remote, once).library, once));
});

test("applyClashChoice keep-both numbers the remote copy", () => {
  const local = item("t1", "Airport", 4, [{ label: "Drive", minutes: 30 }]);
  const remote = item("t2", "Airport", 5, [{ label: "Train", minutes: 50 }]);
  const { library, clashes } = mergeLibraries(lib([local]), lib([remote]));
  const result = applyClashChoice(library, clashes[0], "keep-both", 100);
  const items = byId(result);
  assert.equal(items.t1.name, "Airport");
  assert.equal(items.t1.updatedAt, 4);
  assert.equal(items.t2.name, "Airport (2)");
  assert.equal(items.t2.updatedAt, 100);
  assert.deepEqual(result.tombstones, []);
});

test("applyClashChoice replace tombstones the local copy", () => {
  const local = item("t1", "Airport", 4, [{ label: "Drive", minutes: 30 }]);
  const remote = item("t2", "Airport", 5, [{ label: "Train", minutes: 50 }]);
  const { library, clashes } = mergeLibraries(lib([local]), lib([remote]));
  const result = applyClashChoice(library, clashes[0], "replace", 100);
  assert.deepEqual(result.items.map((i) => i.id), ["t2"]);
  assert.deepEqual(result.tombstones, [{ id: "t1", deletedAt: 100 }]);
});

test("librariesEqual ignores order but not updatedAt or tombstones", () => {
  const a = lib([item("a", "A", 1), item("b", "B", 2)], [{ id: "x", deletedAt: 1 }]);
  assert.ok(librariesEqual(a, lib([item("b", "B", 2), item("a", "A", 1)], [{ id: "x", deletedAt: 1 }])));
  assert.ok(!librariesEqual(a, lib([item("a", "A", 1), item("b", "B", 3)], [{ id: "x", deletedAt: 1 }])));
  assert.ok(!librariesEqual(a, lib(a.items, [])));
  assert.ok(!librariesEqual(a, lib(a.items, [{ id: "x", deletedAt: 2 }])));
  assert.ok(!librariesEqual(a, lib([item("a", "A", 1)], a.tombstones)));
});
