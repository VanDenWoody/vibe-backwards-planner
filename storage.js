import { emptyPlan, normalizePlan } from "./plan.js";

export const STORAGE_KEY = "backwards-planner:v1";

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
