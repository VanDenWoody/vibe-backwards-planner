import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AuthError,
  DriveError,
  GOOGLE_CLIENT_ID,
  SCOPES,
  createDriveClient,
  fetchEmail,
  runSyncCycle,
} from "./drive.js";

function item(id, name, updatedAt, steps = [{ label: "Drive", minutes: 30 }]) {
  return { id, name, deadlineLabel: "", steps, updatedAt };
}

function lib(items, tombstones = []) {
  return { version: 2, items, tombstones };
}

// A fake Drive: files keyed by id, each with content, a string version (Drive
// sends int64 as a string) and a createdTime. Records every request.
function fakeDrive(files = [], { bump = 1, status = null } = {}) {
  const store = new Map(files.map((f) => [f.id, { ...f }]));
  const requests = [];
  let next = 1;
  async function fetchFn(url, init = {}) {
    const method = init.method ?? "GET";
    requests.push({ method, url, headers: init.headers ?? {}, body: init.body });
    const reply = (code, body) => ({
      ok: code >= 200 && code < 300,
      status: code,
      json: async () => body,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    });
    if (status !== null) return reply(status, {});
    const u = new URL(url);
    const id = u.pathname.split("/files/")[1];
    if (method === "GET" && u.pathname === "/drive/v3/files") {
      const listed = [...store.values()]
        .sort((a, b) => a.createdTime.localeCompare(b.createdTime))
        .map(({ id, version, createdTime }) => ({ id, version, createdTime }));
      return reply(200, { files: listed });
    }
    if (method === "GET" && id !== undefined) {
      return reply(200, store.get(id).content);
    }
    if (method === "POST") {
      const content = JSON.parse(init.body.split("\r\n\r\n")[2].split("\r\n--")[0]);
      const created = { id: `new${next++}`, version: "1", createdTime: "2026-10-24T12:00:00Z", content };
      store.set(created.id, created);
      return reply(200, { id: created.id, version: created.version });
    }
    if (method === "PATCH") {
      const file = store.get(id);
      file.content = JSON.parse(init.body);
      file.version = String(Number(file.version) + bump);
      return reply(200, { id, version: file.version });
    }
    if (method === "DELETE") {
      store.delete(id);
      return reply(204, "");
    }
    return reply(500, {});
  }
  return { fetchFn, store, requests };
}

function client(drive, token = "tok") {
  return createDriveClient(drive.fetchFn, () => token);
}

const never = async () => assert.fail("resolve must not be called");

test("the client id and scopes are the agreed ones", () => {
  assert.equal(GOOGLE_CLIENT_ID, "68751993637-ni8umpc43n8d8lrqghlp6g9kh0pd60eo.apps.googleusercontent.com");
  assert.equal(SCOPES, "https://www.googleapis.com/auth/drive.appdata openid email");
});

test("cycle creates the file when Drive has none", async () => {
  const drive = fakeDrive();
  const local = lib([item("a", "A", 1)]);
  const result = await runSyncCycle({ client: client(drive), local, interactive: false, resolve: never, now: 50 });
  assert.equal(result.status, "synced");
  const [file] = drive.store.values();
  assert.deepEqual(file.content, local);
  const post = drive.requests.find((r) => r.method === "POST");
  assert.match(post.url, /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?uploadType=multipart/);
  assert.match(post.body, /"parents":\["appDataFolder"\]/);
  assert.match(post.body, /"name":"templates\.json"/);
});

test("cycle lists only templates.json in the app folder", async () => {
  const drive = fakeDrive();
  await runSyncCycle({ client: client(drive), local: lib([]), interactive: false, resolve: never, now: 1 });
  const list = new URL(drive.requests[0].url);
  assert.equal(list.searchParams.get("spaces"), "appDataFolder");
  assert.equal(list.searchParams.get("q"), "name='templates.json'");
});

test("cycle does not write when nothing changed", async () => {
  const content = lib([item("a", "A", 1)]);
  const drive = fakeDrive([{ id: "f1", version: "3", createdTime: "2026-01-01T00:00:00Z", content }]);
  const result = await runSyncCycle({ client: client(drive), local: content, interactive: false, resolve: never, now: 50 });
  assert.equal(result.status, "synced");
  assert.deepEqual(drive.requests.map((r) => r.method), ["GET", "GET"]);
});

test("cycle uploads a merge and returns it", async () => {
  const drive = fakeDrive([{ id: "f1", version: "3", createdTime: "2026-01-01T00:00:00Z", content: lib([item("b", "B", 1)]) }]);
  const result = await runSyncCycle({ client: client(drive), local: lib([item("a", "A", 1)]), interactive: false, resolve: never, now: 50 });
  assert.equal(result.status, "synced");
  assert.deepEqual(result.library.items.map((i) => i.id), ["a", "b"]);
  assert.deepEqual(drive.store.get("f1").content.items.map((i) => i.id), ["a", "b"]);
  const patch = drive.requests.find((r) => r.method === "PATCH");
  assert.match(patch.url, /^https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\/f1\?uploadType=media/);
});

test("cycle merges two files into the oldest and deletes the other", async () => {
  const drive = fakeDrive([
    { id: "late", version: "1", createdTime: "2026-02-01T00:00:00Z", content: lib([item("b", "B", 1)]) },
    { id: "early", version: "1", createdTime: "2026-01-01T00:00:00Z", content: lib([item("a", "A", 1)]) },
  ]);
  const result = await runSyncCycle({ client: client(drive), local: lib([]), interactive: false, resolve: never, now: 50 });
  assert.equal(result.status, "synced");
  assert.deepEqual([...drive.store.keys()], ["early"]);
  assert.deepEqual(drive.store.get("early").content.items.map((i) => i.id).sort(), ["a", "b"]);
});

