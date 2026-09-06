import { createStep } from "./plan.js";

export const TEMPLATES_VERSION = 1;

export function emptyLibrary() {
  return { version: TEMPLATES_VERSION, items: [] };
}

function normalizeSteps(raw) {
  if (!Array.isArray(raw)) return null;

  const steps = [];
  for (const step of raw) {
    if (step === null || typeof step !== "object") return null;
    if (typeof step.label !== "string") return null;
    if (!Number.isFinite(step.minutes) || step.minutes < 0) return null;
    steps.push({ label: step.label, minutes: step.minutes });
  }
  return steps;
}

function normalizeTemplate(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.id !== "string" || raw.id === "") return null;
  if (typeof raw.name !== "string" || raw.name === "") return null;

  const steps = normalizeSteps(raw.steps);
  if (steps === null) return null;

  return {
    id: raw.id,
    name: raw.name,
    deadlineLabel: typeof raw.deadlineLabel === "string" ? raw.deadlineLabel : "",
    steps,
  };
}

// Unlike normalizePlan, one bad entry does not condemn the rest: these are
// independent saved things, and losing the whole library to a single corrupt
// item would be the wrong trade.
export function normalizeLibrary(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return emptyLibrary();
  if (raw.version !== TEMPLATES_VERSION) return emptyLibrary();
  if (!Array.isArray(raw.items)) return emptyLibrary();

  const items = [];
  const seen = new Set();
  for (const entry of raw.items) {
    const template = normalizeTemplate(entry);
    if (template === null || seen.has(template.id)) continue;
    seen.add(template.id);
    items.push(template);
  }

  return { version: TEMPLATES_VERSION, items };
}

let counter = 0;

// Template ids live in their own namespace, so they carry their own prefix and
// counter rather than borrowing the one plan.js mints step ids from.
function newId() {
  counter += 1;
  return `t${Date.now().toString(36)}${counter.toString(36)}`;
}

// Steps arrive as plan steps and lose their ids on the way in: a template is a
// recipe, and every load mints fresh steps from it.
export function createTemplate(name, deadlineLabel, steps) {
  return {
    id: newId(),
    name: typeof name === "string" ? name.trim() : "",
    deadlineLabel: typeof deadlineLabel === "string" ? deadlineLabel : "",
    steps: (Array.isArray(steps) ? steps : []).map((step) => ({
      label: step.label,
      minutes: step.minutes,
    })),
  };
}

export function findTemplate(library, id) {
  if (typeof id !== "string" || id === "") return undefined;
  return library.items.find((item) => item.id === id);
}

function comparableName(name) {
  return typeof name === "string" ? name.trim().toLocaleLowerCase() : "";
}

// Returns the clashing template rather than a boolean, so a caller refusing a
// name can quote the spelling already in the library instead of echoing the
// variant that was just typed. exceptId lets a template keep its own name.
export function findTemplateByName(library, name, exceptId) {
  const wanted = comparableName(name);
  return library.items.find(
    (item) => item.id !== exceptId && comparableName(item.name) === wanted
  );
}

// An upsert: a template whose id is already in the library replaces it where it
// stands, so updating never reshuffles the picker. Returns a new library.
export function saveTemplate(library, template) {
  const index = library.items.findIndex((item) => item.id === template.id);
  const items = library.items.slice();
  if (index === -1) items.push(template);
  else items[index] = template;
  return { version: TEMPLATES_VERSION, items };
}

export function removeTemplate(library, id) {
  return {
    version: TEMPLATES_VERSION,
    items: library.items.filter((item) => item.id !== id),
  };
}

// The inverse of createTemplate: fresh plan steps, so the same template can be
// loaded repeatedly without two rows ever sharing an id.
export function planStepsFrom(template) {
  return template.steps.map((step) => createStep(step.label, step.minutes));
}
