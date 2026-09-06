import { emptyPlan, normalizePlan } from "./plan.js";
import { emptyLibrary, normalizeLibrary } from "./templates.js";

export const STORAGE_KEY = "backwards-planner:v1";
export const TEMPLATES_KEY = "backwards-planner:templates:v1";
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
    const raw = window.localStorage.getItem(TEMPLATES_KEY);
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
