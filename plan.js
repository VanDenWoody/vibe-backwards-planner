export const PLAN_VERSION = 1;

let counter = 0;

function newId() {
  counter += 1;
  return `s${Date.now().toString(36)}${counter.toString(36)}`;
}

export function emptyPlan() {
  return { version: PLAN_VERSION, deadline: "", deadlineLabel: "", steps: [] };
}

// A negative number is a step of the person you are meeting: it runs forward
// from the deadline instead of back from it. "-" alone (half-typed) is zero.
export function coerceMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : 0;
}

// Negative steps sit directly under the deadline, above the meet line, so
// every time in the list reads in order. The sort is stable: each group keeps
// the order it was given.
export function orderSteps(steps) {
  return [...steps.filter((step) => step.minutes < 0), ...steps.filter((step) => !(step.minutes < 0))];
}

export function createStep(label, minutes) {
  return {
    id: newId(),
    label: typeof label === "string" ? label : "",
    minutes: coerceMinutes(minutes),
  };
}

// Moves the step at index one place up (offset -1) or down (+1). A move past
// either end is not an error: the order comes back unchanged, so a stale tap on
// a button that has just become disabled does nothing. Nor is a swap across
// the meet line: a negative step and one of yours never trade places.
export function moveStep(steps, index, offset) {
  const next = [...steps];
  const target = index + offset;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  if (next[index].minutes < 0 !== next[target].minutes < 0) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function insertStep(steps, index, step) {
  const next = [...steps];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, step);
  return next;
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
    if (!Number.isFinite(step.minutes)) return emptyPlan();
    steps.push({ id: step.id, label: step.label, minutes: step.minutes });
  }

  return {
    version: PLAN_VERSION,
    deadline: raw.deadline,
    deadlineLabel: typeof raw.deadlineLabel === "string" ? raw.deadlineLabel : "",
    steps: orderSteps(steps),
  };
}
