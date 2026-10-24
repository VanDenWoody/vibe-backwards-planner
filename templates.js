import { createStep, orderSteps } from "./plan.js";

// Version 2 adds updatedAt per template and tombstones for deletes, so that
// sync can tell a new edit from an old one and a delete from a never-had.
export const TEMPLATES_VERSION = 2;

export function emptyLibrary() {
  return { version: TEMPLATES_VERSION, items: [], tombstones: [] };
}

function isTime(value) {
  return Number.isFinite(value) && value >= 0;
}

// A template's deadline is a clock time without a date ("08:15"), or "" for a
// template that leaves the deadline alone.
function isClock(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function pad(number) {
  return String(number).padStart(2, "0");
}

// The clock time of a plan deadline ("2026-10-30T14:00" gives "14:00"), or ""
// when there is no deadline to take it from.
export function timeOfDeadline(deadline) {
  if (typeof deadline !== "string") return "";
  const match = deadline.match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/);
  return match !== null && isClock(match[1]) ? match[1] : "";
}

// The next time the clock shows time, as a plan deadline: today if it is still
// ahead of now, otherwise tomorrow. Built from local parts, so a daylight
// saving change in between still lands on the clock time asked for.
export function nextOccurrence(time, now) {
  const [hours, minutes] = time.split(":").map(Number);
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
  if (at <= now) at.setDate(at.getDate() + 1);
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${time}`;
}

// The same day as deadline, at time instead.
export function onSameDay(deadline, time) {
  return `${deadline.slice(0, 10)}T${time}`;
}

function normalizeSteps(raw) {
  if (!Array.isArray(raw)) return null;

  const steps = [];
  for (const step of raw) {
    if (step === null || typeof step !== "object") return null;
    if (typeof step.label !== "string") return null;
    if (!Number.isFinite(step.minutes)) return null;
    steps.push({ label: step.label, minutes: step.minutes });
  }
  return steps;
}

export function normalizeTemplate(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.id !== "string" || raw.id === "") return null;
  if (typeof raw.name !== "string" || raw.name === "") return null;

  const steps = normalizeSteps(raw.steps);
  if (steps === null) return null;

  return {
    id: raw.id,
    name: raw.name,
    deadlineLabel: typeof raw.deadlineLabel === "string" ? raw.deadlineLabel : "",
    deadlineTime: isClock(raw.deadlineTime) ? raw.deadlineTime : "",
    steps,
    updatedAt: isTime(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

function normalizeTombstones(raw) {
  if (!Array.isArray(raw)) return [];
  const tombstones = [];
  const seen = new Set();
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    if (typeof entry.id !== "string" || entry.id === "" || seen.has(entry.id)) continue;
    if (!isTime(entry.deletedAt)) continue;
    seen.add(entry.id);
    tombstones.push({ id: entry.id, deletedAt: entry.deletedAt });
  }
  return tombstones;
}

// Unlike normalizePlan, one bad entry does not condemn the rest: these are
// independent saved things, and losing the whole library to a single corrupt
// item would be the wrong trade. Version 1 migrates: every item unstamped (0),
// no tombstones.
export function normalizeLibrary(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return emptyLibrary();
  if (raw.version !== 1 && raw.version !== TEMPLATES_VERSION) return emptyLibrary();
  if (!Array.isArray(raw.items)) return emptyLibrary();

  const items = [];
  const seen = new Set();
  for (const entry of raw.items) {
    const template = normalizeTemplate(entry);
    if (template === null || seen.has(template.id)) continue;
    seen.add(template.id);
    items.push(template);
  }

  const tombstones = raw.version === 1 ? [] : normalizeTombstones(raw.tombstones);
  return { version: TEMPLATES_VERSION, items, tombstones };
}

let counter = 0;

// Template ids live in their own namespace, so they carry their own prefix and
// counter rather than borrowing the one plan.js mints step ids from.
function newId() {
  counter += 1;
  return `t${Date.now().toString(36)}${counter.toString(36)}`;
}

// Steps arrive as plan steps and lose their ids on the way in: a template is a
// recipe, and every load mints fresh steps from it. Stamping updatedAt is
// stampChanges' job, so a new template starts at 0.
export function createTemplate(name, deadlineLabel, steps, deadlineTime = "") {
  return {
    id: newId(),
    name: typeof name === "string" ? name.trim() : "",
    deadlineLabel: typeof deadlineLabel === "string" ? deadlineLabel : "",
    deadlineTime: isClock(deadlineTime) ? deadlineTime : "",
    steps: (Array.isArray(steps) ? steps : []).map((step) => ({
      label: step.label,
      minutes: step.minutes,
    })),
    updatedAt: 0,
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
  return { version: TEMPLATES_VERSION, items, tombstones: library.tombstones };
}

// Leaves no tombstone: stampChanges adds one when the change is committed.
export function removeTemplate(library, id) {
  return {
    version: TEMPLATES_VERSION,
    items: library.items.filter((item) => item.id !== id),
    tombstones: library.tombstones,
  };
}

export function sameContent(a, b) {
  if (a.name !== b.name || a.deadlineLabel !== b.deadlineLabel) return false;
  if (a.deadlineTime !== b.deadlineTime) return false;
  if (a.steps.length !== b.steps.length) return false;
  return a.steps.every(
    (step, i) => step.label === b.steps[i].label && step.minutes === b.steps[i].minutes
  );
}

// The one place local changes get dated. Every item that is new (including one
// an undo brought back) or whose content differs from previous gets
// updatedAt = now; every id that left gets a tombstone. Tombstones previous
// had are carried even when next lacks them, because an undo snapshot can be
// older than a delete that sync already spread.
export function stampChanges(previous, next, now) {
  const before = new Map(previous.items.map((item) => [item.id, item]));
  const items = next.items.map((item) => {
    const old = before.get(item.id);
    return old !== undefined && sameContent(old, item) ? item : { ...item, updatedAt: now };
  });

  const present = new Set(items.map((item) => item.id));
  const tombstones = new Map();
  for (const tombstone of [...previous.tombstones, ...next.tombstones]) {
    const known = tombstones.get(tombstone.id);
    if (known === undefined || tombstone.deletedAt > known.deletedAt) {
      tombstones.set(tombstone.id, tombstone);
    }
  }
  for (const item of previous.items) {
    if (!present.has(item.id)) tombstones.set(item.id, { id: item.id, deletedAt: now });
  }
  for (const id of present) tombstones.delete(id);

  return { version: TEMPLATES_VERSION, items, tombstones: [...tombstones.values()] };
}

// The inverse of createTemplate: fresh plan steps, so the same template can be
// loaded repeatedly without two rows ever sharing an id.
export function planStepsFrom(template) {
  return orderSteps(template.steps.map((step) => createStep(step.label, step.minutes)));
}
