import { computeSchedule } from "./schedule.js";
import { coerceMinutes, createStep } from "./plan.js";
import { loadPlan, savePlan } from "./storage.js";

const UNDO_MS = 6000;

const deadlineLabelEl = document.querySelector("#deadline-label");
const deadlineInputEl = document.querySelector("#deadline-input");
const deadlineTimeEl = document.querySelector("#deadline-time");
const deadlineDateEl = document.querySelector("#deadline-date");
const hintEl = document.querySelector("#hint");
const stepsEl = document.querySelector("#steps");
const leaveEl = document.querySelector("#leave");
const leaveTimeEl = document.querySelector("#leave-time");
const leaveTotalEl = document.querySelector("#leave-total");
const addStepEl = document.querySelector("#add-step");
const newLabelEl = document.querySelector("#new-label");
const newMinutesEl = document.querySelector("#new-minutes");
const clearAllEl = document.querySelector("#clear-all");
const undoEl = document.querySelector("#undo");
const undoMessageEl = document.querySelector("#undo-message");
const undoActionEl = document.querySelector("#undo-action");

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
});

const state = loadPlan();

// A delete applies immediately and parks its steps here for UNDO_MS, so Undo
// can put them back at the indices they came from. Only one deletion is ever
// pending: a second one commits the first.
let pending = null;
let pendingTimer = 0;

function formatAt(date, withDate) {
  const time = timeFmt.format(date);
  return withDate ? `${time} (${dateFmt.format(date)})` : time;
}

function isToday(date) {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function renderStructure() {
  stepsEl.replaceChildren();

  for (const step of state.steps) {
    const li = document.createElement("li");
    li.className = "step";
    li.dataset.id = step.id;

    const time = document.createElement("span");
    time.className = "step__time";

    const label = document.createElement("input");
    label.className = "step__label";
    label.type = "text";
    label.value = step.label;
    label.placeholder = "Unnamed step";
    label.autocomplete = "off";
    label.setAttribute("aria-label", "Step name");

    const minutes = document.createElement("input");
    minutes.className = "step__minutes";
    minutes.type = "number";
    minutes.min = "0";
    minutes.step = "1";
    minutes.inputMode = "numeric";
    minutes.value = String(step.minutes);
    minutes.placeholder = "0";
    minutes.setAttribute("aria-label", "Minutes");

    const unit = document.createElement("span");
    unit.className = "step__unit";
    unit.textContent = "min";

    const remove = document.createElement("button");
    remove.className = "step__delete";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Delete step");

    li.append(time, label, minutes, unit, remove);
    stepsEl.append(li);
  }
}

function renderTimes() {
  const { deadlineAt, rows, leaveAt, totalMinutes } = computeSchedule(state);
  const hasDeadline = deadlineAt !== null;
  const hasSteps = state.steps.length > 0;

  // The native picker prints its value in the browser's locale, which would
  // put a 12-hour string at the head of a 24-hour column. So the time is drawn
  // here from the same parsed value the schedule was built from.
  if (hasDeadline) {
    deadlineTimeEl.textContent = timeFmt.format(deadlineAt);
    deadlineTimeEl.classList.remove("deadline__time--unset");
    deadlineDateEl.textContent = isToday(deadlineAt) ? "Today" : dayFmt.format(deadlineAt);
  } else {
    deadlineTimeEl.textContent = "Set a time";
    deadlineTimeEl.classList.add("deadline__time--unset");
    deadlineDateEl.textContent = "";
  }

  if (!hasDeadline) {
    hintEl.textContent = "Set a deadline to see your schedule.";
  } else if (!hasSteps) {
    hintEl.textContent = "Add the last thing you do before it.";
  }
  hintEl.hidden = hasDeadline && hasSteps;

  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const li of stepsEl.children) {
    const row = byId.get(li.dataset.id);
    li.querySelector(".step__time").textContent =
      row && hasDeadline ? formatAt(row.startsAt, row.dayOffset !== 0) : "";
    li.classList.toggle("step--zero", row ? row.minutes === 0 : false);
  }

  // With no steps the leave time only restates the deadline, so it is hidden.
  // Its date appears whenever leaving is not today, which the day offset from
  // the deadline cannot tell you on its own.
  leaveEl.hidden = !hasDeadline || !hasSteps;
  if (!leaveEl.hidden) {
    leaveTimeEl.textContent = formatAt(leaveAt, !isToday(leaveAt));
    leaveTotalEl.textContent = `${formatDuration(totalMinutes)} of steps`;
  }

  clearAllEl.hidden = !hasSteps;
}

