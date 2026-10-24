import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_TEMPLATES_KEY,
  SYNC_KEY,
  TEMPLATES_KEY,
  loadSyncState,
  loadTemplates,
  saveSyncState,
  saveTemplates,
} from "./storage.js";

let store;

beforeEach(() => {
  store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  };
});

const v1 = JSON.stringify({
  version: 1,
  items: [{ id: "t1", name: "Airport", deadlineLabel: "", steps: [{ label: "Drive", minutes: 30 }] }],
});

test("the storage keys are the agreed ones", () => {
  assert.equal(TEMPLATES_KEY, "backwards-planner:templates:v2");
  assert.equal(LEGACY_TEMPLATES_KEY, "backwards-planner:templates:v1");
  assert.equal(SYNC_KEY, "backwards-planner:sync:v1");
});

test("loadTemplates migrates from the v1 key", () => {
  store.set(LEGACY_TEMPLATES_KEY, v1);
  assert.deepEqual(loadTemplates(), {
    version: 2,
    items: [{ id: "t1", name: "Airport", deadlineLabel: "", deadlineTime: "", steps: [{ label: "Drive", minutes: 30 }], updatedAt: 0 }],
    tombstones: [],
  });
});

test("v2 key wins over v1", () => {
  store.set(LEGACY_TEMPLATES_KEY, v1);
  store.set(TEMPLATES_KEY, JSON.stringify({ version: 2, items: [], tombstones: [{ id: "t1", deletedAt: 4 }] }));
  assert.deepEqual(loadTemplates(), { version: 2, items: [], tombstones: [{ id: "t1", deletedAt: 4 }] });
});

test("loadTemplates never writes the v1 key", () => {
  store.set(LEGACY_TEMPLATES_KEY, v1);
  const library = loadTemplates();
  saveTemplates({ ...library, items: [] });
  assert.equal(store.get(LEGACY_TEMPLATES_KEY), v1);
  assert.deepEqual(JSON.parse(store.get(TEMPLATES_KEY)).items, []);
});

test("loadTemplates returns an empty library when neither key is there", () => {
  assert.deepEqual(loadTemplates(), { version: 2, items: [], tombstones: [] });
});

test("loadSyncState returns defaults on garbage", () => {
  const defaults = { enabled: false, email: "", lastSyncedAt: 0, dirty: false };
  assert.deepEqual(loadSyncState(), defaults);
  for (const raw of ["not json", "null", "[]", '{"enabled":"yes","email":5,"lastSyncedAt":"x","dirty":1}']) {
    store.set(SYNC_KEY, raw);
    assert.deepEqual(loadSyncState(), defaults, raw);
  }
});

test("saveSyncState round-trips", () => {
  const state = { enabled: true, email: "a@b.c", lastSyncedAt: 42, dirty: true };
  saveSyncState(state);
  assert.deepEqual(loadSyncState(), state);
});