test("cycle numbers a duplicate name between two Drive files instead of losing one", async () => {
  const drive = fakeDrive([
    { id: "early", version: "1", createdTime: "2026-01-01T00:00:00Z", content: lib([item("a", "Airport", 1)]) },
    { id: "late", version: "1", createdTime: "2026-02-01T00:00:00Z", content: lib([item("b", "Airport", 1, [{ label: "Bus", minutes: 5 }])]) },
  ]);
  const result = await runSyncCycle({ client: client(drive), local: lib([]), interactive: false, resolve: never, now: 50 });
  assert.equal(result.status, "synced");
  assert.deepEqual(result.library.items.map((i) => i.name).sort(), ["Airport", "Airport (2)"]);
});

test("cycle stops on a newer library version without writing", async () => {
  const drive = fakeDrive([{ id: "f1", version: "3", createdTime: "2026-01-01T00:00:00Z", content: { version: 3, items: [], tombstones: [] } }]);
  const result = await runSyncCycle({ client: client(drive), local: lib([item("a", "A", 1)]), interactive: true, resolve: never, now: 50 });
  assert.equal(result.status, "newer");
  assert.equal(result.library, undefined);
  assert.ok(drive.requests.every((r) => r.method === "GET"));
});

const clashing = () =>
  fakeDrive([{ id: "f1", version: "3", createdTime: "2026-01-01T00:00:00Z", content: lib([item("t2", "Airport", 1, [{ label: "Train", minutes: 50 }])]) }]);
const localAirport = lib([item("t1", "Airport", 1)]);

test("cycle pauses on a clash when not interactive and writes nothing", async () => {
  const drive = clashing();
  const result = await runSyncCycle({ client: client(drive), local: localAirport, interactive: false, resolve: never, now: 50 });
  assert.equal(result.status, "paused");
  assert.ok(drive.requests.every((r) => r.method === "GET"));
});

test("cycle applies clash answers when interactive", async () => {
  const drive = clashing();
  let asked = null;
  const result = await runSyncCycle({
    client: client(drive),
    local: localAirport,
    interactive: true,
    resolve: async (clashes) => {
      asked = clashes;
      return ["replace"];
    },
    now: 50,
  });
  assert.equal(asked.length, 1);
  assert.equal(result.status, "synced");
  assert.deepEqual(result.library.items.map((i) => i.id), ["t2"]);
  assert.deepEqual(result.merged, [{ dropped: "t1", kept: "t2" }]);
  assert.deepEqual(drive.store.get("f1").content.tombstones, [{ id: "t1", deletedAt: 50 }]);
});

test("cycle pauses when the clash dialog is cancelled", async () => {
  const drive = clashing();
  const result = await runSyncCycle({ client: client(drive), local: localAirport, interactive: true, resolve: async () => null, now: 50 });
  assert.equal(result.status, "paused");
  assert.ok(drive.requests.every((r) => r.method === "GET"));
});

test("race check compares versions numerically", async () => {
  const run = async (bump) => {
    const drive = fakeDrive([{ id: "f1", version: "9", createdTime: "2026-01-01T00:00:00Z", content: lib([]) }], { bump });
    return (await runSyncCycle({ client: client(drive), local: lib([item("a", "A", 1)]), interactive: false, resolve: never, now: 5 })).status;
  };
  assert.equal(await run(2), "again"); // "9" → "11"
  assert.equal(await run(1), "synced"); // "9" → "10"
});

test("401 raises AuthError", async () => {
  const drive = fakeDrive([], { status: 401 });
  await assert.rejects(
    runSyncCycle({ client: client(drive), local: lib([]), interactive: false, resolve: never, now: 1 }),
    AuthError
  );
  await assert.rejects(fetchEmail(drive.fetchFn, "tok"), AuthError);
});

test("other failures raise DriveError with the status", async () => {
  const drive = fakeDrive([], { status: 503 });
  await assert.rejects(client(drive).list(), (error) => error instanceof DriveError && error.status === 503);
});

test("no token raises AuthError without calling Drive", async () => {
  const drive = fakeDrive();
  await assert.rejects(client(drive, null).list(), AuthError);
  assert.equal(drive.requests.length, 0);
});

test("requests carry the bearer token", async () => {
  const drive = fakeDrive([{ id: "f1", version: "1", createdTime: "2026-01-01T00:00:00Z", content: lib([]) }]);
  await runSyncCycle({ client: client(drive), local: lib([item("a", "A", 1)]), interactive: false, resolve: never, now: 1 });
  assert.ok(drive.requests.length >= 3);
  for (const request of drive.requests) assert.equal(request.headers.Authorization, "Bearer tok");
});

test("fetchEmail reads the userinfo endpoint", async () => {
  const requests = [];
  const email = await fetchEmail(async (url, init) => {
    requests.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ email: "me@example.com" }) };
  }, "tok");
  assert.equal(email, "me@example.com");
  assert.equal(requests[0].url, "https://openidconnect.googleapis.com/v1/userinfo");
  assert.equal(requests[0].init.headers.Authorization, "Bearer tok");
});