function render() {
  renderStructure();
  renderTimes();
}

function focusDeleteAt(index) {
  const rows = stepsEl.children;
  if (rows.length === 0) return;
  rows[Math.min(index, rows.length - 1)].querySelector(".step__delete").focus();
}

function commitPending() {
  if (pendingTimer !== 0) {
    clearTimeout(pendingTimer);
    pendingTimer = 0;
  }
  pending = null;
  undoEl.hidden = true;
  undoMessageEl.textContent = "";
}

function beginPending(entries, message) {
  commitPending();
  pending = entries;
  undoMessageEl.textContent = message;
  undoEl.hidden = false;
  pendingTimer = window.setTimeout(commitPending, UNDO_MS);
}

function undoPending() {
  if (pending === null) return;

  const entries = pending;
  commitPending();

  for (const entry of entries) {
    state.steps.splice(Math.min(entry.index, state.steps.length), 0, entry.step);
  }

  savePlan(state);
  render();
  focusDeleteAt(entries[0].index);
}

// A click reaches the invisible control and focuses it, but on desktop that
// only selects a segment: the picker opens from the calendar icon, which is
// invisible here. Since the drawn value cannot show a caret either, editing by
// keyboard alone would be blind. Asking for the picker makes one click enough
// on every platform; a tap that already opened it lands in the catch.
deadlineInputEl.addEventListener("click", () => {
  try {
    deadlineInputEl.showPicker();
  } catch {
    // No showPicker, or it is open already. Focus and typing still work.
  }
});

// change, not input: a half-typed date reads as an empty value, which would
// blank the header and the leave time between keystrokes.
deadlineInputEl.addEventListener("change", () => {
  state.deadline = deadlineInputEl.value;
  savePlan(state);
  renderTimes();
});

deadlineLabelEl.addEventListener("input", () => {
  state.deadlineLabel = deadlineLabelEl.value;
  savePlan(state);
});

stepsEl.addEventListener("input", (event) => {
  const li = event.target.closest("li.step");
  if (li === null) return;

  const step = state.steps.find((candidate) => candidate.id === li.dataset.id);
  if (step === undefined) return;

  if (event.target.classList.contains("step__label")) {
    step.label = event.target.value;
  } else if (event.target.classList.contains("step__minutes")) {
    step.minutes = coerceMinutes(event.target.value);
  } else {
    return;
  }

  savePlan(state);
  renderTimes();
});

stepsEl.addEventListener("click", (event) => {
  const button = event.target.closest("button.step__delete");
  if (button === null) return;

  const li = button.closest("li.step");
  const index = state.steps.findIndex((step) => step.id === li.dataset.id);
  if (index === -1) return;

  const [removed] = state.steps.splice(index, 1);
  savePlan(state);
  render();

  const name = removed.label.trim();
  beginPending(
    [{ step: removed, index }],
    name === "" ? "Deleted a step" : `Deleted “${name}”`
  );
  focusDeleteAt(index);
});

clearAllEl.addEventListener("click", () => {
  const count = state.steps.length;
  if (count === 0) return;

  const entries = state.steps.map((step, index) => ({ step, index }));
  state.steps = [];
  savePlan(state);
  render();

  beginPending(entries, `Cleared ${count} step${count === 1 ? "" : "s"}`);
  undoActionEl.focus();
});

undoActionEl.addEventListener("click", undoPending);

newLabelEl.addEventListener("input", () => {
  newLabelEl.setCustomValidity("");
});

addStepEl.addEventListener("submit", (event) => {
  event.preventDefault();

  const label = newLabelEl.value.trim();
  if (label === "") {
    newLabelEl.setCustomValidity("Give the step a name.");
    newLabelEl.reportValidity();
    return;
  }

  state.steps.push(createStep(label, newMinutesEl.value));
  savePlan(state);
  render();

  addStepEl.reset();
  newLabelEl.focus();
});

deadlineInputEl.value = state.deadline;
deadlineLabelEl.value = state.deadlineLabel;
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Not a secure context, or the browser refused. The app works regardless.
    });
  });
}
