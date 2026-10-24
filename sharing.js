import { createTemplate, findTemplateByName, normalizeTemplate, saveTemplate } from "./templates.js";

export const SHARE_PARAM = "template";
const SHARE_VERSION = 1;
// Decoupled from TEMPLATES_VERSION: export files carry no sync data (updatedAt,
// tombstones), so they stay readable by app versions before and after sync.
export const EXPORT_VERSION = 1;

// A shared template carries no id: the receiver's library mints its own, so an
// id from someone else's phone can never collide with one already here.
// The short keys and step pairs keep the link short enough for a chat message.
export function encodeTemplate(template) {
  const payload = {
    v: SHARE_VERSION,
    n: template.name,
    d: template.deadlineLabel,
    s: template.steps.map((step) => [step.label, step.minutes]),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Returns {name, deadlineLabel, steps}, or null for anything that is not a
// template this version can read. Links arrive from outside, so nothing here
// may throw.
export function decodeTemplate(text) {
  if (typeof text !== "string" || text === "") return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (payload === null || typeof payload !== "object" || payload.v !== SHARE_VERSION) return null;
    if (!Array.isArray(payload.s)) return null;

    const template = normalizeTemplate({
      id: "shared",
      name: typeof payload.n === "string" ? payload.n.trim() : "",
      deadlineLabel: payload.d,
      steps: payload.s.map((pair) =>
        Array.isArray(pair) ? { label: pair[0], minutes: pair[1] } : null
      ),
    });
    if (template === null) return null;
    const { name, deadlineLabel, steps } = template;
    return { name, deadlineLabel, steps };
  } catch {
    return null;
  }
}

// The template rides in the hash, which browsers never send to the server. The
// query is dropped too: whatever this copy was opened with is not the
// receiver's business.
export function shareUrl(href, template) {
  const base = href.split("#")[0].split("?")[0];
  return `${base}#${SHARE_PARAM}=${encodeTemplate(template)}`;
}

// Accepts whatever the user pastes: the whole link, just its hash, or a chat
// message with the link somewhere inside it.
export function readSharedLink(text) {
  if (typeof text !== "string") return null;
  const match = text.match(new RegExp(`[#&]${SHARE_PARAM}=([A-Za-z0-9_-]+)`));
  return match === null ? null : decodeTemplate(match[1]);
}

export function exportLibrary(library) {
  const items = library.items.map(({ id, name, deadlineLabel, steps }) => ({
    id,
    name,
    deadlineLabel,
    steps,
  }));
  return `${JSON.stringify({ version: EXPORT_VERSION, items }, null, 2)}\n`;
}

// Returns the templates in the file, or null when the file is not an export at
// all, so the caller can tell "an empty export" from "the wrong file".
export function parseExportFile(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.version !== EXPORT_VERSION || !Array.isArray(raw.items)) return null;

  const templates = [];
  const seen = new Set();
  for (const entry of raw.items) {
    const template = normalizeTemplate(entry);
    if (template === null || seen.has(template.id)) continue;
    seen.add(template.id);
    const { name, deadlineLabel, steps } = template;
    templates.push({ name, deadlineLabel, steps });
  }
  return templates;
}

export function uniqueName(library, name) {
  if (findTemplateByName(library, name) === undefined) return name;
  for (let n = 2; ; n += 1) {
    const candidate = `${name} (${n})`;
    if (findTemplateByName(library, candidate) === undefined) return candidate;
  }
}

// "replace" overwrites the template with the same name where it stands, keeping
// its id so the In use marker and Update still point at it. "new" adds the
// template, numbering its name if that is taken. Returns a new library.
export function addImported(library, incoming, mode) {
  const clash = findTemplateByName(library, incoming.name);
  if (mode === "replace" && clash !== undefined) {
    return saveTemplate(library, {
      ...createTemplate(clash.name, incoming.deadlineLabel, incoming.steps),
      id: clash.id,
    });
  }
  const name = uniqueName(library, incoming.name);
  return saveTemplate(library, createTemplate(name, incoming.deadlineLabel, incoming.steps));
}
