import { TEMPLATES_VERSION, emptyLibrary, normalizeLibrary } from "./templates.js";
import { applyClashChoice, librariesEqual, mergeLibraries } from "./sync.js";

// Public by design: a browser client id is not a secret. Its authorized
// JavaScript origins are what keep other sites from using it.
export const GOOGLE_CLIENT_ID =
  "68751993637-ni8umpc43n8d8lrqghlp6g9kh0pd60eo.apps.googleusercontent.com";
// drive.appdata is the app's own hidden folder, not the user's Drive. email is
// for the sync row and for login_hint on renewals.
export const SCOPES = "https://www.googleapis.com/auth/drive.appdata openid email";

const GIS_URL = "https://accounts.google.com/gsi/client";
const FILE_NAME = "templates.json";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
// A token this close to expiry is treated as gone, so a cycle never starts
// with one that dies half way.
const EXPIRY_MARGIN_MS = 60 * 1000;

export class AuthError extends Error {}

export class DriveError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

let gisLoading = null;

// Injects Google's script once. A failed load is forgotten, so a retry tries
// again rather than getting the same rejection back.
export function loadGis() {
  if (gisLoading !== null) return gisLoading;
  gisLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_URL;
    script.async = true;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      script.remove();
      gisLoading = null;
      reject(new Error("Google sign-in could not load"));
    });
    document.head.append(script);
  });
  return gisLoading;
}

// The token model: a popup hands back an access token of about an hour and no
// refresh token. request() must be called synchronously inside a click, or the
// browser blocks the popup. The token stays in memory only.
export function createAuth({ onToken, onError }) {
  let client = null;
  let current = null;

  function tokenClient() {
    if (client !== null) return client;
    client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback(response) {
        if (response.error) {
          onError(response.error);
          return;
        }
        // Google's consent screen lets the user untick Drive and still go on.
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(response, SCOPES.split(" ")[0])) {
          onError("scope_denied");
          return;
        }
        current = {
          accessToken: response.access_token,
          expiresAt: Date.now() + Number(response.expires_in) * 1000,
        };
        onToken(response.access_token);
      },
      error_callback(error) {
        onError(error?.type ?? "unknown");
      },
    });
    return client;
  }

  return {
    request(prompt, loginHint) {
      const options = { prompt };
      if (loginHint !== "") options.login_hint = loginHint;
      tokenClient().requestAccessToken(options);
    },
    token() {
      if (current === null || current.expiresAt - EXPIRY_MARGIN_MS <= Date.now()) return null;
      return current.accessToken;
    },
    forget() {
      current = null;
    },
  };
}

async function send(fetchFn, token, url, { method = "GET", headers = {}, body } = {}) {
  if (token === null) throw new AuthError("Not signed in");
  const response = await fetchFn(url, {
    method,
    headers: { ...headers, Authorization: `Bearer ${token}` },
    body,
  });
  if (response.status === 401) throw new AuthError("Sign-in expired");
  if (!response.ok) throw new DriveError(`Google answered ${response.status}`, response.status);
  return response;
}

export async function fetchEmail(fetchFn, token) {
  const response = await send(fetchFn, token, USERINFO_URL);
  const info = await response.json();
  return typeof info?.email === "string" ? info.email : "";
}

export function createDriveClient(fetchFn, getToken) {
  const call = (url, init) => send(fetchFn, getToken(), url, init);

  return {
    async list() {
      const query = new URLSearchParams({
        spaces: "appDataFolder",
        q: `name='${FILE_NAME}'`,
        fields: "files(id,version,createdTime)",
        orderBy: "createdTime",
      });
      const body = await (await call(`${FILES_URL}?${query}`)).json();
      return Array.isArray(body?.files) ? body.files : [];
    },

    // Whatever is in the file, parsed; null when it is not JSON at all.
    async download(id) {
      const text = await (await call(`${FILES_URL}/${encodeURIComponent(id)}?alt=media`)).text();
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },

    async create(library) {
      const boundary = `bp${Date.now().toString(36)}`;
      const metadata = { name: FILE_NAME, parents: ["appDataFolder"] };
      const body = [
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(metadata),
        `--${boundary}`,
        "Content-Type: application/json; charset=UTF-8",
        "",
        JSON.stringify(library),
        `--${boundary}--`,
        "",
      ].join("\r\n");
      const response = await call(`${UPLOAD_URL}?uploadType=multipart&fields=id,version`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      });
      return response.json();
    },

    async update(id, library) {
      const response = await call(
        `${UPLOAD_URL}/${encodeURIComponent(id)}?uploadType=media&fields=id,version`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json; charset=UTF-8" },
          body: JSON.stringify(library),
        }
      );
      return response.json();
    },

    async remove(id) {
      try {
        await call(`${FILES_URL}/${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch (error) {
        // Already gone: another device cleaned up first.
        if (!(error instanceof DriveError && error.status === 404)) throw error;
      }
    },
  };
}

function libraryVersion(raw) {
  return raw !== null && typeof raw === "object" ? Number(raw.version) : NaN;
}

// One sync: read Drive, merge with local, ask about name clashes (only when
// the user tapped), write back what changed. Returns
//   { status: "synced" | "again", library, merged }  apply library locally
//   { status: "paused" }  a clash needs the user; nothing written
//   { status: "newer" }   Drive holds a library this version cannot read
// merged lists {dropped, kept} id pairs, for moving the In use marker.
export async function runSyncCycle({ client, local, interactive, resolve, now }) {
  // Oldest first: when two devices both created the file, everyone keeps the
  // same one.
  const files = await client.list();

  const raws = [];
  for (const file of files) raws.push(await client.download(file.id));
  if (raws.some((raw) => libraryVersion(raw) > TEMPLATES_VERSION)) return { status: "newer" };

  const merged = [];
  const oldest = raws.length > 0 ? normalizeLibrary(raws[0]) : emptyLibrary();
  let remote = oldest;
  for (const raw of raws.slice(1)) {
    const result = mergeLibraries(remote, normalizeLibrary(raw));
    remote = result.library;
    merged.push(...result.merged);
    // Inside Drive nobody is "this device", so a duplicate name is numbered
    // like Keep both would, never dropped.
    for (const clash of result.clashes) remote = applyClashChoice(remote, clash, "keep-both", now);
  }

  const result = mergeLibraries(local, remote);
  let library = result.library;
  merged.push(...result.merged);

  if (result.clashes.length > 0) {
    if (!interactive) return { status: "paused" };
    const answers = await resolve(result.clashes);
    if (answers === null) return { status: "paused" };
    result.clashes.forEach((clash, i) => {
      library = applyClashChoice(library, clash, answers[i], now);
      if (answers[i] === "replace") merged.push({ dropped: clash.local.id, kept: clash.remote.id });
    });
  }

  let written = null;
  if (files.length === 0) written = await client.create(library);
  else if (!librariesEqual(library, oldest)) written = await client.update(files[0].id, library);

  for (const file of files.slice(1)) await client.remove(file.id);

  // Drive has no compare-and-swap. If the version moved by more than our own
  // write, someone else wrote in between: go round once more so their change
  // is merged in. Drive sends version as an int64 string, hence Number().
  const raced =
    written !== null && files.length > 0 && Number(written.version) > Number(files[0].version) + 1;
  return { status: raced ? "again" : "synced", library, merged };
}
