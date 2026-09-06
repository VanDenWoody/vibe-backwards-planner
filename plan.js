export const PLAN_VERSION = 1;

let counter = 0;

function newId() {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}`;
}

export function emptyPlan() {
  return { version: PLAN_VERSION, deadline: "", deadlineLabel: "", steps: [] };
}

export function coerceMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function createStep(label, minutes) {
  return {
    id: newId(),
    label: typeof label === "string" ? label : "",
    minutes: coerceMinutes(minutes),
  };
}

export function normalizePlan(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return emptyPlan();
  if (raw.version !== PLAN_VERSION) return emptyPlan();
  if (typeof raw.deadline !== "string") return emptyPlan();
  if (!Array.isArray(raw.steps)) return emptyPlan();

  const steps = [];
  for (const step of raw.steps) {
    if (step === null || typeof step !== "object") return emptyPlan();
    if (typeof step.id !== "string" || step.id === "") return emptyPlan();
    if (typeof step.label !== "string") return emptyPlan();
    if (!Number.isFinite(step.minutes) || step.minutes < 0) return emptyPlan();
    steps.push({ id: step.id, label: step.label, minutes: step.minutes });
  }

  return {
    version: PLAN_VERSION,
    deadline: raw.deadline,
    deadlineLabel: typeof raw.deadlineLabel === "string" ? raw.deadlineLabel : "",
    steps,
  };
}
