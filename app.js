import { computeSchedule } from "./schedule.js";
import { coerceMinutes, createStep } from "./plan.js";
import {
  createTemplate,
  findTemplate,
  findTemplateByName,
  planStepsFrom,
  removeTemplate,
  saveTemplate,
} from "./templates.js";
import {
  loadActiveTemplateId,
  loadPlan,
  loadTemplates,
  savePlan,
  saveActiveTemplateId,
  saveTemplates,
} from "./storage.js";

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
const templatesEl = document.querySelector("#templates");
const pickerEl = document.querySelector("#template-picker");
const updateEl = document.querySelector("#template-update");
const saveTemplateEl = document.querySelector("#template-save");
const deleteTemplateEl = document.querySelector("#template-delete");
const namingEl = document.querySelector("#template-name-form");
const nameEl = document.querySelector("#template-name");
const cancelNameEl = document.querySelector("#template-cancel");
const templatesRowEl = document.querySelector(".templates__row");

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

let library = loadTemplates();
// The template the Update button writes to: whichever was last loaded or
// saved. Persisted, so Update survives a reload of the installed app.
let activeId = loadActiveTemplateId();
if (findTemplate(library, activeId) === undefined) activeId = "";

// A destructive action applies immediately and parks an undo here for UNDO_MS.
// The parked value is a closure that puts the previous state back — including
// persisting and re-rendering, since what needs saving differs between a step
// and a template. Only one is ever pending: a second action commits the first.
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

function setActive(id) {
  activeId = id;
  saveActiveTemplateId(id);
}

function renderTemplates() {
  const active = findTemplate(library, activeId);
  if (active === undefined) activeId = "";

  pickerEl.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Load a template…";
  pickerEl.append(placeholder);

  for (const template of library.items) {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = template.name;
    pickerEl.append(option);
  }
  pickerEl.value = activeId;

  // The picker is only useful once something has been saved, and there is
  // nothing to save until a step exists. When both are true the row is empty,
  // so the whole section goes.
  const hasTemplates = library.items.length > 0;
  const hasSteps = state.steps.length > 0;
  pickerEl.hidden = !hasTemplates;
  saveTemplateEl.hidden = !hasSteps;
  templatesEl.hidden = !hasTemplates && !hasSteps;

  // The picker sitting beside them already shows the name, so the buttons stay
  // short and carry it for screen readers instead.
  updateEl.hidden = active === undefined;
  deleteTemplateEl.hidden = active === undefined;
  if (active !== undefined) {
    updateEl.textContent = "Update";
    updateEl.setAttribute("aria-label", `Update “${active.name}”`);
    deleteTemplateEl.setAttribute("aria-label", `Delete “${active.name}”`);
  }
}

function render() {
  renderStructure();
  renderTimes();
  renderTemplates();
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

function beginPending(message, restore) {
  commitPending();
  pending = restore;
  undoMessageEl.textContent = message;
  undoEl.hidden = false;
  pendingTimer = window.setTimeout(commitPending, UNDO_MS);
}

function undoPending() {
  if (pending === null) return;

  const restore = pending;
  commitPending();
  restore();
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
  beginPending(name === "" ? "Deleted a step" : `Deleted “${name}”`, () => {
    state.steps.splice(Math.min(index, state.steps.length), 0, removed);
    savePlan(state);
    render();
    focusDeleteAt(index);
  });
  focusDeleteAt(index);
});

clearAllEl.addEventListener("click", () => {
  const count = state.steps.length;
  if (count === 0) return;

  const removed = state.steps;
  state.steps = [];
  savePlan(state);
  render();

  beginPending(`Cleared ${count} step${count === 1 ? "" : "s"}`, () => {
    state.steps = removed;
    savePlan(state);
    render();
    focusDeleteAt(0);
  });
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

function commitLibrary(next) {
  library = next;
  saveTemplates(library);
  renderTemplates();
}

function showNaming(show) {
  templatesRowEl.hidden = show;
  namingEl.hidden = !show;
  if (show) {
    nameEl.value = "";
    nameEl.setCustomValidity("");
    nameEl.focus();
  }
}

pickerEl.addEventListener("change", () => {
  const template = findTemplate(library, pickerEl.value);
  if (template === undefined) {
    // The placeholder row. There is nothing to load, so put the selection back
    // on whatever is active rather than leaving the picker reading empty.
    pickerEl.value = activeId;
    return;
  }

  const previousSteps = state.steps;
  const previousLabel = state.deadlineLabel;
  const previousActive = activeId;

  state.steps = planStepsFrom(template);
  state.deadlineLabel = template.deadlineLabel;
  // Writing an input's value is banned during render, where it would eat the
  // caret. Here the user is not typing, so the field has to be told.
  deadlineLabelEl.value = state.deadlineLabel;
  setActive(template.id);
  savePlan(state);
  render();

  beginPending(`Loaded “${template.name}”`, () => {
    state.steps = previousSteps;
    state.deadlineLabel = previousLabel;
    deadlineLabelEl.value = previousLabel;
    setActive(previousActive);
    savePlan(state);
    render();
  });
});

updateEl.addEventListener("click", () => {
  const active = findTemplate(library, activeId);
  if (active === undefined) return;

  const previous = library;
  // createTemplate does the stripping and trimming; keeping the original id is
  // what turns the result from a new template into a replacement.
  const replacement = {
    ...createTemplate(active.name, state.deadlineLabel, state.steps),
    id: active.id,
  };
  commitLibrary(saveTemplate(library, replacement));

  beginPending(`Updated “${active.name}”`, () => commitLibrary(previous));
});

saveTemplateEl.addEventListener("click", () => showNaming(true));
cancelNameEl.addEventListener("click", () => showNaming(false));

nameEl.addEventListener("input", () => {
  nameEl.setCustomValidity("");
});

namingEl.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = nameEl.value.trim();
  if (name === "") {
    nameEl.setCustomValidity("Give the template a name.");
    nameEl.reportValidity();
    return;
  }
  // Overwriting is what Update is for, so a taken name is refused here rather
  // than raising a confirm dialog the rest of the app manages without.
  const clash = findTemplateByName(library, name);
  if (clash !== undefined) {
    nameEl.setCustomValidity(`“${clash.name}” already exists. Load it and use Update.`);
    nameEl.reportValidity();
    return;
  }

  const template = createTemplate(name, state.deadlineLabel, state.steps);
  const previous = library;
  const previousActive = activeId;

  setActive(template.id);
  commitLibrary(saveTemplate(library, template));
  showNaming(false);

  beginPending(`Saved “${template.name}”`, () => {
    setActive(previousActive);
    commitLibrary(previous);
  });
});

deleteTemplateEl.addEventListener("click", () => {
  const active = findTemplate(library, activeId);
  if (active === undefined) return;

  const previous = library;
  const previousActive = activeId;

  setActive("");
  commitLibrary(removeTemplate(library, active.id));

  beginPending(`Deleted “${active.name}”`, () => {
    setActive(previousActive);
    commitLibrary(previous);
  });
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
