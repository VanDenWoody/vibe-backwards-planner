import { emptyPlan, normalizePlan } from "./plan.js";
import { emptyLibrary, normalizeLibrary } from "./templates.js";

export const STORAGE_KEY = "backwards-planner:v1";
// Version 2 of the library lives under its own key. The v1 key is only ever
// read, as a migration source: the service worker is cache-first, so an old
// app version can still run after this one migrated, and it must neither see
// version 2 (it would read it as empty and wipe it) nor be overwritten.
export const TEMPLATES_KEY = "backwards-planner:templates:v2";
export const LEGACY_TEMPLATES_KEY = "backwards-planner:templates:v1";
export const SYNC_KEY = "backwards-planner:sync:v1";
// Set by opening the app with #sync; hides all sync UI and network until then.
export const PREVIEW_KEY = "backwards-planner:sync-preview:v1";
// Kept out of the plan record so the plan's shape and version need not move.
export const ACTIVE_TEMPLATE_KEY = "backwards-planner:active-template:v1";

export function loadPlan() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyPlan();
    return normalizePlan(JSON.parse(raw));
  } catch {
    return emptyPlan();
  }
}

export function savePlan(plan) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
  } catch {
    // Storage disabled or full. The in-memory plan keeps working.
  }
}

export function loadTemplates() {
  try {
    const raw =
      window.localStorage.getItem(TEMPLATES_KEY) ??
      window.localStorage.getItem(LEGACY_TEMPLATES_KEY);
    if (raw === null) return emptyLibrary();
    return normalizeLibrary(JSON.parse(raw));
  } catch {
    return emptyLibrary();
  }
}

export function saveTemplates(library) {
  try {
    window.localStorage.setItem(TEMPLATES_KEY, JSON.stringify(library));
  } catch {
    // Storage disabled or full. The in-memory library keeps working.
  }
}

export function loadActiveTemplateId() {
  try {
    return window.localStorage.getItem(ACTIVE_TEMPLATE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveActiveTemplateId(id) {
  try {
    if (id === "") window.localStorage.removeItem(ACTIVE_TEMPLATE_KEY);
    else window.localStorage.setItem(ACTIVE_TEMPLATE_KEY, id);
  } catch {
    // Storage disabled or full. Update still works for this session.
  }
}

export function loadSyncState() {
  const state = { enabled: false, email: "", lastSyncedAt: 0, dirty: false };
  try {
    const raw = JSON.parse(window.localStorage.getItem(SYNC_KEY));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return state;
    if (typeof raw.enabled === "boolean") state.enabled = raw.enabled;
    if (typeof raw.email === "string") state.email = raw.email;
    if (Number.isFinite(raw.lastSyncedAt)) state.lastSyncedAt = raw.lastSyncedAt;
    if (typeof raw.dirty === "boolean") state.dirty = raw.dirty;
    return state;
  } catch {
    return state;
  }
}

export function saveSyncState(state) {
  try {
    window.localStorage.setItem(SYNC_KEY, JSON.stringify(state));
  } catch {
    // Storage disabled or full. Sync state is rebuilt by the next sync.
  }
}

export function loadSyncPreview() {
  try {
    return window.localStorage.getItem(PREVIEW_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveSyncPreview(on) {
  try {
    if (on) window.localStorage.setItem(PREVIEW_KEY, "1");
    else window.localStorage.removeItem(PREVIEW_KEY);
  } catch {
    // Storage disabled. The flag simply does not stick.
  }
}
